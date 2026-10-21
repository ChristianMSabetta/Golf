/**
 * Scorecard verification: capping under maximum-score rules (Rules of
 * Handicapping 3.3b) and the per-hole/net arithmetic. Expected caps are
 * computed from each rule's definition by hand.
 */
import { describe, expect, it } from "vitest";
import {
  capStrokes,
  computeScorecard,
  maxScoreCap,
  pickupScore,
  toHoleScores,
  totalGross,
  totalNet,
  type ScorecardHole,
} from "../src";

const holes: ScorecardHole[] = [
  { holeNumber: 1, par: 4, strokeIndex: 5, strokes: 5 },
  { holeNumber: 2, par: 3, strokeIndex: 11, strokes: 9 },
  { holeNumber: 3, par: 5, strokeIndex: 2, strokes: null },
];

describe("maxScoreCap (Rules of Handicapping 3.3b)", () => {
  it("none → no cap at all", () => {
    expect(maxScoreCap({ kind: "none" }, 4, 2)).toBeNull();
    expect(capStrokes(12, { kind: "none" }, 4, 2)).toBe(12);
  });

  it("fixed cap clamps played strokes", () => {
    expect(maxScoreCap({ kind: "fixed", cap: 8 }, 4, 0)).toBe(8);
    expect(capStrokes(11, { kind: "fixed", cap: 8 }, 4, 0)).toBe(8);
    expect(capStrokes(6, { kind: "fixed", cap: 8 }, 4, 0)).toBe(6);
  });

  it("double par doubles the par", () => {
    expect(maxScoreCap({ kind: "double_par" }, 3, 0)).toBe(6);
    expect(maxScoreCap({ kind: "double_par" }, 5, 2)).toBe(10);
  });

  it("net double bogey: par + 2 + strokes received (RoH 3.3b)", () => {
    expect(maxScoreCap({ kind: "net_double_bogey" }, 4, 0)).toBe(6);
    expect(maxScoreCap({ kind: "net_double_bogey" }, 4, 2)).toBe(8);
    expect(maxScoreCap({ kind: "net_double_bogey" }, 3, 1)).toBe(6);
    expect(maxScoreCap({ kind: "net_double_bogey" }, 5, 0)).toBe(7);
  });

  it("pickupScore equals the cap (most likely score for a picked-up hole)", () => {
    expect(pickupScore({ kind: "net_double_bogey" }, 4, 1)).toBe(7);
    expect(pickupScore({ kind: "fixed", cap: 7 }, 4, 0)).toBe(7);
    expect(pickupScore({ kind: "none" }, 4, 0)).toBeNull();
    expect(pickupScore({ kind: "double_par" }, 4, 0)).toBe(8);
  });
});

describe("computeScorecard", () => {
  it("computes net strokes and to-par per hole without a cap", () => {
    const card = computeScorecard({
      holes,
      strokesByHole: { 1: 1, 2: 0, 3: 2 },
      maxScoreRule: { kind: "none" },
    });
    expect(card[0]).toEqual({
      holeNumber: 1,
      par: 4,
      strokeIndex: 5,
      strokes: 5,
      strokesReceived: 1,
      netStrokes: 4,
      toPar: 1,
    });
    expect(card[1].netStrokes).toBe(9);
    expect(card[1].toPar).toBe(6);
  });

  it("net double bogey caps a played hole by par + 2 + strokes received", () => {
    const card = computeScorecard({
      holes,
      strokesByHole: { 1: 1, 2: 0, 3: 2 },
      maxScoreRule: { kind: "net_double_bogey" },
    });
    // hole 1: cap 4+2+1 = 7 > 5 → stays 5. hole 2: cap 3+2+0 = 5 < 9 → 5.
    expect(card[0].strokes).toBe(5);
    expect(card[1].strokes).toBe(5);
    expect(card[1].netStrokes).toBe(5);
    expect(card[1].toPar).toBe(2);
  });

  it("unplayed holes stay null through every field", () => {
    const card = computeScorecard({
      holes,
      strokesByHole: {},
      maxScoreRule: { kind: "net_double_bogey" },
    });
    expect(card[2].strokes).toBeNull();
    expect(card[2].netStrokes).toBeNull();
    expect(card[2].toPar).toBeNull();
    // strokesReceived still reported for context.
    expect(card[2].strokesReceived).toBe(0);
  });

  it("a plus handicap's strokes given back are negative and raise net", () => {
    const card = computeScorecard({
      holes: [
        { holeNumber: 1, par: 4, strokeIndex: 5, strokes: 5 },
        { holeNumber: 2, par: 4, strokeIndex: 1, strokes: 5 },
      ],
      strokesByHole: { 1: 0, 2: -1 },
      maxScoreRule: { kind: "none" },
    });
    expect(card[1].strokesReceived).toBe(-1);
    expect(card[1].netStrokes).toBe(6);
    expect(card[1].toPar).toBe(1);
  });

  it("empty scorecard → empty card, zero totals", () => {
    const card = computeScorecard({
      holes: [],
      strokesByHole: {},
      maxScoreRule: { kind: "none" },
    });
    expect(card).toEqual([]);
    expect(totalGross(card)).toBe(0);
    expect(totalNet(card)).toBe(0);
  });

  it("totals skip unplayed holes", () => {
    const card = computeScorecard({
      holes,
      strokesByHole: { 1: 1, 2: 0, 3: 1 },
      maxScoreRule: { kind: "none" },
    });
    // gross 5 + 9, net 4 + 9 (hole 3 unplayed)
    expect(totalGross(card)).toBe(14);
    expect(totalNet(card)).toBe(13);
  });

  it("missing strokesByHole entries default to 0 received", () => {
    const card = computeScorecard({
      holes: [{ holeNumber: 7, par: 4, strokeIndex: 1, strokes: 5 }],
      strokesByHole: {},
      maxScoreRule: { kind: "none" },
    });
    expect(card[0].strokesReceived).toBe(0);
    expect(card[0].netStrokes).toBe(5);
  });
});

describe("toHoleScores", () => {
  it("keeps played holes and drops unplayed ones", () => {
    expect(toHoleScores(holes)).toEqual({ 1: 5, 2: 9 });
  });

  it("an all-null card produces an empty map", () => {
    expect(
      toHoleScores([
        { holeNumber: 1, par: 4, strokeIndex: 1, strokes: null },
      ]),
    ).toEqual({});
  });
});
