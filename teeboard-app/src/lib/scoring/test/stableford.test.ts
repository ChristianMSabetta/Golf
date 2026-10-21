/**
 * Stableford verification (USGA/EGA point scale). Points per hole come
 * from the NET score relative to par; the standard scale is fixed in
 * `STANDARD_STABLEFORD_SCALE` and cited per case. All values are read
 * off the published scale table by hand.
 */
import { describe, expect, it } from "vitest";
import {
  computeStablefordScorecard,
  stablefordPointsForHole,
  STANDARD_STABLEFORD_SCALE,
  totalStablefordPoints,
  type ScorecardHole,
} from "../src";

const holes: ScorecardHole[] = [
  { holeNumber: 1, par: 4, strokeIndex: 1, strokes: 5 }, // net 4 → toPar 0
  { holeNumber: 2, par: 4, strokeIndex: 2, strokes: 3 }, // net 2 → toPar −2
  { holeNumber: 3, par: 4, strokeIndex: 3, strokes: 5 }, // net 4 → toPar 0
  { holeNumber: 4, par: 4, strokeIndex: 4, strokes: 6 }, // net 4 → toPar 0
];

describe("stablefordPointsForHole (USGA/EGA standard scale)", () => {
  it("maps each fixed entry of the standard scale", () => {
    // −3 albatross 8, −2 eagle 5, −1 birdie 2, 0 par 0,
    // +1 bogey −1, +2 double bogey −2.
    expect(stablefordPointsForHole(-3)).toBe(8);
    expect(stablefordPointsForHole(-2)).toBe(5);
    expect(stablefordPointsForHole(-1)).toBe(2);
    expect(stablefordPointsForHole(0)).toBe(0);
    expect(stablefordPointsForHole(1)).toBe(-1);
    expect(stablefordPointsForHole(2)).toBe(-2);
    expect(stablefordPointsForHole(null)).toBeNull();
  });

  it("extrapolates beyond the best entry (+2 per further stroke)", () => {
    // −4 → 8 + 2 = 10; −5 → 12 (hole-in-one on a par 4 = −4 → 10).
    expect(stablefordPointsForHole(-4)).toBe(10);
    expect(stablefordPointsForHole(-5)).toBe(12);
  });

  it("extrapolates beyond the worst entry (−1 per further stroke)", () => {
    // +3 → −2 − 1 = −3; +5 → −5.
    expect(stablefordPointsForHole(3)).toBe(-3);
    expect(stablefordPointsForHole(5)).toBe(-5);
  });

  it("a custom scale is honored exactly", () => {
    // Middy-style 1/2/3/4 scale: fixed entries only, ±nothing beyond.
    const scale = {
      entries: [
        { toPar: -2, points: 4 },
        { toPar: -1, points: 3 },
        { toPar: 0, points: 2 },
        { toPar: 1, points: 1 },
      ],
      pointsPerStrokeBetterThanBest: 2,
      pointsPerStrokeWorseThanWorst: 0,
    };
    expect(stablefordPointsForHole(0, scale)).toBe(2);
    expect(stablefordPointsForHole(-2, scale)).toBe(4);
    expect(stablefordPointsForHole(-3, scale)).toBe(6);
    expect(stablefordPointsForHole(1, scale)).toBe(1);
    expect(stablefordPointsForHole(2, scale)).toBe(1); // 1 + (2−1)×0
  });

  it("STANDARD_STABLEFORD_SCALE is the published USGA/EGA table", () => {
    expect(STANDARD_STABLEFORD_SCALE.entries.map((e) => [e.toPar, e.points])).toEqual([
      [-3, 8],
      [-2, 5],
      [-1, 2],
      [0, 0],
      [1, -1],
      [2, -2],
    ]);
    expect(STANDARD_STABLEFORD_SCALE.pointsPerStrokeBetterThanBest).toBe(2);
    expect(STANDARD_STABLEFORD_SCALE.pointsPerStrokeWorseThanWorst).toBe(-1);
  });
});

describe("computeStablefordScorecard", () => {
  it("scores points from net-to-par per hole and totals them", () => {
    const card = computeStablefordScorecard({
      holes,
      strokesByHole: { 1: 1, 2: 1, 3: 1, 4: 2 },
      maxScoreRule: { kind: "none" },
    });
    // nets 4, 2, 4, 4 → toPar 0, −2, 0, 0 → 0 + 5 + 0 + 0 = 5 points
    expect(card.map((h) => h.points)).toEqual([0, 5, 0, 0]);
    expect(totalStablefordPoints(card)).toBe(5);
  });

  it("a maximum-score rule caps gross before points apply", () => {
    const card = computeStablefordScorecard({
      holes: [
        { holeNumber: 1, par: 4, strokeIndex: 1, strokes: 9 },
        { holeNumber: 2, par: 3, strokeIndex: 2, strokes: 8 },
      ],
      strokesByHole: { 1: 0, 2: 0 },
      maxScoreRule: { kind: "net_double_bogey" },
    });
    // hole 1 cap 6 → net 6 → toPar 2 → −2 points.
    expect(card[0].strokes).toBe(6);
    expect(card[0].points).toBe(-2);
    // hole 2 cap 5 → net 5 → toPar 2 → −2 points.
    expect(card[1].strokes).toBe(5);
    expect(card[1].points).toBe(-2);
  });

  it("unplayed holes score null points and add nothing", () => {
    const card = computeStablefordScorecard({
      holes: [
        { holeNumber: 1, par: 4, strokeIndex: 1, strokes: 5 },
        { holeNumber: 2, par: 4, strokeIndex: 2, strokes: null },
      ],
      strokesByHole: { 1: 1, 2: 1 },
      maxScoreRule: { kind: "none" },
    });
    expect(card[0].points).toBe(0); // net 4 → par → 0
    expect(card[1].points).toBeNull();
    expect(totalStablefordPoints(card)).toBe(0);
  });

  it("plus-handicap strokes given back lower points", () => {
    const card = computeStablefordScorecard({
      holes: [{ holeNumber: 1, par: 4, strokeIndex: 1, strokes: 4 }],
      strokesByHole: { 1: -1 },
      maxScoreRule: { kind: "none" },
    });
    // net 4 − (−1) = 5 → toPar 1 → −1 point
    expect(card[0].netStrokes).toBe(5);
    expect(card[0].points).toBe(-1);
  });

  it("an empty card totals zero points", () => {
    expect(
      totalStablefordPoints(
        computeStablefordScorecard({
          holes: [],
          strokesByHole: {},
          maxScoreRule: { kind: "none" },
        }),
      ),
    ).toBe(0);
  });
});
