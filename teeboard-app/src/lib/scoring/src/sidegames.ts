/**
 * Side games: skins (gross and net, with carryover on tied holes),
 * closest-to-pin, long drive, and longest putt.
 *
 * Everything is pure and explicit: valuations, carryover behavior, and
 * measurements are inputs; winners come from per-hole scores and measured
 * values only. No Calcutta or parimutuel logic exists here and none may
 * ever be added (constraint C24 — legal risk).
 */
import { capStrokes } from "./scorecard";
import type {
  Hole,
  HoleScores,
  HoleStrokes,
  MeasuredSideGameEntry,
  MeasuredSideGameResult,
  SkinsConfig,
  SkinsHoleResult,
  SkinsResult,
} from "./types";

/** One participant's hole-by-hole entry in a skins game. */
export interface SkinsEntry {
  id: string;
  /** Strokes played per hole (sparse: unplayed holes are absent). */
  scores: HoleScores;
  /** Handicap strokes received per hole (net skins only). */
  strokesByHole?: HoleStrokes;
}

/**
 * Resolve one skin hole from the participants' comparable scores: the
 * unique best score wins the pot; a tie carries the pot over to the next
 * hole (gross and net alike). `null` (not played) never wins.
 *
 * `comparableStrokes` is the already-final score for the variant — capped
 * gross strokes for gross skins, capped net strokes (gross − strokes
 * received) for net skins — so the hole resolution itself never touches
 * handicap math.
 */
export function resolveSkinHole(input: {
  scores: { id: string; comparableStrokes: number | null }[];
}): { winnerId: string | null; winningStrokes: number | null } {
  const played = input.scores.filter(
    (s): s is { id: string; comparableStrokes: number } =>
      s.comparableStrokes !== null,
  );
  if (played.length === 0) {
    return { winnerId: null, winningStrokes: null };
  }
  const best = Math.min(...played.map((s) => s.comparableStrokes));
  const winners = played.filter((s) => s.comparableStrokes === best);
  if (winners.length !== 1) {
    return { winnerId: null, winningStrokes: null };
  }
  return { winnerId: winners[0].id, winningStrokes: best };
}

/**
 * Compute a skins game over the round.
 *
 * - `variant: "gross"` — lowest capped gross strokes wins each hole.
 * - `variant: "net"` — lowest capped net strokes (gross − strokes
 *   received) wins each hole.
 * - Carryover: a tied or scoreless hole rolls its pot into the next hole
 *   (`holeValue` plus everything carried). A carryover chain across any
 *   number of consecutive tied holes accumulates; the first hole with a
 *   unique best score takes the whole pot.
 * - `leftovers` — value still carried after the final hole (unawarded;
 *   what happens to it is a Committee decision, not scoring math).
 */
export function computeSkins(input: {
  config: SkinsConfig;
  holes: Hole[];
  entries: SkinsEntry[];
}): SkinsResult {
  const { config, holes, entries } = input;
  const holeResults: SkinsHoleResult[] = [];
  const wins = new Map<string, number>();
  let carried = 0;

  for (const hole of holes) {
    const perHole = entries.map((entry) => {
      const strokes = entry.scores[hole.holeNumber] ?? null;
      const strokesReceived =
        config.variant === "net"
          ? entry.strokesByHole?.[hole.holeNumber] ?? 0
          : 0;
      const capped =
        strokes === null
          ? null
          : capStrokes(strokes, config.maxScoreRule, hole.par, strokesReceived);
      return {
        id: entry.id,
        comparableStrokes:
          capped === null ? null : capped - strokesReceived,
      };
    });
    const { winnerId, winningStrokes } = resolveSkinHole({
      scores: perHole,
    });
    const potValue = config.holeValue + carried;

    if (winnerId === null) {
      carried += config.holeValue;
      holeResults.push({
        holeNumber: hole.holeNumber,
        par: hole.par,
        winningStrokes: null,
        winnerId: null,
        potValue: 0,
        carriedOver: true,
        carryAmount: potValue,
      });
      continue;
    }
    wins.set(winnerId, (wins.get(winnerId) ?? 0) + potValue);
    holeResults.push({
      holeNumber: hole.holeNumber,
      par: hole.par,
      winningStrokes,
      winnerId,
      potValue,
      carriedOver: false,
      carryAmount: 0,
    });
    carried = 0;
  }

  return {
    variant: config.variant,
    holeValue: config.holeValue,
    holeResults,
    leftovers: carried,
    totals: [...wins.entries()]
      .map(([id, value]) => ({ id, value }))
      .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id)),
  };
}

/**
 * Closest-to-pin: the smallest measured distance wins the value. Only
 * measurements on the designated hole count (the caller supplies the
 * par-3 measurements); equal smallest measurements share the value.
 */
export function computeClosestToPin(input: {
  holeNumber: number;
  value?: number;
  measurements: MeasuredSideGameEntry[];
}): MeasuredSideGameResult | null {
  return lowestMeasurementWins(input);
}

/**
 * Long drive: the largest measured distance wins the value. Equal largest
 * measurements share the value.
 */
export function computeLongDrive(input: {
  holeNumber: number;
  value?: number;
  measurements: MeasuredSideGameEntry[];
}): MeasuredSideGameResult | null {
  return highestMeasurementWins(input);
}

/**
 * Longest putt: the largest measured putt length wins the value. Equal
 * largest measurements share the value.
 */
export function computeLongestPutt(input: {
  holeNumber: number;
  value?: number;
  measurements: MeasuredSideGameEntry[];
}): MeasuredSideGameResult | null {
  return highestMeasurementWins(input);
}

function validMeasurements(
  measurements: MeasuredSideGameEntry[],
): { id: string; measurement: number }[] {
  return measurements
    .map((m) => ({ id: m.id, measurement: m.measurement }))
    .filter(
      (m): m is { id: string; measurement: number } =>
        m.measurement !== null && m.measurement >= 0,
    );
}

function lowestMeasurementWins(input: {
  holeNumber: number;
  value?: number;
  measurements: MeasuredSideGameEntry[];
}): MeasuredSideGameResult | null {
  const valid = validMeasurements(input.measurements);
  if (valid.length === 0) {
    return null;
  }
  const best = Math.min(...valid.map((m) => m.measurement));
  return {
    holeNumber: input.holeNumber,
    winnerIds: valid
      .filter((m) => m.measurement === best)
      .map((m) => m.id),
    value: input.value ?? 0,
  };
}

function highestMeasurementWins(input: {
  holeNumber: number;
  value?: number;
  measurements: MeasuredSideGameEntry[];
}): MeasuredSideGameResult | null {
  const valid = validMeasurements(input.measurements);
  if (valid.length === 0) {
    return null;
  }
  const best = Math.max(...valid.map((m) => m.measurement));
  return {
    holeNumber: input.holeNumber,
    winnerIds: valid
      .filter((m) => m.measurement === best)
      .map((m) => m.id),
    value: input.value ?? 0,
  };
}
