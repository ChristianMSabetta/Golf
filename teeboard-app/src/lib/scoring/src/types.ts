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
