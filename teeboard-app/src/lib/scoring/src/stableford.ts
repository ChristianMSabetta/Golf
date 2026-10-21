/**
 * Stableford scoring (Rules of Golf / Appendix I C: Stroke Play — Stableford
 * Points): points per hole from the net score relative to par under a
 * configurable point scale. Only the USGA/EGA standard scale is a code
 * constant; every other scale is explicit input (Risks: only WHS defaults
 * belong in code).
 */
import type {
  MaxScoreRule,
  ScorecardHole,
  StablefordHoleResult,
  StablefordPointScale,
} from "./types";
import { computeScorecard } from "./scorecard";
import type { HoleStrokes } from "./types";

/**
 * The USGA/EGA standard Stableford point scale (EGA Stableford): 8 points
 * albatross, 5 eagle, 2 birdie, 0 par, −1 bogey, −2 double bogey, −3
 * triple or worse. Local variations (e.g. 1/2/3/4 middy scales) are
 * configurable input, never assumed.
 */
export const STANDARD_STABLEFORD_SCALE: StablefordPointScale = {
  entries: [
    { toPar: -3, points: 8 },
    { toPar: -2, points: 5 },
    { toPar: -1, points: 2 },
    { toPar: 0, points: 0 },
    { toPar: 1, points: -1 },
    { toPar: 2, points: -2 },
  ],
  pointsPerStrokeBetterThanBest: 2,
  pointsPerStrokeWorseThanWorst: -1,
};

/**
 * Stableford points for one hole from the net score relative to par
 * (net strokes − par).
 *
 * - Beyond the best fixed entry (−3): `pointsPerStrokeBetterThanBest`
 *   additional points per further stroke under (a hole-in-one on a par 4
 *   is −4 → 10 points).
 * - Beyond the worst fixed entry (2): `pointsPerStrokeWorseThanWorst`
 *   per further stroke over (triple+ = −3 and steeper).
 * - `null` (not played): no points — the hole scores zero under a
 *   Maximum Score rule and the caller decides the pickup value.
 */
export function stablefordPointsForHole(
  netToPar: number | null,
  scale: StablefordPointScale = STANDARD_STABLEFORD_SCALE,
): number | null {
  if (netToPar === null) {
    return null;
  }
  const best = scale.entries[0];
  if (netToPar <= best.toPar) {
    return (
      best.points +
      (best.toPar - netToPar) * scale.pointsPerStrokeBetterThanBest
    );
  }
  const worst = scale.entries[scale.entries.length - 1];
  if (netToPar >= worst.toPar) {
    return (
      worst.points +
      (netToPar - worst.toPar) * scale.pointsPerStrokeWorseThanWorst
    );
  }
  const entry = scale.entries.find((e) => e.toPar === netToPar);
  return entry ? entry.points : 0;
}

/**
 * Full Stableford scorecard for one player: net strokes per hole under the
 * maximum-score rule, converted to points under the point scale. Unplayed
 * holes score zero points (`null`).
 */
export function computeStablefordScorecard(input: {
  holes: ScorecardHole[];
  strokesByHole: HoleStrokes;
  maxScoreRule: MaxScoreRule;
  scale?: StablefordPointScale;
}): StablefordHoleResult[] {
  const gross = computeScorecard(input);
  const scale = input.scale ?? STANDARD_STABLEFORD_SCALE;
  return gross.map((hole) => ({
    ...hole,
    // Points come from the NET score relative to par (net strokes − par),
    // so handicap strokes received (and strokes given back by a plus
    // handicap) count before the point scale applies.
    points: stablefordPointsForHole(
      hole.netStrokes === null ? null : hole.netStrokes - hole.par,
      scale,
    ),
  }));
}

/** Total Stableford points on a card (unplayed holes add zero). */
export function totalStablefordPoints(
  card: StablefordHoleResult[],
): number {
  return card.reduce(
    (sum, h) => (h.points === null ? sum : sum + h.points),
    0,
  );
}
