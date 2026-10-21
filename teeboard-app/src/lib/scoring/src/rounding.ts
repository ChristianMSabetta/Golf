/**
 * WHS rounding rules (Rules of Handicapping 5.1/5.2/5.5 note):
 * whole-number handicaps are rounded to the nearest whole number, and a
 * value ending in exactly .5 is rounded up (away from zero), so 12.5 → 13
 * and −0.5 → −1.
 */

/** Round a value to the nearest whole number, .5 up (away from zero). */
export function roundHalfUpAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}
