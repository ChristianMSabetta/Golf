/**
 * Per-player scorecard layer: gross/net strokes per hole under a
 * maximum-score rule (Rules of Handicapping 3.3b — Maximum Score / net
 * double bogey). All format standings are built from these per-hole
 * results.
 */
import { NET_DOUBLE_BOGEY_STROKES_OVER_PAR } from "./constants";
import type {
  HoleScores,
  HoleStrokes,
  MaxScoreRule,
  ScorecardHole,
  ScorecardHoleResult,
} from "./types";

/**
 * Maximum-score cap for one hole under a rule.
 *
 * - `"none"` — no cap.
 * - `"fixed"` — a Committee-set stroke cap (e.g. 6, 8, 10).
 * - `"double_par"` — par doubled.
 * - `"net_double_bogey"` — Rules of Handicapping 3.3b: par + 2 + strokes
 *   received on the hole (the WHS default Maximum Score).
 */
export function maxScoreCap(
  rule: MaxScoreRule,
  par: number,
  strokesReceived: number,
): number | null {
  switch (rule.kind) {
    case "none":
      return null;
    case "fixed":
      return rule.cap;
    case "double_par":
      return par * 2;
    case "net_double_bogey":
      return par + NET_DOUBLE_BOGEY_STROKES_OVER_PAR + strokesReceived;
  }
}

/**
 * Apply a maximum-score rule to one played score: the capped strokes for
 * the hole. Unplayed holes (`null`) are never capped — the caller decides
 * what a pick-up means for the format (a net-double-bogey default is
 * applied there, not here).
 */
export function capStrokes(
  strokes: number,
  rule: MaxScoreRule,
  par: number,
  strokesReceived: number,
): number {
  const cap = maxScoreCap(rule, par, strokesReceived);
  return cap === null ? strokes : Math.min(strokes, cap);
}

/**
 * Default score for an unplayed hole under a maximum-score rule: the cap
 * itself (Rules of Handicapping 3.3b — a player who does not complete a
 * hole records the most likely score, capped by the Maximum Score;
 * `"none"` leaves the hole unrecorded).
 */
export function pickupScore(
  rule: MaxScoreRule,
  par: number,
  strokesReceived: number,
): number | null {
  return maxScoreCap(rule, par, strokesReceived);
}

/**
 * Compute the per-hole scorecard for one player under a maximum-score
 * rule. `strokesByHole` is the player's stroke allocation for the round
 * (from `allocateStrokes`, keyed by hole number).
 *
 * Per hole: capped gross strokes, strokes received, net strokes
 * (gross − strokes received), and score relative to par. Unplayed holes
 * keep `null` throughout.
 */
export function computeScorecard(input: {
  holes: ScorecardHole[];
  strokesByHole: HoleStrokes;
  maxScoreRule: MaxScoreRule;
}): ScorecardHoleResult[] {
  const { holes, strokesByHole, maxScoreRule } = input;
  return holes.map((hole) => {
    const strokes = hole.strokes;
    const received = strokesByHole[hole.holeNumber] ?? 0;
    if (strokes === null) {
      return {
        holeNumber: hole.holeNumber,
        par: hole.par,
        strokeIndex: hole.strokeIndex,
        strokes: null,
        strokesReceived: received,
        netStrokes: null,
        toPar: null,
      };
    }
    const applied = capStrokes(strokes, maxScoreRule, hole.par, received);
    return {
      holeNumber: hole.holeNumber,
      par: hole.par,
      strokeIndex: hole.strokeIndex,
      strokes: applied,
      strokesReceived: received,
      netStrokes: applied - received,
      toPar: applied - hole.par,
    };
  });
}

/** Sum of played gross strokes on a scorecard. */
export function totalGross(card: ScorecardHoleResult[]): number {
  return card.reduce(
    (sum, h) => (h.strokes === null ? sum : sum + h.strokes),
    0,
  );
}

/** Sum of played net strokes on a scorecard. */
export function totalNet(card: ScorecardHoleResult[]): number {
  return card.reduce(
    (sum, h) => (h.netStrokes === null ? sum : sum + h.netStrokes),
    0,
  );
}

/**
 * Convert a raw scorecard into a sparse `HoleScores` map (played holes
 * only) — the input shape the formats, skins, and side games consume.
 */
export function toHoleScores(card: ScorecardHole[]): HoleScores {
  const out: HoleScores = {};
  for (const h of card) {
    if (h.strokes !== null) {
      out[h.holeNumber] = h.strokes;
    }
  }
  return out;
}
