/**
 * Course fixtures for the lib/scoring verification suite.
 *
 * Handicaps, ratings, pars, and stroke indices are plain data: every
 * expected value in the suite is computed by hand from these fixtures
 * and the published formula cited in each case (see README.md → "WHS
 * verification policy"). Nothing here reads the environment.
 */
import type { Course } from "../src";

/**
 * Par-72 championship 18-hole course. Both nines are par 36 and the
 * stroke indices 1–18 are each used exactly once, scattered as a real
 * card is.
 */
export const CHAMPIONSHIP_18: Course = {
  holes: 18,
  par: 72,
  holeList: [
    { holeNumber: 1, par: 4, strokeIndex: 7 },
    { holeNumber: 2, par: 5, strokeIndex: 3 },
    { holeNumber: 3, par: 4, strokeIndex: 11 },
    { holeNumber: 4, par: 3, strokeIndex: 13 },
    { holeNumber: 5, par: 4, strokeIndex: 1 },
    { holeNumber: 6, par: 4, strokeIndex: 17 },
    { holeNumber: 7, par: 3, strokeIndex: 15 },
    { holeNumber: 8, par: 5, strokeIndex: 5 },
    { holeNumber: 9, par: 4, strokeIndex: 9 },
    { holeNumber: 10, par: 4, strokeIndex: 8 },
    { holeNumber: 11, par: 3, strokeIndex: 16 },
    { holeNumber: 12, par: 5, strokeIndex: 2 },
    { holeNumber: 13, par: 4, strokeIndex: 14 },
    { holeNumber: 14, par: 4, strokeIndex: 10 },
    { holeNumber: 15, par: 3, strokeIndex: 18 },
    { holeNumber: 16, par: 4, strokeIndex: 6 },
    { holeNumber: 17, par: 5, strokeIndex: 12 },
    { holeNumber: 18, par: 4, strokeIndex: 4 },
  ],
  tees: {
    white: { courseRating: 71.2, slopeRating: 128 },
    blue: { courseRating: 73.5, slopeRating: 140 },
    red: { courseRating: 68.4, slopeRating: 118 },
    gold: { courseRating: 69.5, slopeRating: 113 },
  },
};

/**
 * Par-36 9-hole course with a dedicated 1–9 stroke index scale (the
 * 9-hole layout Rules of Handicapping 5.2 / Appendix E describe).
 */
export const EXECUTIVE_9: Course = {
  holes: 9,
  par: 36,
  holeList: [
    { holeNumber: 1, par: 4, strokeIndex: 5 },
    { holeNumber: 2, par: 4, strokeIndex: 3 },
    { holeNumber: 3, par: 3, strokeIndex: 8 },
    { holeNumber: 4, par: 5, strokeIndex: 9 },
    { holeNumber: 5, par: 4, strokeIndex: 1 },
    { holeNumber: 6, par: 4, strokeIndex: 7 },
    { holeNumber: 7, par: 3, strokeIndex: 2 },
    { holeNumber: 8, par: 5, strokeIndex: 6 },
    { holeNumber: 9, par: 4, strokeIndex: 4 },
  ],
  tees: {
    white: { courseRating: 35.1, slopeRating: 121 },
  },
};

/**
 * The back nine of CHAMPIONSHIP_18 as a standalone 9-hole round: the
 * holes keep their 18-hole stroke indices (a mix of low and high
 * values), so `StrokeIndexSelectionMode` decides how ranks map.
 */
export const BACK_NINE: Course = {
  holes: 9,
  par: 36,
  holeList: CHAMPIONSHIP_18.holeList.slice(9).map((hole, i) => ({
    ...hole,
    holeNumber: i + 1,
  })),
  tees: {
    white: { courseRating: 35.2, slopeRating: 118 },
  },
};

/**
 * Flat par-72 18-hole course (every hole par 4, stroke index = hole
 * number): the shape that keeps per-hole allocation in the format and
 * tiebreak cases trivial to verify by hand.
 */
export const FLAT_18: Course = {
  holes: 18,
  par: 72,
  holeList: Array.from({ length: 18 }, (_, i) => ({
    holeNumber: i + 1,
    par: 4,
    strokeIndex: i + 1,
  })),
  tees: {
    white: { courseRating: 71.2, slopeRating: 128 },
  },
};

/**
 * The front nine of CHAMPIONSHIP_18 as a standalone 9-hole round
 * (18-hole stroke indices 7, 3, 11, 13, 1, 17, 15, 5, 9 on holes 1–9).
 */
export const FRONT_NINE: Course = {
  holes: 9,
  par: 36,
  holeList: CHAMPIONSHIP_18.holeList.slice(0, 9).map((hole, i) => ({
    ...hole,
    holeNumber: i + 1,
  })),
  tees: {
    white: { courseRating: 35.8, slopeRating: 117 },
  },
};

/**
 * 9-hole course whose holes carry a *mix* of the 18-hole scale: SIs
 * 1–9 and 10–18 both appear. Under a re-ranking mode ("front"/"back")
 * each hole maps onto the 9-hole scale by its own SI, so every hole
 * stays in range; under "full" the scale is 18 and holes keep their
 * raw ranks.
 */
export const MIXED_NINE: Course = {
  holes: 9,
  par: 36,
  holeList: [
    { holeNumber: 1, par: 4, strokeIndex: 3 },
    { holeNumber: 2, par: 4, strokeIndex: 12 },
    { holeNumber: 3, par: 3, strokeIndex: 17 },
    { holeNumber: 4, par: 5, strokeIndex: 1 },
    { holeNumber: 5, par: 4, strokeIndex: 9 },
    { holeNumber: 6, par: 4, strokeIndex: 14 },
    { holeNumber: 7, par: 3, strokeIndex: 6 },
    { holeNumber: 8, par: 5, strokeIndex: 18 },
    { holeNumber: 9, par: 4, strokeIndex: 7 },
  ],
  tees: {
    white: { courseRating: 34.9, slopeRating: 113 },
  },
};
