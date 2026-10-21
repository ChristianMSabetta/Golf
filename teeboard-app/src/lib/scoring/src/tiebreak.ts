/**
 * USGA card-off tiebreak methods (USGA "How to Compete Equitably /
 * Recommendations to Committees when a stroke-play competition is tied"):
 * compare the last 9 holes, then the last 6, then the last 3, then
 * hole-by-hole from the last hole backwards until a difference is found.
 *
 * Works identically for individuals (the player's per-hole scores) and
 * teams (the team's combined per-hole score — best-ball or scramble
 * totals, provided by the format layer): the comparison only ever sees a
 * per-hole score sequence.
 */
import { CARD_OFF_LAST_HOLES_STAGES } from "./constants";
import type { CardOffBreakdown, HoleScores } from "./types";

/** Sum of the scores on the last `n` holes of the round order. Unplayed
 * holes count as +Infinity (an incomplete card loses a card-off
 * deterministically, never randomly). */
export function lastNHolesTotal(
  perHoleScores: HoleScores,
  holeOrder: number[],
  n: number,
): number {
  const lastN = holeOrder.slice(-n);
  return lastN.reduce((sum, holeNumber) => {
    const score = perHoleScores[holeNumber];
    return score === undefined ? Number.POSITIVE_INFINITY : sum + score;
  }, 0);
}

/**
 * Full card-off breakdown for one participant: totals on the last 9, 6,
 * and 3 holes plus the per-hole scores read backwards from the last hole.
 * The first stage where the totals differ decides the winner; if nothing
 * differs the participants are genuinely tied (shared position).
 */
export function cardOffBreakdown(
  perHoleScores: HoleScores,
  holeOrder: number[],
): CardOffBreakdown {
  const stages = CARD_OFF_LAST_HOLES_STAGES.map((n) => ({
    lastNHoles: n,
    total: lastNHolesTotal(perHoleScores, holeOrder, n),
  }));
  const backwards = [...holeOrder].reverse().map(
    (holeNumber) => perHoleScores[holeNumber] ?? null,
  );
  return { stages, backwards };
}

/**
 * Card-off comparison (lower wins): −1 when `a` wins, 1 when `b` wins, 0
 * when the cards are identical through every stage — a genuine tie.
 *
 * Stages in order: total (already equal when used as a tiebreak), last 9,
 * last 6, last 3, then hole-by-hole from the last hole backwards.
 */
export function compareCardOff(
  a: CardOffBreakdown,
  b: CardOffBreakdown,
): number {
  for (let i = 0; i < Math.min(a.stages.length, b.stages.length); i++) {
    const ta = a.stages[i].total;
    const tb = b.stages[i].total;
    // Infinity === Infinity (both sides have unplayed holes in the
    // stage) skips to the next stage; a partial stage total (Infinity)
    // loses to a complete one — the comparison never sees
    // Infinity − Infinity = NaN.
    if (ta !== tb) {
      return Number.isFinite(ta) ? (Number.isFinite(tb) ? (ta < tb ? -1 : 1) : -1) : 1;
    }
  }
  const len = Math.min(a.backwards.length, b.backwards.length);
  for (let i = 0; i < len; i++) {
    const sa = a.backwards[i];
    const sb = b.backwards[i];
    if (sa === null && sb === null) {
      continue;
    }
    if (sa === null) {
      return 1;
    }
    if (sb === null) {
      return -1;
    }
    if (sa !== sb) {
      return sa < sb ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Rank participants by card-off and return the order with tie positions
 * resolved deterministically. Input participants carry their per-hole
 * score sequence (individual scores or team combined totals).
 *
 * Returns entries sorted best-first with a 1-based dense `rank`: entries
 * sharing a rank have identical cards through every stage (a genuine
 * tie). `result` labels each entry against its predecessor: `"decided"`
 * starts a new rank, `"tied"` shares the previous entry's rank.
 */
export function breakTiesByCardOff(input: {
  holeOrder: number[];
  participants: { id: string; perHoleScores: HoleScores }[];
}): {
  id: string;
  rank: number;
  result: "decided" | "tied";
  breakdown: CardOffBreakdown;
}[] {
  const { holeOrder, participants } = input;
  const withBreakdown = participants
    .map((p) => ({
      id: p.id,
      breakdown: cardOffBreakdown(p.perHoleScores, holeOrder),
    }))
    .sort((x, y) => compareCardOff(x.breakdown, y.breakdown));

  let rank = 0;
  let previous: { id: string; breakdown: CardOffBreakdown } | null = null;
  return withBreakdown.map((entry) => {
    const tied =
      previous !== null &&
      compareCardOff(previous.breakdown, entry.breakdown) === 0;
    if (!tied) {
      rank += 1;
    }
    previous = entry;
    return {
      id: entry.id,
      rank,
      result: (tied ? "tied" : "decided") as "decided" | "tied",
      breakdown: entry.breakdown,
    };
  });
}
