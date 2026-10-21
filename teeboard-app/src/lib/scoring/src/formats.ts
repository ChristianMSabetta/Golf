/**
 * Competition formats: stroke play, scramble, best ball (four-ball),
 * stableford, and shamble — each computing gross and/or net standings
 * from per-player scorecards, with configurable team sizes for the team
 * formats.
 *
 * Handicap math is never reimplemented here: every per-player value comes
 * from the foundation layer (`computeHandicap` / `allocateStrokes`), and
 * every per-hole score from `computeScorecard` under a `MaxScoreRule`.
 * Allowances default to the WHS values the Rules of Handicapping 5.5
 * actually defines (95% individual, 85% four-ball); scramble/shamble
 * percentages vary by local custom and are therefore required inputs,
 * never code assumptions.
 */
import {
  DEFAULT_MAX_TEAM_SIZE,
  DEFAULT_MIN_TEAM_SIZE,
  FOUR_BALL_DEFAULT_ALLOWANCE,
  NET_COMPETITION_DEFAULT_ALLOWANCE,
} from "./constants";
import { roundHalfUpAwayFromZero } from "./rounding";
import {
  computeScorecard,
  totalGross,
  totalNet,
} from "./scorecard";
import {
  STANDARD_STABLEFORD_SCALE,
  computeStablefordScorecard,
  totalStablefordPoints,
} from "./stableford";
import { breakTiesByCardOff, cardOffBreakdown } from "./tiebreak";
import { computeHandicap } from "./handicap";
import { allocateStrokes } from "./strokes";
import type {
  Allowance,
  BestBallStanding,
  CardOffBreakdown,
  Course,
  CourseHandicapOverride,
  HoleStrokes,
  MaxScoreRule,
  PlayingHandicapOverride,
  ScorecardHole,
  ScorecardHoleResult,
  ScrambleStanding,
  ScoringBasis,
  ShambleStanding,
  StablefordPointScale,
  StablefordStanding,
  StrokeIndexSelectionMode,
  StrokePlayStanding,
  TeeRating,
} from "./types";
import type { StablefordHoleResult } from "./types";

/** One competitor's raw input: identity, WHS Handicap Index, and the
 * strokes played per hole (sparse: unplayed holes are absent). */
export interface FormatPlayer {
  id: string;
  handicapIndex: number;
  scores: HoleStrokes;
  courseHandicapOverride?: CourseHandicapOverride;
  playingHandicapOverride?: PlayingHandicapOverride;
}

/** Configurable team-size bounds (defaults: 2–4, Rules of Golf 22/23). */
export interface TeamSizeBounds {
  min?: number;
  max?: number;
}

/** Shared per-round context every format consumes. */
export interface FormatContext {
  course: Course;
  tee: TeeRating;
  maxScoreRule?: MaxScoreRule;
  basis?: ScoringBasis;
  tiebreak?: boolean;
  strokeIndexMode?: StrokeIndexSelectionMode;
}

const DEFAULT_MAX_SCORE_RULE: MaxScoreRule = { kind: "none" };
const DEFAULT_BASIS: ScoringBasis = "both";
const DEFAULT_STROKE_INDEX_MODE: StrokeIndexSelectionMode = "full";

/** Validate a team size against the configured bounds (2–4 default). */
export function validateTeamSize(
  size: number,
  bounds?: TeamSizeBounds,
): void {
  const min = bounds?.min ?? DEFAULT_MIN_TEAM_SIZE;
  const max = bounds?.max ?? DEFAULT_MAX_TEAM_SIZE;
  if (size < min || size > max) {
    throw new Error(
      `Team size ${size} is outside the configured bounds (${min}-${max})`,
    );
  }
}

/** The per-hole scores a ranking is decided on: gross strokes when the
 * basis ranks gross, net strokes otherwise ("both" ranks by net — the WHS
 * net-competition default). */
function rankingBasisTotal(
  basis: ScoringBasis,
): "gross" | "net" {
  return basis === "gross" ? "gross" : "net";
}

/** Merge a course's holes with a player's sparse scores into a card input. */
function cardInput(
  course: Course,
  scores: HoleStrokes,
): ScorecardHole[] {
  return course.holeList.map((hole) => ({
    holeNumber: hole.holeNumber,
    par: hole.par,
    strokeIndex: hole.strokeIndex,
    strokes: scores[hole.holeNumber] ?? null,
  }));
}

/** One player's full computed card: handicap values, stroke allocation,
 * and per-hole results under the maximum-score rule. */
export interface PlayerCard {
  playingHandicap: number;
  courseHandicap: number;
  strokesByHole: HoleStrokes;
  card: ScorecardHoleResult[];
  thru: number;
}

/** Compute one player's card (handicap → allocation → capped scorecard). */
export function computePlayerCard(input: {
  player: FormatPlayer;
  course: Course;
  tee: TeeRating;
  allowance: Allowance;
  maxScoreRule: MaxScoreRule;
  strokeIndexMode: StrokeIndexSelectionMode;
}): PlayerCard {
  const handicap = computeHandicap({
    handicapIndex: input.player.handicapIndex,
    course: input.course,
    tee: input.tee,
    allowance: input.allowance,
    courseHandicapOverride: input.player.courseHandicapOverride,
    playingHandicapOverride: input.player.playingHandicapOverride,
  });
  const allocation = allocateStrokes(
    handicap.playingHandicap,
    input.course,
    input.strokeIndexMode,
  );
  const card = computeScorecard({
    holes: cardInput(input.course, input.player.scores),
    strokesByHole: allocation.strokes,
    maxScoreRule: input.maxScoreRule,
  });
  return {
    playingHandicap: handicap.playingHandicap,
    courseHandicap: handicap.courseHandicap,
    strokesByHole: allocation.strokes,
    card,
    thru: card.filter((h) => h.strokes !== null).length,
  };
}

/** Sparse per-hole map of a card's gross or net strokes (played holes). */
function perHoleFromCard(
  card: ScorecardHoleResult[],
  field: "gross" | "net",
): HoleStrokes {
  const out: HoleStrokes = {};
  for (const hole of card) {
    if (hole.strokes === null) {
      continue;
    }
    out[hole.holeNumber] =
      field === "gross" ? hole.strokes : (hole.netStrokes as number);
  }
  return out;
}

/**
 * Rank rows into competition standings.
 *
 * Rows are ordered by `total` (lower wins unless `better === "higher"`,
 * e.g. Stableford points). Equal totals form a tie group:
 *
 * - `tiebreak: false` — the group shares one position; the next distinct
 *   total skips accordingly (T1, T1, 3).
 * - `tiebreak: true` — the group is ordered by USGA card-off (last 9,
 *   last 6, last 3, then hole-by-hole backwards); only identical cards
 *   share a position, decided orders take sequential positions.
 */
function rankStandings<T extends { id: string; total: number; perHoleScores: HoleStrokes }>(
  rows: T[],
  holeOrder: number[],
  options: { better: "lower" | "higher"; tiebreak: boolean },
): (T & {
  position: number;
  tied: boolean;
  cardOff: CardOffBreakdown;
})[] {
  const { better, tiebreak } = options;
  const sign = better === "lower" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => sign * (a.total - b.total));

  // Group consecutive equal totals.
  const groups: T[][] = [];
  for (const row of sorted) {
    const last = groups[groups.length - 1];
    if (last && last[0].total === row.total) {
      last.push(row);
    } else {
      groups.push([row]);
    }
  }

  const out: (T & {
    position: number;
    tied: boolean;
    cardOff: CardOffBreakdown;
  })[] = [];
  let position = 1;

  for (const group of groups) {
    if (group.length === 1) {
      const row = group[0];
      out.push({
        ...row,
        position,
        tied: false,
        cardOff: cardOffBreakdown(row.perHoleScores, holeOrder),
      });
      position += 1;
      continue;
    }
    if (!tiebreak) {
      for (const row of group) {
        out.push({
          ...row,
          position,
          tied: true,
          cardOff: cardOffBreakdown(row.perHoleScores, holeOrder),
        });
      }
      position += group.length;
      continue;
    }
    const decided = breakTiesByCardOff({
      holeOrder,
      participants: group.map((row) => ({
        id: row.id,
        perHoleScores: row.perHoleScores,
      })),
    });
    // Entries sharing a card-off rank are genuinely tied (identical
    // cards through every stage); each distinct rank takes the next
    // competition position.
    let i = 0;
    while (i < decided.length) {
      let j = i + 1;
      while (j < decided.length && decided[j].rank === decided[i].rank) {
        j += 1;
      }
      const runSize = j - i;
      for (let k = i; k < j; k += 1) {
        const row = group.find((r) => r.id === decided[k].id);
        if (row) {
          out.push({
            ...row,
            position,
            tied: runSize > 1,
            cardOff: decided[k].breakdown,
          });
        }
      }
      position += runSize;
      i = j;
    }
  }
  return out;
}

/** Resolve the options shared by every format entry point. */
function resolveContext(ctx: FormatContext) {
  return {
    course: ctx.course,
    tee: ctx.tee,
    maxScoreRule: ctx.maxScoreRule ?? DEFAULT_MAX_SCORE_RULE,
    basis: ctx.basis ?? DEFAULT_BASIS,
    tiebreak: ctx.tiebreak ?? false,
    strokeIndexMode: ctx.strokeIndexMode ?? DEFAULT_STROKE_INDEX_MODE,
  };
}

/**
 * Stroke play standings (individuals): totals of capped gross and net
 * strokes per player, ranked by the configured basis. Default allowance
 * is the WHS individual net default (Rules of Handicapping 5.5, 95%).
 */
export function computeStrokePlayStandings(input: FormatContext & {
  players: FormatPlayer[];
  allowance?: Allowance;
}): StrokePlayStanding[] {
  const ctx = resolveContext(input);
  const allowance = input.allowance ?? {
    fraction: NET_COMPETITION_DEFAULT_ALLOWANCE,
  };
  const rank = rankingBasisTotal(ctx.basis);
  const holeOrder = ctx.course.holeList.map((h) => h.holeNumber);

  const rows = input.players.map((player) => {
    const card = computePlayerCard({
      player,
      course: ctx.course,
      tee: ctx.tee,
      allowance,
      maxScoreRule: ctx.maxScoreRule,
      strokeIndexMode: ctx.strokeIndexMode,
    });
    const perHoleScores = perHoleFromCard(card.card, rank);
    return {
      id: player.id,
      total: rank === "gross" ? totalGross(card.card) : totalNet(card.card),
      perHoleScores,
      gross: totalGross(card.card),
      net: totalNet(card.card),
      playingHandicap: card.playingHandicap,
      courseHandicap: card.courseHandicap,
      card: card.card,
      thru: card.thru,
    };
  });

  return rankStandings(
    rows,
    holeOrder,
    { better: "lower", tiebreak: ctx.tiebreak },
  ).map((row) => ({
    id: row.id,
    position: row.position,
    tied: row.tied,
    gross: row.gross,
    net: row.net,
    playingHandicap: row.playingHandicap,
    courseHandicap: row.courseHandicap,
    card: row.card,
    thru: row.thru,
    cardOff: row.cardOff,
  }));
}

/**
 * Stableford standings (individuals): points per hole from the net score
 * relative to par under the point scale, ranked by total points
 * (higher wins). Default allowance: WHS 95%; default scale: the USGA/EGA
 * standard table (local variants are explicit input).
 */
export function computeStablefordStandings(input: FormatContext & {
  players: FormatPlayer[];
  allowance?: Allowance;
  scale?: StablefordPointScale;
}): StablefordStanding[] {
  const ctx = resolveContext(input);
  const allowance = input.allowance ?? {
    fraction: NET_COMPETITION_DEFAULT_ALLOWANCE,
  };
  const scale = input.scale ?? STANDARD_STABLEFORD_SCALE;
  const holeOrder = ctx.course.holeList.map((h) => h.holeNumber);

  const rows = input.players.map((player) => {
    const card = computePlayerCard({
      player,
      course: ctx.course,
      tee: ctx.tee,
      allowance,
      maxScoreRule: ctx.maxScoreRule,
      strokeIndexMode: ctx.strokeIndexMode,
    });
    const stablefordCard: StablefordHoleResult[] = computeStablefordScorecard({
      holes: cardInput(ctx.course, player.scores),
      strokesByHole: card.strokesByHole,
      maxScoreRule: ctx.maxScoreRule,
      scale,
    });
    // Card-off compares strokes (lower wins), not points.
    const perHoleScores = perHoleFromCard(card.card, "net");
    return {
      id: player.id,
      total: totalStablefordPoints(stablefordCard),
      perHoleScores,
      points: totalStablefordPoints(stablefordCard),
      gross: totalGross(card.card),
      net: totalNet(card.card),
      playingHandicap: card.playingHandicap,
      courseHandicap: card.courseHandicap,
      card: stablefordCard,
      thru: card.thru,
    };
  });

  return rankStandings(
    rows,
    holeOrder,
    { better: "higher", tiebreak: ctx.tiebreak },
  ).map((row) => ({
    id: row.id,
    position: row.position,
    tied: row.tied,
    points: row.points,
    gross: row.gross,
    net: row.net,
    playingHandicap: row.playingHandicap,
    courseHandicap: row.courseHandicap,
    card: row.card,
    thru: row.thru,
    cardOff: row.cardOff,
  }));
}

/** A team for the team formats: members with their own inputs. */
export interface FormatTeam {
  id: string;
  members: FormatPlayer[];
}

/** Scramble team input: one recorded team score per hole plus members. */
export interface ScrambleTeam {
  id: string;
  scores: HoleStrokes;
  members: FormatPlayer[];
}

/**
 * Scramble standings (teams): the team records one score per hole; the
 * team Playing Handicap is the sum of each member's allowance-reduced
 * Course Handicap (per-player `allowanceFraction` — required input, since
 * scramble percentages vary by local custom), and strokes are allocated
 * to the team handicap over the course's stroke index.
 */
export function computeScrambleStandings(input: FormatContext & {
  teams: ScrambleTeam[];
  allowanceFraction: number;
  teamSize?: TeamSizeBounds;
}): ScrambleStanding[] {
  const ctx = resolveContext(input);
  const holeOrder = ctx.course.holeList.map((h) => h.holeNumber);
  const rank = rankingBasisTotal(ctx.basis);

  const rows = input.teams.map((team) => {
    validateTeamSize(team.members.length, input.teamSize);
    const memberHandicaps = team.members.map((member) => {
      const handicap = computeHandicap({
        handicapIndex: member.handicapIndex,
        course: ctx.course,
        tee: ctx.tee,
        allowance: { fraction: 1 },
        courseHandicapOverride: member.courseHandicapOverride,
      });
      const reduced = roundHalfUpAwayFromZero(
        handicap.courseHandicap * input.allowanceFraction,
      );
      return { id: member.id, courseHandicap: handicap.courseHandicap, reduced };
    });
    const teamPlayingHandicap = memberHandicaps.reduce(
      (sum, m) => sum + m.reduced,
      0,
    );
    const allocation = allocateStrokes(
      teamPlayingHandicap,
      ctx.course,
      ctx.strokeIndexMode,
    );
    const card = computeScorecard({
      holes: cardInput(ctx.course, team.scores),
      strokesByHole: allocation.strokes,
      maxScoreRule: ctx.maxScoreRule,
    });
    const perHoleScores = perHoleFromCard(card, rank);
    return {
      id: team.id,
      total: rank === "gross" ? totalGross(card) : totalNet(card),
      perHoleScores,
      gross: totalGross(card),
      net: totalNet(card),
      playingHandicap: teamPlayingHandicap,
      members: memberHandicaps.map((m) => ({
        id: m.id,
        courseHandicap: m.courseHandicap,
        reducedHandicap: m.reduced,
      })),
      card,
      thru: card.filter((h) => h.strokes !== null).length,
    };
  });

  return rankStandings(rows, holeOrder, {
    better: "lower",
    tiebreak: ctx.tiebreak,
  }).map((row) => ({
    id: row.id,
    position: row.position,
    tied: row.tied,
    gross: row.gross,
    net: row.net,
    playingHandicap: row.playingHandicap,
    members: row.members,
    card: row.card,
    thru: row.thru,
    cardOff: row.cardOff,
  }));
}

/** Best-ball team hole score: the sum of the `countable` lowest member
 * scores on the hole (net or gross per the ranking basis). Holes nobody
 * played are absent (they lose card-offs deterministically). */
function bestBallPerHole(
  memberCards: { card: ScorecardHoleResult[] }[],
  field: "gross" | "net",
  countable: number,
): HoleStrokes {
  const out: HoleStrokes = {};
  const holeNumbers = memberCards[0]?.card.map((h) => h.holeNumber) ?? [];
  for (const holeNumber of holeNumbers) {
    const played = memberCards
      .map((m) => m.card.find((h) => h.holeNumber === holeNumber))
      .filter(
        (h): h is ScorecardHoleResult =>
          h !== undefined && h.strokes !== null,
      )
      .map((h) => (field === "gross" ? h.strokes as number : h.netStrokes as number))
      .sort((a, b) => a - b);
    if (played.length === 0) {
      continue;
    }
    const counted = played.slice(0, Math.min(countable, played.length));
    out[holeNumber] = counted.reduce((sum, s) => sum + s, 0);
  }
  return out;
}

/** Shared best-ball/shamble core: every member plays their own ball under
 * their own Playing Handicap; the team counts the best N balls per hole. */
function computeTwoBallStyleStandings(input: FormatContext & {
  teams: FormatTeam[];
  allowance: Allowance;
  countable: number;
  teamSize?: TeamSizeBounds;
}) {
  const ctx = resolveContext(input);
  const rank = rankingBasisTotal(ctx.basis);
  const holeOrder = ctx.course.holeList.map((h) => h.holeNumber);

  const rows = input.teams.map((team) => {
    validateTeamSize(team.members.length, input.teamSize);
    const memberCards = team.members.map((member) => ({
      id: member.id,
      card: computePlayerCard({
        player: member,
        course: ctx.course,
        tee: ctx.tee,
        allowance: input.allowance,
        maxScoreRule: ctx.maxScoreRule,
        strokeIndexMode: ctx.strokeIndexMode,
      }),
    }));
    const perHoleScores = bestBallPerHole(
      memberCards.map((m) => ({ card: m.card.card })),
      rank,
      input.countable,
    );
    const total = Object.values(perHoleScores).reduce(
      (sum, s) => sum + s,
      0,
    );
    const holesPlayed = new Set(Object.keys(perHoleScores).map(Number));
    return {
      id: team.id,
      total,
      perHoleScores,
      members: memberCards.map((m) => ({
        id: m.id,
        playingHandicap: m.card.playingHandicap,
        courseHandicap: m.card.courseHandicap,
        thru: m.card.thru,
      })),
      thru: holesPlayed.size,
    };
  });
  return rankStandings(rows, holeOrder, {
    better: "lower",
    tiebreak: ctx.tiebreak,
  });
}

/**
 * Best ball (four-ball) standings: each member plays their own ball under
 * their own Playing Handicap; the team score per hole is the sum of the
 * `countable` (default 1) best net (or gross) member balls. Default
 * allowance: the WHS four-ball default (Rules of Handicapping 5.5, 85%).
 */
export function computeBestBallStandings(input: FormatContext & {
  teams: FormatTeam[];
  allowance?: Allowance;
  countable?: number;
  teamSize?: TeamSizeBounds;
}): BestBallStanding[] {
  const allowance = input.allowance ?? {
    fraction: FOUR_BALL_DEFAULT_ALLOWANCE,
  };
  const countable = input.countable ?? 1;
  return computeTwoBallStyleStandings({
    ...input,
    allowance,
    countable,
  }).map((row) => ({
    id: row.id,
    position: row.position,
    tied: row.tied,
    total: row.total,
    members: row.members,
    thru: row.thru,
    cardOff: row.cardOff,
  }));
}

/**
 * Shamble standings: like best ball, but every member's Playing Handicap
 * is allowance-reduced (`allowanceFraction` — required input, shamble
 * percentages vary by local custom) and the team counts the best
 * `countable` (default 1) balls per hole.
 */
export function computeShambleStandings(input: FormatContext & {
  teams: FormatTeam[];
  allowanceFraction: number;
  countable?: number;
  teamSize?: TeamSizeBounds;
}): ShambleStanding[] {
  const countable = input.countable ?? 1;
  return computeTwoBallStyleStandings({
    ...input,
    allowance: { fraction: input.allowanceFraction },
    countable,
  }).map((row) => ({
    id: row.id,
    position: row.position,
    tied: row.tied,
    total: row.total,
    members: row.members,
    thru: row.thru,
    cardOff: row.cardOff,
  }));
}
