/**
 * WHS formula reference constants.
 *
 * Every value the World Handicap System formulas depend on is named here so
 * the arithmetic in `handicap.ts` and `strokes.ts` is a literal transcription
 * of the published Rules of Handicapping (see README.md → "WHS verification
 * policy" for the source list and the change procedure). Each constant records
 * the rule clause it derives from.
 */

/** Rules of Handicapping 5.1 — standard slope rating of a course of standard
 * difficulty; the divisor of every Course Handicap formula. */
export const SLOPE_RATING_NEUTRAL = 113;

/** Rules of Handicapping 5.1 — Course Handicap (18 holes), unrounded:
 * HI × (SR ÷ 113) + (CR − par). Rounded to the nearest whole number
 * (.5 rounds up) when a whole-number value is required. */
export const COURSE_HANDICAP_FORMULA_18 = {
  slopeDivisor: SLOPE_RATING_NEUTRAL,
  crParAdjustment: "CR − par",
} as const;

/** Rules of Handicapping 5.2 — Course Handicap (9 holes), unrounded:
 * HI × (SR ÷ 113) + (CR − par) − 0.5, using the 9-hole CR (CR9), the
 * 9-hole slope rating, and the 9-hole par. Rounded to the nearest whole
 * number (.5 rounds up) when a whole-number value is required. */
export const NINE_HOLE_CR_PAR_BONUS_ADJUSTMENT = 0.5;
export const COURSE_HANDICAP_FORMULA_9 = {
  slopeDivisor: SLOPE_RATING_NEUTRAL,
  crParAdjustment: "CR9 − par9",
  bonusAdjustment: -NINE_HOLE_CR_PAR_BONUS_ADJUSTMENT,
} as const;

/** Rules of Handicapping 5.1 note (half-way rounding): when a value ends in
 * .5, it is rounded **up** (away from zero for plus handicaps), e.g. 12.5 →
 * 13 and −0.5 → −1. */
export const HALF_ROUNDS_UP = "half-up-away-from-zero" as const;

/** Rules of Handicapping 5.2 — converting an 18-hole Handicap Index for
 * 9-hole play: the 9-hole Handicap Index is the 18-hole index ÷ 2. */
export const NINE_HOLE_HI_CONVERSION_DIVISOR = 2;

/**
 * Rules of Handicapping 5.3 — converting a 9-hole Handicap Index to an
 * 18-hole value: HI9 × 2 + 0.4 (the dashed line between the nines in the
 * Score Record).
 */
export const HI_9_TO_18_MULTIPLIER = 2;
export const HI_9_TO_18_SMOOTHING = 0.4;

/** Rules of Handicapping 5.5 — the standard allowance default for
 * individual net competitions. */
export const NET_COMPETITION_DEFAULT_ALLOWANCE = 0.95;

/** Rules of Handicapping 5.5 — the standard allowance default for
 * four-ball formats. */
export const FOUR_BALL_DEFAULT_ALLOWANCE = 0.85;

/** Rules of Handicapping Appendix E — for 9-hole net competitions the
 * Playing Handicap is computed from the 9-hole Course Handicap exactly as
 * in 5.5 (no special-case formula). Recorded so the 9-hole path is an
 * explicit, documented decision. */
export const NINE_HOLE_PLAYING_HANDICAP_RULE = "Appendix E — same as 5.5" as const;
