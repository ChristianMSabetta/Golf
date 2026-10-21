/**
 * Card-off tiebreak verification (USGA Recommendations to Committees —
 * matching of cards): last 9, then last 6, then last 3, then
 * hole-by-hole from the last hole backwards. All stage totals and
 * orders below are summed and compared by hand.
 */
import { describe, expect, it } from "vitest";
import {
  breakTiesByCardOff,
  cardOffBreakdown,
  compareCardOff,
  lastNHolesTotal,
  type CardOffBreakdown,
} from "../src";

const order18 = Array.from({ length: 18 }, (_, i) => i + 1);

function breakdownOf(scores: Record<number, number>): CardOffBreakdown {
  return cardOffBreakdown(scores, order18);
}

describe("lastNHolesTotal", () => {
  it("sums the last n holes of the round order", () => {
    const scores = Object.fromEntries(order18.map((h) => [h, h]));
    expect(lastNHolesTotal(scores, order18, 3)).toBe(16 + 17 + 18);
    expect(lastNHolesTotal(scores, order18, 6)).toBe(13 + 14 + 15 + 16 + 17 + 18);
    expect(lastNHolesTotal(scores, order18, 9)).toBe(
      Array.from({ length: 9 }, (_, i) => 10 + i).reduce((a, b) => a + b, 0),
    );
  });

  it("missing holes count as +Infinity (incomplete card loses)", () => {
    const scores: Record<number, number> = { 18: 4 };
    const total = lastNHolesTotal(scores, order18, 1);
    expect(total).toBe(4);
    expect(Number.isFinite(lastNHolesTotal({}, order18, 9))).toBe(false);
  });

  it("an n larger than the round takes the whole order", () => {
    expect(lastNHolesTotal({ 1: 3, 2: 4 }, [1, 2], 9)).toBe(7);
  });
});

describe("cardOffBreakdown", () => {
  it("produces the 9/6/3 stages and the backwards per-hole read", () => {
    const scores = Object.fromEntries(order18.map((h) => [h, 4]));
    const bd = breakdownOf(scores);
    expect(bd.stages.map((s) => s.lastNHoles)).toEqual([9, 6, 3]);
    expect(bd.stages.map((s) => s.total)).toEqual([36, 24, 12]);
    expect(bd.backwards).toHaveLength(18);
    expect(bd.backwards[0]).toBe(4);
  });

  it("unplayed holes appear as null in the backwards read", () => {
    const bd = breakdownOf({ 18: 5, 17: 4 });
    expect(bd.backwards[0]).toBe(5);
    expect(bd.backwards[1]).toBe(4);
    expect(bd.backwards[2]).toBeNull();
  });
});

describe("compareCardOff", () => {
  it("equal cards compare 0 through every stage", () => {
    expect(compareCardOff(breakdownOf({ 1: 5, 18: 4 }), breakdownOf({ 1: 5, 18: 4 }))).toBe(0);
  });

  it("decides on the last-9 stage when totals differ there", () => {
    // A: back nine 34, B: back nine 35 → A wins.
    const a = breakdownOf(Object.fromEntries(order18.map((h) => [h, h <= 9 ? 5 : 4])));
    const b = breakdownOf(Object.fromEntries(order18.map((h) => [h, h <= 9 ? 4 : 4 + (h === 18 ? 1 : 0)])));
    expect(a.stages[0].total).toBe(36);
    expect(b.stages[0].total).toBe(37);
    expect(compareCardOff(a, b)).toBe(-1);
    expect(compareCardOff(b, a)).toBe(1);
  });

  it("falls to last-6/last-3 when the last 9 is equal", () => {
    // Both back nines total 36; A's last 6 is 24, B's is 25.
    const base = Object.fromEntries(order18.map((h) => [h, 4]));
    const a = { ...base, 10: 4, 11: 4, 12: 4, 13: 4, 14: 4, 15: 4 };
    const b = { ...base, 10: 5, 11: 4, 12: 4, 13: 4, 14: 4, 15: 4, 16: 3 };
    const bdA = breakdownOf(a);
    const bdB = breakdownOf(b);
    expect(bdA.stages[0].total).toBe(bdB.stages[0].total);
    // A's last 6 (holes 13–18) = 24; B's = 23 (hole 16 is 3).
    expect(bdA.stages[1].total).toBe(24);
    expect(bdB.stages[1].total).toBe(23);
    expect(compareCardOff(bdA, bdB)).toBe(1);
    expect(compareCardOff(bdB, bdA)).toBe(-1);
  });

  it("goes hole-by-hole backwards when every stage total ties", () => {
    // Identical totals on 9/6/3; A's 18th is 4 vs B's 5 → A wins.
    const a = breakdownOf({ ...Object.fromEntries(order18.map((h) => [h, 4])), 17: 5, 18: 3 });
    const b = breakdownOf(Object.fromEntries(order18.map((h) => [h, 4])));
    expect(a.stages[2].total).toBe(b.stages[2].total);
    expect(a.backwards[1]).toBe(5);
    expect(a.backwards[0]).toBe(3);
    expect(b.backwards[0]).toBe(4);
    expect(compareCardOff(a, b)).toBe(-1);
  });

  it("unplayed holes lose deterministically to played ones", () => {
    // A missing hole makes a stage total Infinity; equal infinities
    // are skipped, so the backwards read decides: A played the 18th
    // (4) and B did not → A wins.
    const a = breakdownOf({ 18: 4, 17: 4 });
    const b = breakdownOf({ 17: 4 });
    expect(a.stages[0].total).toBe(Number.POSITIVE_INFINITY);
    expect(b.stages[0].total).toBe(Number.POSITIVE_INFINITY);
    expect(a.backwards[0]).toBe(4);
    expect(b.backwards[0]).toBeNull();
    expect(compareCardOff(a, b)).toBe(-1);
    expect(compareCardOff(b, a)).toBe(1);
  });
});

describe("breakTiesByCardOff", () => {
  it("orders a tie group and labels decided/tied", () => {
    const result = breakTiesByCardOff({
      holeOrder: order18,
      participants: [
        { id: "worse", perHoleScores: Object.fromEntries(order18.map((h) => [h, h <= 9 ? 5 : 4])) },
        { id: "better", perHoleScores: Object.fromEntries(order18.map((h) => [h, 4])) },
        { id: "same-as-better", perHoleScores: Object.fromEntries(order18.map((h) => [h, 4])) },
      ],
    });
    expect(result.map((r) => [r.id, r.rank, r.result])).toEqual([
      ["better", 1, "decided"],
      ["same-as-better", 1, "tied"],
      ["worse", 2, "decided"],
    ]);
  });

  it("works for teams: per-hole sequences decide alike", () => {
    const result = breakTiesByCardOff({
      holeOrder: [1, 2, 3],
      participants: [
        { id: "T2", perHoleScores: { 1: 3, 2: 4, 3: 4 } },
        { id: "T1", perHoleScores: { 1: 3, 2: 3, 3: 5 } },
      ],
    });
    // last 3: T1 11 vs T2 11 — equal; backwards: 3rd 5 vs 4 → T2 wins.
    expect(result.map((r) => r.id)).toEqual(["T2", "T1"]);
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(2);
  });

  it("an empty participant list returns nothing", () => {
    expect(breakTiesByCardOff({ holeOrder: order18, participants: [] })).toEqual([]);
  });
});
