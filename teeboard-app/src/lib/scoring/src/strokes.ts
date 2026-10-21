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
 * A player with Playing Handicap `ph` receives:
 *
 * - one stroke on each of the `scale` holes ranked 1..min(ph, scale) for ph ≥ 1,
 * - plus a second stroke on holes ranked 1..ph − scale when ph > scale
 *   (e.g. a 24 handicap gets two strokes on holes ranked 1–6),
 * - and a plus handicap (ph < 0) *gives* |ph| strokes, applied as negative
 *   allocation on the holes ranked 1..|ph| — the hardest-ranked holes that
 *   receive the adjustment first.
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
      // First stroke on every hole ranked ≤ min(ph, scale) …
      if (rank <= Math.min(playingHandicap, scale)) {
        allocated += 1;
      }
      // … plus an additional stroke on holes ranked ≤ ph − scale.
      if (playingHandicap > scale && rank <= playingHandicap - scale) {
        allocated += 1;
      }
    } else if (playingHandicap < 0) {
      // Plus handicap: a stroke given back on the holes ranked 1..|ph|.
      if (rank <= -playingHandicap) {
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
