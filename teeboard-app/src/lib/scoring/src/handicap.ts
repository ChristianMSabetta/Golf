/**
 * WHS handicap layer: Course Handicap and Playing Handicap computation plus
 * Handicap Index conversions for 9-hole play. All formulas transcribe the
 * published Rules of Handicapping clauses recorded in `constants.ts`.
 */
import {
  HI_9_TO_18_MULTIPLIER,
  HI_9_TO_18_SMOOTHING,
  NINE_HOLE_HI_CONVERSION_DIVISOR,
  SLOPE_RATING_NEUTRAL,
} from "./constants";
import { roundHalfUpAwayFromZero } from "./rounding";
import type {
  Allowance,
  Course,
  CourseHandicapOverride,
  HandicapResult,
  PlayingHandicapOverride,
  TeeRating,
} from "./types";

/** Convert an 18-hole Handicap Index to its 9-hole value:
 * Rules of Handicapping 5.2 — HI9 = HI18 ÷ 2. */
export function handicapIndex18To9(handicapIndex18: number): number {
  return handicapIndex18 / NINE_HOLE_HI_CONVERSION_DIVISOR;
}

/** Convert a 9-hole Handicap Index to its 18-hole value:
 * Rules of Handicapping 5.2 — HI18 = (HI9 × 2) + 0.4. */
export function handicapIndex9To18(handicapIndex9: number): number {
  return handicapIndex9 * HI_9_TO_18_MULTIPLIER + HI_9_TO_18_SMOOTHING;
}

/** The standard 100% allowance (Rules of Handicapping 5.5 — gross and
 * maximum-score formats use the full Course Handicap). */
export function fullAllowance(): Allowance {
  return { fraction: 1 };
}

/**
 * Course Handicap (Rules of Handicapping 5.1 for 18 holes, 5.2 for 9 holes),
 * unrounded:
 *
 * - 18 holes: HI × (SR ÷ 113) + (CR − par)
 * - 9 holes:  HI × (SR ÷ 113) + (CR9 − par9) − 0.5
 *
 * Plus (better-than-scratch) players are simply negative values; the same
 * formula applies unchanged.
 */
export function courseHandicapExact(
  handicapIndex: number,
  course: Course,
  tee: TeeRating,
): number {
  const slopeTerm =
    (handicapIndex * tee.slopeRating) / SLOPE_RATING_NEUTRAL;
  const crParAdjustment =
    tee.courseRating - course.par + (course.holes === 9 ? -0.5 : 0);
  return slopeTerm + crParAdjustment;
}

/**
 * Course Handicap rounded to a whole number (.5 rounds up — Rules of
 * Handicapping 5.1/5.2). A Committee override (Rules of Handicapping 5.6)
 * replaces the computed value entirely.
 */
export function courseHandicap(
  handicapIndex: number,
  course: Course,
  tee: TeeRating,
  override?: CourseHandicapOverride,
): number {
  if (override) {
    return override.courseHandicap;
  }
  return roundHalfUpAwayFromZero(
    courseHandicapExact(handicapIndex, course, tee),
  );
}

/**
 * Full handicap pipeline for one player on one course/tee:
 *
 * 1. Course Handicap — 5.1/5.2, with optional Committee override (5.6)
 *    applied here.
 * 2. Playing Handicap — 5.5: Course Handicap × allowance, rounded to a
 *    whole number (.5 rounds up), with an optional Committee override
 *    applied last.
 *
 * The returned `HandicapResult` also carries both exact values so callers
 * (leaderboards, cards, PDF) can display or verify without recomputation.
 */
export function computeHandicap(input: {
  handicapIndex: number;
  course: Course;
  tee: TeeRating;
  allowance: Allowance;
  courseHandicapOverride?: CourseHandicapOverride;
  playingHandicapOverride?: PlayingHandicapOverride;
}): HandicapResult {
  const { handicapIndex, course, tee, allowance } = input;

  const chExact = courseHandicapExact(handicapIndex, course, tee);
  const ch = input.courseHandicapOverride
    ? input.courseHandicapOverride.courseHandicap
    : roundHalfUpAwayFromZero(chExact);

  const phExact = ch * allowance.fraction;
  const ph = input.playingHandicapOverride
    ? input.playingHandicapOverride.playingHandicap
    : roundHalfUpAwayFromZero(phExact);

  return {
    courseHandicapExact: chExact,
    courseHandicap: ch,
    playingHandicapExact: phExact,
    playingHandicap: ph,
  };
}
