/**
 * Side-game verification: skins (gross/net, carryover chains),
 * closest-to-pin, long drive, and longest putt. Pots and winners below
 * are tallied by hand from the per-hole scores.
 */
import { describe, expect, it } from "vitest";
import {
  computeClosestToPin,
  computeLongDrive,
  computeLongestPutt,
  computeSkins,
  resolveSkinHole,
} from "../src";
import { FLAT_18 } from "./fixtures";

const holes4 = FLAT_18.holeList.slice(0, 4);

describe("resolveSkinHole", () => {
  it("the unique best score wins", () => {
    expect(
      resolveSkinHole({
        scores: [
          { id: "A", comparableStrokes: 4 },
          { id: "B", comparableStrokes: 5 },
        ],
      }),
    ).toEqual({ winnerId: "A", winningStrokes: 4 });
  });

  it("a tie for best carries over (no winner)", () => {
    expect(
      resolveSkinHole({
        scores: [
          { id: "A", comparableStrokes: 4 },
          { id: "B", comparableStrokes: 4 },
        ],
      }),
    ).toEqual({ winnerId: null, winningStrokes: null });
  });

  it("nobody playing resolves to nothing", () => {
    expect(
      resolveSkinHole({ scores: [{ id: "A", comparableStrokes: null }] }),
    ).toEqual({ winnerId: null, winningStrokes: null });
  });
});

describe("computeSkins", () => {
  it("net skins: strokes received decide the hole (RoH allocation)", () => {
    const skins = computeSkins({
      config: { variant: "net", holeValue: 1000, maxScoreRule: { kind: "none" } },
      holes: holes4,
      entries: [
        { id: "A", scores: { 1: 4, 2: 5, 3: 4, 4: 4 }, strokesByHole: { 1: 1, 2: 1, 3: 1, 4: 1 } },
        { id: "B", scores: { 1: 4, 2: 5, 3: 4, 4: 3 }, strokesByHole: {} },
      ],
    });
    // A nets 3,4,3 vs B gross 4,5,4 → A wins 1–3; hole 4 ties 3 vs 3.
    expect(skins.holeResults.map((h) => h.winnerId)).toEqual(["A", "A", "A", null]);
    expect(skins.holeResults[3].carriedOver).toBe(true);
    expect(skins.holeResults[3].carryAmount).toBe(1000);
    expect(skins.leftovers).toBe(1000);
    expect(skins.totals).toEqual([{ id: "A", value: 3000 }]);
  });

  it("gross skins ignore handicap strokes", () => {
    const skins = computeSkins({
      config: { variant: "gross", holeValue: 500, maxScoreRule: { kind: "none" } },
      holes: holes4,
      entries: [
        { id: "A", scores: { 1: 4, 2: 5 }, strokesByHole: { 1: 1, 2: 1 } },
        { id: "B", scores: { 1: 5, 2: 4 } },
      ],
    });
    // Hole 1: A gross 4 beats B 5 → A wins 500. Hole 2: B 4 beats 5 → B.
    // Holes 3–4: nobody played → carried over → leftovers 1000.
    expect(skins.holeResults.map((h) => [h.winnerId, h.potValue])).toEqual([
      ["A", 500],
      ["B", 500],
      [null, 0],
      [null, 0],
    ]);
    expect(skins.holeResults[2].carryAmount).toBe(500);
    expect(skins.leftovers).toBe(1000);
  });

  it("carryover accumulates across many consecutive tied holes", () => {
    // A and B tie holes 1–3 (identical scores), A wins hole 4 outright:
    // pot 4 × 250 = 1000.
    const skins = computeSkins({
      config: { variant: "gross", holeValue: 250, maxScoreRule: { kind: "none" } },
      holes: holes4,
      entries: [
        { id: "A", scores: { 1: 4, 2: 4, 3: 4, 4: 3 } },
        { id: "B", scores: { 1: 4, 2: 4, 3: 4, 4: 5 } },
      ],
    });
    expect(skins.holeResults.map((h) => h.carriedOver)).toEqual([true, true, true, false]);
    expect(skins.holeResults.map((h) => h.carryAmount)).toEqual([250, 500, 750, 0]);
    expect(skins.holeResults[3].potValue).toBe(1000);
    expect(skins.leftovers).toBe(0);
    expect(skins.totals).toEqual([{ id: "A", value: 1000 }]);
  });

  it("a carryover chain that never resolves leaves leftovers", () => {
    const skins = computeSkins({
      config: { variant: "gross", holeValue: 300, maxScoreRule: { kind: "none" } },
      holes: holes4,
      entries: [
        { id: "A", scores: { 1: 4, 2: 4, 3: 4, 4: 4 } },
        { id: "B", scores: { 1: 4, 2: 4, 3: 4, 4: 4 } },
      ],
    });
    expect(skins.leftovers).toBe(1200);
    expect(skins.totals).toEqual([]);
  });

  it("a hole nobody played carries over", () => {
    const skins = computeSkins({
      config: { variant: "gross", holeValue: 100, maxScoreRule: { kind: "none" } },
      holes: holes4,
      entries: [{ id: "A", scores: { 2: 5 } }, { id: "B", scores: { 2: 6 } }],
    });
    expect(skins.holeResults[0].carriedOver).toBe(true);
    expect(skins.holeResults[1].winnerId).toBe("A");
    expect(skins.holeResults[1].potValue).toBe(200);
    expect(skins.totals).toEqual([{ id: "A", value: 200 }]);
  });

  it("the maximum-score rule caps skins scores too", () => {
    const skins = computeSkins({
      config: {
        variant: "gross",
        holeValue: 100,
        maxScoreRule: { kind: "net_double_bogey" },
      },
      holes: [
        { holeNumber: 1, par: 3, strokeIndex: 1 },
        { holeNumber: 2, par: 4, strokeIndex: 2 },
      ],
      entries: [
        { id: "A", scores: { 1: 9, 2: 5 } },
        { id: "B", scores: { 1: 8, 2: 9 }, strokesByHole: { 2: 1 } },
      ],
    });
    // hole 1 caps: A min(9, 3+2+0)=5, B min(8, 5)=5 → tie → carry.
    // hole 2: A cap 4+2+0 = 6 > 5 → stays 5 → comparable 5 − 0 = 5;
    // B cap 4+2+1 = 7, 9 → 7 → comparable 7 − 1 = 6 → A wins 200.
    expect(skins.holeResults[0].winnerId).toBeNull();
    expect(skins.holeResults[1].winnerId).toBe("A");
    expect(skins.holeResults[1].potValue).toBe(200);
  });

  it("an empty game pays nothing", () => {
    const skins = computeSkins({
      config: { variant: "gross", holeValue: 100, maxScoreRule: { kind: "none" } },
      holes: [],
      entries: [],
    });
    expect(skins.holeResults).toEqual([]);
    expect(skins.leftovers).toBe(0);
    expect(skins.totals).toEqual([]);
  });
});

describe("measured side games", () => {
  const measurements = [
    { id: "A", measurement: 6.5 },
    { id: "B", measurement: 8.2 },
    { id: "C", measurement: null },
  ];

  it("closest-to-pin: lowest distance wins", () => {
    expect(
      computeClosestToPin({ holeNumber: 3, value: 500, measurements }),
    ).toEqual({ holeNumber: 3, winnerIds: ["A"], value: 500 });
  });

  it("long drive: largest distance wins", () => {
    expect(
      computeLongDrive({
        holeNumber: 5,
        value: 500,
        measurements: [
          { id: "A", measurement: 280 },
          { id: "B", measurement: 295 },
        ],
      }),
    ).toEqual({ holeNumber: 5, winnerIds: ["B"], value: 500 });
  });

  it("longest putt: largest putt wins", () => {
    expect(
      computeLongestPutt({
        holeNumber: 7,
        value: 300,
        measurements: [
          { id: "A", measurement: 42 },
          { id: "B", measurement: 55 },
        ],
      }),
    ).toEqual({ holeNumber: 7, winnerIds: ["B"], value: 300 });
  });

  it("equal measurements share the value", () => {
    expect(
      computeClosestToPin({
        holeNumber: 3,
        value: 500,
        measurements: [
          { id: "A", measurement: 6.5 },
          { id: "B", measurement: 6.5 },
        ],
      }),
    ).toEqual({ holeNumber: 3, winnerIds: ["A", "B"], value: 500 });
    expect(
      computeLongDrive({
        holeNumber: 5,
        value: 500,
        measurements: [
          { id: "A", measurement: 280 },
          { id: "B", measurement: 280 },
        ],
      }),
    ).toEqual({ holeNumber: 5, winnerIds: ["A", "B"], value: 500 });
  });

  it("no valid measurements → no result", () => {
    expect(
      computeClosestToPin({ holeNumber: 3, value: 500, measurements }),
    ).not.toBeNull();
    expect(
      computeClosestToPin({
        holeNumber: 3,
        value: 500,
        measurements: [{ id: "C", measurement: null }],
      }),
    ).toBeNull();
    expect(
      computeLongDrive({ holeNumber: 5, value: 500, measurements: [] }),
    ).toBeNull();
    expect(
      computeLongestPutt({
        holeNumber: 7,
        value: 300,
        measurements: [{ id: "A", measurement: -5 }],
      }),
    ).toBeNull();
  });

  it("defaults the value to 0 when omitted", () => {
    expect(
      computeClosestToPin({ holeNumber: 12, measurements: [{ id: "A", measurement: 3 }] }),
    ).toEqual({ holeNumber: 12, winnerIds: ["A"], value: 0 });
  });
});
