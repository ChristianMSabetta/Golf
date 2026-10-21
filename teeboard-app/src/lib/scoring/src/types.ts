/**
 * Input types of the scoring package. The package reads no environment and
 * holds no configuration: every course datum, handicap index, allowance, and
 * override is an explicit function parameter shaped by these types.
 */

/** Number of holes a round covers. */
export type HoleCount = 9 | 18;

/**
 * A hole of the course being played.
 *
 * `strokeIndex` follows the standard WHS/USGA Stroke Index scale (1–18 for an
 * 18-hole course, 1–9 for a 9-hole course), where 1 is the hole on which a
 * player receiving one stroke receives it first.
 */
export interface Hole {
  /** 1-based hole number on the course (1–9 or 1–18). */
  holeNumber: number;
  /** Par of the hole (3–5 for typical holes). */
  par: number;
  /** Stroke index of the hole (1–18 on an 18-hole course, 1–9 on 9 holes). */
  strokeIndex: number;
}

/** Rating data for the tees being played. */
export interface TeeRating {
  /** Course Rating; for 9-hole rounds this is the 9-hole Course Rating (CR9). */
  courseRating: number;
  /**
   * Slope Rating (113 = course of standard difficulty); for 9-hole rounds
   * this is the 9-hole slope rating.
   */
  slopeRating: number;
}

/** A course as the handicap layer needs it: the holes plus tee ratings. */
export interface Course {
  /** Number of holes the round covers. */
  holes: HoleCount;
  /** Holes of the round in play order. */
  holeList: Hole[];
  /** Total par of the holes in `holeList`. */
  par: number;
  /** Ratings per tee name (e.g. "white", "blue", "red"). */
  tees: Record<string, TeeRating>;
}

/**
 * How strokes are given for the round.
 *
 * - `"full"` — strokes are allocated as if the round covered all 18 holes of
 *   the Stroke Index scale.
 * - `"front"` — the round uses only the front 9 of the 18-hole Stroke Index
 *   scale.
 * - `"back"` — the round uses only the back 9 of the 18-hole Stroke Index
 *   scale.
 */
export type StrokeIndexSelectionMode = "full" | "front" | "back";

/**
 * Manual override of a computed Course Handicap, applied before allowances
 * (Rules of Handicapping 5.6 — the Committee may set a player's Course
 * Handicap for the competition).
 */
export interface CourseHandicapOverride {
  /** Whole-number Course Handicap to use instead of the computed value. May
   * be negative (plus handicap) or zero. */
  courseHandicap: number;
}

/**
 * Manual override of a computed Playing Handicap, applied after allowances
 * (Rules of Handicapping 5.6 — the Committee may set the value used for the
 * competition result directly).
 */
export interface PlayingHandicapOverride {
  /** Whole-number Playing Handicap to use instead of the computed value. May
   * be negative (plus handicap) or zero. */
  playingHandicap: number;
}

/**
 * Allowance application step (Rules of Handicapping 5.5 — Playing Handicap =
 * Course Handicap × allowance, rounded to the nearest whole number).
 */
export interface Allowance {
  /**
   * Fraction of the Course Handicap that counts in the competition
   * (0.95 for individual net play, 0.85 for four-ball). Use
   * `fullAllowance()` for 100%.
   */
  fraction: number;
}

/** Computed handicap values for one player on one course/tee. */
export interface HandicapResult {
  /** Unrounded Course Handicap exactly as the formula produces it. */
  courseHandicapExact: number;
  /** Course Handicap rounded to a whole number (.5 rounds up). */
  courseHandicap: number;
  /** Unrounded value the Playing Handicap is rounded from. */
  playingHandicapExact: number;
  /** Playing Handicap rounded to a whole number (.5 rounds up). */
  playingHandicap: number;
}

/** Strokes received per hole, keyed by 1-based hole number. */
export type StrokesByHole = Record<number, number>;

/** Per-hole stroke allocation result for one player. */
export interface StrokeAllocationResult {
  /** Playing Handicap the allocation is derived from. */
  playingHandicap: number;
  /** Stroke index scale used to allocate (1–18, or the 9-hole scale 1–9). */
  strokeIndexScale: number;
  /** Strokes received on each hole (holes with 0 strokes are included with
   * value 0 when the hole is part of the round). */
  strokes: StrokesByHole;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Competition layer (M3-T002): scorecards, formats, tiebreaks, flights,
 * payouts, and side games. Every setting is an explicit input.
 * ──────────────────────────────────────────────────────────────────────── */

/** Strokes actually played on a hole, keyed by hole number. Sparse: a
 * hole missing from the map was not played (picked up / absent). */
export type HoleScores = Record<number, number>;

/** Handicap strokes received on a hole, keyed by hole number (dense over
 * the holes of the round; negative = strokes given back by a plus
 * handicap). */
export type HoleStrokes = Record<number, number>;

/** One hole of a scorecard: course data plus the player's strokes. */
export interface ScorecardHole {
  /** 1-based hole number. */
  holeNumber: number;
  /** Par of the hole. */
  par: number;
  /** Stroke index of the hole. */
  strokeIndex: number;
  /** Strokes played, or `null` when the hole was not played. */
  strokes: number | null;
}

/** One hole of a computed scorecard (after capping and netting). */
export interface ScorecardHoleResult {
  holeNumber: number;
  par: number;
  strokeIndex: number;
  /** Gross strokes after the maximum-score rule (null = not played). */
  strokes: number | null;
  /** Handicap strokes received (negative = given back) on the hole. */
  strokesReceived: number;
  /** Net strokes: capped gross − strokes received (null = not played). */
  netStrokes: number | null;
  /** Capped gross relative to par (null = not played). */
  toPar: number | null;
}

/** Maximum-score rule (Rules of Handicapping 3.3b / Committee policy). */
export type MaxScoreRule =
  | { kind: "none" }
  | { kind: "fixed"; cap: number }
  | { kind: "double_par" }
  | { kind: "net_double_bogey" };

/** Which total a format ranks by (and which totals it reports). */
export type ScoringBasis = "gross" | "net" | "both";

/** One entry of a Stableford point scale. */
export interface StablefordScaleEntry {
  /** Net score relative to par (−2 = two under). */
  toPar: number;
  /** Points for that score. */
  points: number;
}

/** A full Stableford point scale; only the USGA/EGA standard is a code
 * constant (see `STANDARD_STABLEFORD_SCALE`) — every other scale is
 * explicit input. */
export interface StablefordPointScale {
  /** Fixed entries, ordered best-first (lowest `toPar` first). */
  entries: StablefordScaleEntry[];
  /** Additional points per stroke better than the best fixed entry. */
  pointsPerStrokeBetterThanBest: number;
  /** Points per stroke worse than the worst fixed entry (negative). */
  pointsPerStrokeWorseThanWorst: number;
}

/** One hole of a Stableford scorecard. */
export interface StablefordHoleResult extends ScorecardHoleResult {
  /** Stableford points on the hole (null = not played → 0 points). */
  points: number | null;
}

/** USGA card-off breakdown for one participant (last 9 / 6 / 3, then
 * hole-by-hole backwards). */
export interface CardOffBreakdown {
  /** Totals on the last N holes, in comparison order. */
  stages: { lastNHoles: number; total: number }[];
  /** Per-hole scores from the last hole backwards (null = not played). */
  backwards: (number | null)[];
}

/** A flight of a large field. */
export interface Flight {
  /** Display name of the flight (e.g. "A Flight"). */
  name: string;
  /**
   * Inclusive maximum handicap index of the flight; `null` marks the
   * open-top flight that absorbs everyone above the last threshold.
   */
  maxHandicap: number | null;
}

/** A player to place into a flight. */
export interface FlightPlayer {
  id: string;
  /** The handicap measure flight thresholds compare against (Handicap
   * Index or Course Handicap — an explicit caller decision). */
  handicap: number;
  /** Deterministic tie-break key (e.g. `id`) for identical handicaps. */
  sortId: string;
}

/** A player's flight assignment. */
export interface FlightAssignment {
  playerId: string;
  flightName: string;
  /** 0-based flight index in threshold order. */
  flightIndex: number;
}

/** One payout position of a purse split. */
export interface PayoutPosition {
  /** Fraction of the purse for this position (0.5 = 50%). */
  share: number;
}

/** Payout configuration: a purse split across positions. */
export interface PayoutConfig {
  /** Total purse in minor-currency units (cents). */
  purse: number;
  /** Position splits in payout order (position 1 first). */
  positions: PayoutPosition[];
}

/** A payout slot spanned by a tie group. */
export interface PayoutSlot {
  /** 1-based payout slot. */
  slot: number;
  /** Amount assigned to the slot. */
  amount: number;
  /** Share of the purse for the slot (0 beyond the last position). */
  share: number;
}

/** One participant's payout. */
export interface PayoutEntry {
  id: string;
  /** Competition position (1-based; ties share a position). */
  position: number;
  /** Number of participants tied at the position. */
  tieCount: number;
  /** The payout slots the tie group spans. */
  slots: PayoutSlot[];
  /** Combined amount of the spanned slots. */
  combinedAmount: number;
  /** The participant's equal share of the combined amount. */
  amount: number;
}

/** Overall payout computation result. */
export interface PayoutSummary {
  purse: number;
  positions: number;
  entries: PayoutEntry[];
}

/** Variant of a skins game. Calcutta and parimutuel are excluded (C24). */
export type SkinsVariant = "gross" | "net";

/** Configuration of a skins game. */
export interface SkinsConfig {
  variant: SkinsVariant;
  /** Value of one hole in minor-currency units. */
  holeValue: number;
  /** Maximum-score rule applied to hole scores. */
  maxScoreRule: MaxScoreRule;
}

/** One hole of a skins game. */
export interface SkinsHoleResult {
  holeNumber: number;
  par: number;
  /** Winning strokes (net or gross per the variant; null = carried over). */
  winningStrokes: number | null;
  /** Winner of the hole, `null` when carried over. */
  winnerId: string | null;
  /** Value of the pot won on the hole (0 when carried over). */
  potValue: number;
  /** Whether the hole carried over. */
  carriedOver: boolean;
  /** Amount carried into the next hole's pot. */
  carryAmount: number;
}

/** A monetary (or point) value awarded in a side game. */
export interface SideGameValue {
  id: string;
  value: number;
}

/** A skins game result. */
export interface SkinsResult {
  variant: SkinsVariant;
  holeValue: number;
  holeResults: SkinsHoleResult[];
  /** Unawarded value left after the last hole (returned, not scored). */
  leftovers: number;
  /** Total value won per participant. */
  totals: SideGameValue[];
}

/** A measured entry (distance) for a measured side game. */
export interface MeasuredSideGameEntry {
  id: string;
  /** Distance in yards (closest-to-pin, long drive) or feet (longest
   * putt); `null` = no measurement. */
  measurement: number | null;
}

/** Result of a measured side game (CTP / long drive / longest putt). */
export interface MeasuredSideGameResult {
  holeNumber: number;
  /** Winners (equal measurements share the value). */
  winnerIds: string[];
  /** Total value awarded. */
  value: number;
}

/** Per-member handicap metadata of a team standings row. */
export interface TeamMemberStanding {
  id: string;
  playingHandicap: number;
  courseHandicap: number;
  /** Holes of the player's own card completed so far. */
  thru: number;
}

/** A member's handicap contribution to a scramble team. */
export interface ScrambleMemberHandicap {
  id: string;
  /** The member's full Course Handicap. */
  courseHandicap: number;
  /** The allowance-reduced portion that counts toward the team. */
  reducedHandicap: number;
}

/** Stroke-play standings row. */
export interface StrokePlayStanding {
  id: string;
  position: number;
  tied: boolean;
  gross: number;
  net: number;
  playingHandicap: number;
  courseHandicap: number;
  card: ScorecardHoleResult[];
  /** Holes completed. */
  thru: number;
  cardOff: CardOffBreakdown;
}

/** Stableford standings row. */
export interface StablefordStanding {
  id: string;
  position: number;
  tied: boolean;
  points: number;
  gross: number;
  net: number;
  playingHandicap: number;
  courseHandicap: number;
  card: StablefordHoleResult[];
  thru: number;
  cardOff: CardOffBreakdown;
}

/** Scramble standings row. */
export interface ScrambleStanding {
  id: string;
  position: number;
  tied: boolean;
  gross: number;
  net: number;
  /** Team Playing Handicap: sum of members' reduced handicaps. */
  playingHandicap: number;
  members: ScrambleMemberHandicap[];
  card: ScorecardHoleResult[];
  thru: number;
  cardOff: CardOffBreakdown;
}

/** Best-ball / shamble standings row (team total of counted balls). */
export interface BestBallStanding {
  id: string;
  position: number;
  tied: boolean;
  /** Team total: sum of the counted best balls per hole (net or gross
   * per the configured basis). */
  total: number;
  members: TeamMemberStanding[];
  /** Holes on which at least one member posted a score. */
  thru: number;
  cardOff: CardOffBreakdown;
}

/** Shamble standings row (same shape as best ball). */
export type ShambleStanding = BestBallStanding;
