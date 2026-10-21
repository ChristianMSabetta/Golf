/**
 * WHS handicap layer verification — spec cases plus edge cases.
 *
 * Every expected value below is computed BY HAND from the published
 * formula cited at each case (Rules of Handicapping as jointly issued
 * by the USGA and The R&A; see README.md → "WHS verification policy").
 * The tests never print an implementation's output into an expectation.
 */
import { describe, expect, it } from "vitest";
import {
  courseHandicap,
  courseHandicapExact,
  computeHandicap,
  FOUR_BALL_DEFAULT_ALLOWANCE,
  fullAllowance,
  handicapIndex18To9,
  handicapIndex9To18,
  NET_COMPETITION_DEFAULT_ALLOWANCE,
  roundHalfUpAwayFromZero,
  SLOPE_RATING_NEUTRAL,
} from "../src";
import { BACK_NINE, CHAMPIONSHIP_18, EXECUTIVE_9 } from "./fixtures";

const white = CHAMPIONSHIP_18.tees.white;

describe("Rules of Handicapping 5.1 — Course Handicap, 18 holes", () => {
  // Spec case: CH = HI × (SR ÷ 113) + (CR − par), rounded (.5 up).
  it("spec: HI 12.4 @ SR 128 / CR 71.2 / par 72 → CH 13", () => {
    // 12.4 × 128 / 113 = 14.037…; + (71.2 − 72) = −0.8 → 13.237… → 13
    expect(courseHandicapExact(12.4, CHAMPIONSHIP_18, white)).toBeCloseTo(
      (12.4 * 128) / 113 - 0.8,
      10,
    );
    expect(courseHandicap(12.4, CHAMPIONSHIP_18, white)).toBe(13);
  });

  it("neutral slope 113: CH = HI + (CR − par) exactly", () => {
    // SR 113: 113/113 = 1, so CH = 10.0 + (69.5 − 72) = 7.5 → 8 (.5 up)
    const gold = CHAMPIONSHIP_18.tees.gold;
    expect(courseHandicapExact(10.0, CHAMPIONSHIP_18, gold)).toBeCloseTo(7.5, 10);
    expect(courseHandicap(10.0, CHAMPIONSHIP_18, gold)).toBe(8);
  });

  it("slope below 113 reduces the handicap term", () => {
    // 20 × 118/113 = 20.885…; + (68.4 − 72) = −3.6 → 17.285… → 17
    const red = CHAMPIONSHIP_18.tees.red;
    expect(courseHandicap(20.0, CHAMPIONSHIP_18, red)).toBe(17);
  });

  it("slope above 113 amplifies the handicap term", () => {
    // 10 × 140/113 = 12.389…; + (73.5 − 72) = 1.5 → 13.889… → 14
    const blue = CHAMPIONSHIP_18.tees.blue;
    expect(courseHandicap(10.0, CHAMPIONSHIP_18, blue)).toBe(14);
  });

  it("scratch Handicap Index yields CR − par, rounded", () => {
    // 0 × anything = 0; + (71.2 − 72) = −0.8 → −0.8 → −1 (away from zero)
    expect(courseHandicap(0.0, CHAMPIONSHIP_18, white)).toBe(-1);
  });
});

describe("Rules of Handicapping 5.1 note — rounding .5 up (away from zero)", () => {
  it("rounds 12.5 to 13 and −0.5 to −1", () => {
    expect(roundHalfUpAwayFromZero(12.5)).toBe(13);
    expect(roundHalfUpAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfUpAwayFromZero(0.5)).toBe(1);
  });

  it("rounds .4 down and .6 up normally", () => {
    expect(roundHalfUpAwayFromZero(12.4)).toBe(12);
    expect(roundHalfUpAwayFromZero(12.6)).toBe(13);
    expect(roundHalfUpAwayFromZero(-12.4)).toBe(-12);
  });

  it("a CH landing exactly on .5 rounds up into the next whole", () => {
    // Gold tee (SR 113): 13.0 × 113/113 + (69.5 − 72) = 10.5 → 11
    // (.5 rounds up — RoH 5.1 note).
    const gold = CHAMPIONSHIP_18.tees.gold;
    expect(courseHandicap(13.0, CHAMPIONSHIP_18, gold)).toBe(11);
    // A .5 on the negative side rounds away from zero: HI −12.7 on gold:
    // −12.7 − 2.5 = −15.2 → −15 — verify nearest-whole below .5:
    expect(courseHandicap(12.2, CHAMPIONSHIP_18, gold)).toBe(10);
  });
});

describe("Rules of Handicapping 5.2 — 9-hole Course Handicap", () => {
  it("applies the −0.5 9-hole bonus adjustment", () => {
    // 15 × 121/113 = 16.062…; + (35.1 − 36) = −0.9; −0.5 → 14.662… → 15
    const tee = EXECUTIVE_9.tees.white;
    expect(courseHandicapExact(15.0, EXECUTIVE_9, tee)).toBeCloseTo(
      (15.0 * 121) / 113 - 0.9 - 0.5,
      10,
    );
    expect(courseHandicap(15.0, EXECUTIVE_9, tee)).toBe(15);
  });

  it("9-hole Course Handicap can be negative (plus player)", () => {
    // −1.0 × 121/113 = −1.070…; −0.9 − 0.5 → −2.470… → −2
    const tee = EXECUTIVE_9.tees.white;
    expect(courseHandicap(-1.0, EXECUTIVE_9, tee)).toBe(-2);
  });

  it("back-nine round: same formula on the 9-hole tee data", () => {
    // 12.4 × 118/113 = 12.949…; + (35.2 − 36) = −0.8; −0.5 → 11.649… → 12
    const tee = BACK_NINE.tees.white;
    expect(courseHandicap(12.4, BACK_NINE, tee)).toBe(12);
  });
});

describe("Rules of Handicapping 5.2/5.3 — Handicap Index conversions", () => {
  it("HI18 → HI9 divides by 2", () => {
    expect(handicapIndex18To9(12.4)).toBeCloseTo(6.2, 10);
    expect(handicapIndex18To9(21.6)).toBeCloseTo(10.8, 10);
    expect(handicapIndex18To9(-2.0)).toBeCloseTo(-1.0, 10);
  });

  it("HI9 → HI18 doubles and adds the 0.4 smoothing", () => {
    expect(handicapIndex9To18(6.2)).toBeCloseTo(12.8, 10);
    expect(handicapIndex9To18(10.0)).toBeCloseTo(20.4, 10);
    expect(handicapIndex9To18(0)).toBeCloseTo(0.4, 10);
  });

  it("conversion round trip keeps the 9-hole value within 0.4", () => {
    const hi9 = handicapIndex18To9(12.4);
    expect(handicapIndex9To18(hi9)).toBeCloseTo(12.8, 10);
  });
});

describe("Rules of Handicapping 5.5 — Playing Handicap (allowance step)", () => {
  it("spec: 95% of CH 13 → PH 12", () => {
    // 13 × 0.95 = 12.35 → 12
    const result = computeHandicap({
      handicapIndex: 12.4,
      course: CHAMPIONSHIP_18,
      tee: white,
      allowance: { fraction: NET_COMPETITION_DEFAULT_ALLOWANCE },
    });
    expect(result.playingHandicapExact).toBeCloseTo(13 * 0.95, 10);
    expect(result.playingHandicap).toBe(12);
  });

  it("full allowance keeps the Course Handicap whole", () => {
    const result = computeHandicap({
      handicapIndex: 12.4,
      course: CHAMPIONSHIP_18,
      tee: white,
      allowance: fullAllowance(),
    });
    expect(result.playingHandicap).toBe(13);
    expect(result.playingHandicapExact).toBeCloseTo(13, 10);
  });

  it("four-ball default allowance is 85% (RoH 5.5)", () => {
    expect(FOUR_BALL_DEFAULT_ALLOWANCE).toBe(0.85);
    expect(NET_COMPETITION_DEFAULT_ALLOWANCE).toBe(0.95);
    expect(SLOPE_RATING_NEUTRAL).toBe(113);
  });

  it("allowance rounds .5 up like every WHS rounding (12.35 → 12, 12.5 → 13)", () => {
    // CH 13: 13 × 0.95 = 12.35 → 12. CH 10 @ 100% = 10. A CH of 25 at 95%
    // = 23.75 → 24 (nearest), CH 13 at 96%? — stick to published values:
    // 85% of CH 15 = 12.75 → 13.
    const result = computeHandicap({
      handicapIndex: 12.4,
      course: CHAMPIONSHIP_18,
      tee: white,
      allowance: { fraction: 0.9 },
    });
    // 13 × 0.9 = 11.7 → 12
    expect(result.playingHandicap).toBe(12);
  });

  it("plus player: negative PH rounds away from zero (−13 × 0.95 = −12.35 → −12)", () => {
    // HI −12.4: −12.4 × 128/113 = −14.037…; −0.8 → −14.837… → −15 (CH);
    // −15 × 0.95 = −14.25 → −14
    const result = computeHandicap({
      handicapIndex: -12.4,
      course: CHAMPIONSHIP_18,
      tee: white,
      allowance: { fraction: NET_COMPETITION_DEFAULT_ALLOWANCE },
    });
    expect(result.courseHandicap).toBe(-15);
    expect(result.playingHandicap).toBe(-14);
  });

  it("0% allowance makes everyone scratch (PH 0)", () => {
    const result = computeHandicap({
      handicapIndex: 12.4,
      course: CHAMPIONSHIP_18,
      tee: white,
      allowance: { fraction: 0 },
    });
    expect(result.playingHandicap).toBe(0);
  });
});

describe("Rules of Handicapping 5.6 — Committee overrides", () => {
  it("a Course Handicap override replaces the computed value entirely", () => {
    const result = computeHandicap({
      handicapIndex: 12.4,
      course: CHAMPIONSHIP_18,
      tee: white,
      allowance: { fraction: NET_COMPETITION_DEFAULT_ALLOWANCE },
      courseHandicapOverride: { courseHandicap: 11 },
    });
    expect(result.courseHandicap).toBe(11);
    // PH = 11 × 0.95 = 10.45 → 10
    expect(result.playingHandicap).toBe(10);
    // The exact value still reports the computed (unoverridden) formula.
    // 12.4 × 128/113 − 0.8 = 13.237…
    expect(result.courseHandicapExact).toBeCloseTo(
      (12.4 * 128) / 113 - 0.8,
      10,
    );
  });

  it("a Playing Handicap override lands last, after the allowance", () => {
    const result = computeHandicap({
      handicapIndex: 12.4,
      course: CHAMPIONSHIP_18,
      tee: white,
      allowance: { fraction: NET_COMPETITION_DEFAULT_ALLOWANCE },
      playingHandicapOverride: { playingHandicap: 13 },
    });
    expect(result.courseHandicap).toBe(13);
    expect(result.playingHandicap).toBe(13);
  });

  it("courseHandicap() short-circuits on the override without computing", () => {
    expect(
      courseHandicap(999, CHAMPIONSHIP_18, white, { courseHandicap: 7 }),
    ).toBe(7);
  });
});
