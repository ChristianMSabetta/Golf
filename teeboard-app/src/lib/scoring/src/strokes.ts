/**
 * Per-hole stroke allocation from a Playing Handicap and the course's stroke
 * index (Rules of Handicapping 3.3 / Appendix E, CONGU® Guidance — see
 * README.md → "WHS verification policy").
 */
import type {
  Course,
  Hole,
  StrokeAllocationResult,
  StrokeIndexSelectionMode,
} from "./types";

/**
 * The stroke index scale a round's holes are ranked on.
 *
 * - 18-hole round → 18.
 * - 9-hole round with 9-hole stroke indices (1–9) → 9.
 * - 9-hole round ranked against the full 18-hole scale depends on the mode:
 *   `"full"` → 18, `"front"`/`"back"` → 9.
 */
function strokeIndexScale(
  course: Course,
  mode: StrokeIndexSelectionMode,
): number {
  if (course.holes === 18) {
    return 18;
  }
  const maxIndex = Math.max(
    ...course.holeList.map((hole) => hole.strokeIndex),
    0,
  );
  if (maxIndex > 9) {
    return mode === "full" ? 18 : 9;
  }
  return 9;
}

/**
 * Rank of a hole within the scale (1 = first hole receiving a stroke).
 * Returns `null` when the hole is outside the selected nine — a 9-hole
 * round can only use the part of an 18-hole stroke index scale that
 * belongs to its holes.
 */
function holeRank(
  hole: Hole,
  scale: number,
  mode: StrokeIndexSelectionMode,
): number | null {
  let rank: number;
  if (hole.strokeIndex <= scale) {
    rank = hole.strokeIndex;
  } else if (mode === "front" || mode === "back") {
    // 9-hole round using one nine of the 18-hole scale: re-rank that
    // nine's stroke indices (10–18) onto the 9-hole scale (1–9).
    rank = hole.strokeIndex - 9;
  } else {
    rank = hole.strokeIndex;
  }
  if (rank < 1 || rank > scale) {
    return null;
  }
  return rank;
}

/**
 * Allocate strokes received per hole for one player.
 *
 * A player with Playing Handicap `ph` receives `ph` strokes distributed
 * over the scale in complete passes — one stroke on each hole per pass,
 * from rank 1 (the hole that receives a stroke first) — with the
 * remainder going to the lowest-ranked holes:
 *
 * - ph ≤ scale: one stroke on holes ranked 1..ph.
 * - scale < ph ≤ 2×scale: one on every hole plus a second on ranks
 *   1..ph − scale (e.g. a 24 on an 18-scale gets two on ranks 1–6).
 * - beyond that the passes keep cycling: a 40 gets two on every hole
 *   plus a third on ranks 1–4 (Rules of Handicapping 3.3 / Appendix E —
 *   strokes are allocated against the stroke index, whatever its size).
 * - a plus handicap (ph < 0) gives |ph| strokes back by the same
 *   cycling, as a negative allocation.
 *
 * For 9-hole rounds the `mode` controls which part of an 18-hole stroke
 * index scale applies (see `StrokeIndexSelectionMode`); holes carrying an
 * 18-hole stroke index outside the selected nine are excluded (rank null).
 */
export function allocateStrokes(
  playingHandicap: number,
  course: Course,
  mode: StrokeIndexSelectionMode = "full",
): StrokeAllocationResult {
  const scale = strokeIndexScale(course, mode);
  const strokes: Record<number, number> = {};

  for (const hole of course.holeList) {
    const rank = holeRank(hole, scale, mode);
    if (rank === null) {
      continue;
    }
    let allocated = 0;
    if (playingHandicap > 0) {
      // Full stroke on every hole per complete pass over the scale …
      const fullPasses = Math.floor(playingHandicap / scale);
      allocated += fullPasses;
      // … plus one more on each hole ranked ≤ the remainder (Rules of
      // Handicapping 3.3 / Appendix E: strokes cycle through the stroke
      // index from rank 1, so a 40 on an 18-scale gets 2 + ranks 1–4).
      const remainder = playingHandicap - fullPasses * scale;
      if (rank <= remainder) {
        allocated += 1;
      }
    } else if (playingHandicap < 0) {
      // Plus handicap: full strokes given back per complete pass, plus
      // one more on each hole ranked ≤ the remainder (symmetric).
      const fullPasses = Math.floor(-playingHandicap / scale);
      allocated -= fullPasses;
      const remainder = -playingHandicap - fullPasses * scale;
      if (rank <= remainder) {
        allocated -= 1;
      }
    }
    strokes[hole.holeNumber] = allocated;
  }

  return {
    playingHandicap,
    strokeIndexScale: scale,
    strokes,
  };
}
