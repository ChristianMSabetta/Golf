/**
 * @teeboard/scoring — the single home of every WHS/USGA scoring computation
 * in TeeBoard. Pure TypeScript: no I/O, no environment reads, no framework,
 * database, or browser APIs.
 *
 * This module (Phase 2, M3-T001) exposes the handicap layer: Course
 * Handicap / Playing Handicap computation and per-hole stroke allocation.
 * Later tasks in this milestone add competition formats, tiebreaks, flights,
 * payouts, and side games on top of these primitives.
 */
export {
  COURSE_HANDICAP_FORMULA_18,
  COURSE_HANDICAP_FORMULA_9,
  NINE_HOLE_CR_PAR_BONUS_ADJUSTMENT,
  NINE_HOLE_HI_CONVERSION_DIVISOR,
  SLOPE_RATING_NEUTRAL,
  HALF_ROUNDS_UP,
  HI_9_TO_18_MULTIPLIER,
  HI_9_TO_18_SMOOTHING,
  NET_COMPETITION_DEFAULT_ALLOWANCE,
  FOUR_BALL_DEFAULT_ALLOWANCE,
  NINE_HOLE_PLAYING_HANDICAP_RULE,
} from "./constants";
export { roundHalfUpAwayFromZero } from "./rounding";
export {
  computeHandicap,
  courseHandicap,
  courseHandicapExact,
  fullAllowance,
  handicapIndex18To9,
  handicapIndex9To18,
} from "./handicap";
export { allocateStrokes } from "./strokes";
export type {
  Allowance,
  Course,
  CourseHandicapOverride,
  HandicapResult,
  Hole,
  HoleCount,
  PlayingHandicapOverride,
  StrokesByHole,
  StrokeAllocationResult,
  StrokeIndexSelectionMode,
  TeeRating,
} from "./types";
