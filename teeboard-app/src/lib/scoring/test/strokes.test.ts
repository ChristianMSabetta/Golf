/**
 * Per-hole stroke allocation verification (Rules of Handicapping 3.3 /
 * Appendix E): strokes received per hole from the Playing Handicap and
 * the stroke index scale. Expected allocations are derived by hand from
 * the fixtures' stroke indices — hole ranks are listed in each case.
 */
import { describe, expect, it } from "vitest";
import { allocateStrokes } from "../src";
import { BACK_NINE, CHAMPIONSHIP_18, EXECUTIVE_9, FLAT_18, FRONT_NINE } from "./fixtures";

describe("18-hole allocation (stroke index = hole rank scale 1–18)", () => {
  it("PH 12 → one stroke on holes ranked 1–12, none beyond", () => {
    const allocation = allocateStrokes(12, FLAT_18);
    expect(allocation.strokeIndexScale).toBe(18);
    expect(Object.keys(allocation.strokes)).toHaveLength(18);
    expect(allocation.strokes[1]).toBe(1);
    expect(allocation.strokes[12]).toBe(1);
    expect(allocation.strokes[13]).toBe(0);
    expect(allocation.strokes[18]).toBe(0);
  });

  it("PH 0 → no strokes anywhere (scratch)", () => {
    const allocation = allocateStrokes(0, FLAT_18);
    expect(Object.values(allocation.strokes).every((s) => s === 0)).toBe(true);
  });

  it("PH 18 → a stroke on every hole", () => {
    const allocation = allocateStrokes(18, FLAT_18);
    expect(Object.values(allocation.strokes).every((s) => s === 1)).toBe(true);
  });

  it("PH 24 → two strokes on ranks 1–6, one on ranks 7–18", () => {
    const allocation = allocateStrokes(24, FLAT_18);
    expect(allocation.strokes[1]).toBe(2);
    expect(allocation.strokes[6]).toBe(2);
    expect(allocation.strokes[7]).toBe(1);
    expect(allocation.strokes[18]).toBe(1);
  });

  it("PH 36 → exactly two strokes on every hole", () => {
    const allocation = allocateStrokes(36, FLAT_18);
    expect(Object.values(allocation.strokes).every((s) => s === 2)).toBe(true);
  });

  it("PH 40 → two on every hole plus a third on ranks 1–4", () => {
    const allocation = allocateStrokes(40, FLAT_18);
    expect(allocation.strokes[4]).toBe(3);
    expect(allocation.strokes[5]).toBe(2);
  });

  it("scattered stroke indices: strokes follow the rank, not the hole number", () => {
    // CHAMPIONSHIP_18 hole ranks: hole 5 → rank 1 … hole 6 → rank 17.
    // PH 3 → strokes on holes 5 (SI 1), 12 (SI 2), 2 (SI 3).
    const allocation = allocateStrokes(3, CHAMPIONSHIP_18);
    expect(allocation.strokes[5]).toBe(1);
    expect(allocation.strokes[12]).toBe(1);
    expect(allocation.strokes[2]).toBe(1);
    expect(allocation.strokes[8]).toBe(0);
    expect(Object.values(allocation.strokes).filter((s) => s === 1)).toHaveLength(3);
  });

  it("PH 20 → two strokes on ranks 1–2, one on 3–18", () => {
    // holes 5 (SI 1) and 12 (SI 2) get 2; everything else ≤ 1.
    const allocation = allocateStrokes(20, CHAMPIONSHIP_18);
    expect(allocation.strokes[5]).toBe(2);
    expect(allocation.strokes[12]).toBe(2);
    expect(allocation.strokes[2]).toBe(1);
    expect(allocation.strokes[6]).toBe(1); // SI 17, rank 17 ≤ 20−18 = 2? no: 17 ≤ 2 false → 1
  });

  it("PH 19 → two strokes only on rank 1 (hole 5)", () => {
    const allocation = allocateStrokes(19, CHAMPIONSHIP_18);
    expect(allocation.strokes[5]).toBe(2);
    expect(allocation.strokes[12]).toBe(1);
  });
});

describe("plus handicaps — strokes given back", () => {
  it("PH −1 → one stroke given back on rank 1 (hole 5)", () => {
    const allocation = allocateStrokes(-1, CHAMPIONSHIP_18);
    expect(allocation.strokes[5]).toBe(-1);
    expect(allocation.strokes[2]).toBe(0);
  });

  it("PH −4 → negative strokes on ranks 1–4 (holes 5, 12, 2, 18)", () => {
    // rank 4 → hole 18 (SI 4)
    const allocation = allocateStrokes(-4, CHAMPIONSHIP_18);
    expect(allocation.strokes[5]).toBe(-1);
    expect(allocation.strokes[12]).toBe(-1);
    expect(allocation.strokes[2]).toBe(-1);
    expect(allocation.strokes[18]).toBe(-1);
    expect(allocation.strokes[1]).toBe(0);
  });

  it("PH −18 → a stroke given back on every hole", () => {
    const allocation = allocateStrokes(-18, FLAT_18);
    expect(Object.values(allocation.strokes).every((s) => s === -1)).toBe(true);
  });

  it("PH −27 → two strokes given back on ranks 1–9", () => {
    const allocation = allocateStrokes(-27, FLAT_18);
    expect(allocation.strokes[9]).toBe(-2);
    expect(allocation.strokes[10]).toBe(-1);
  });

  it("a plus handicap on the FLAT course ranks by hole number", () => {
    const allocation = allocateStrokes(-2, FLAT_18);
    expect(allocation.strokes[1]).toBe(-1);
    expect(allocation.strokes[2]).toBe(-1);
    expect(allocation.strokes[3]).toBe(0);
  });
});

describe("9-hole courses with a dedicated 1–9 stroke index", () => {
  it("PH 5 → strokes on ranks 1–5 of the 9-hole scale", () => {
    // EXECUTIVE_9 ranks: hole 5 → 1, 7 → 2, 2 → 3, 9 → 4, 1 → 5.
    const allocation = allocateStrokes(5, EXECUTIVE_9);
    expect(allocation.strokeIndexScale).toBe(9);
    expect(allocation.strokes[5]).toBe(1);
    expect(allocation.strokes[7]).toBe(1);
    expect(allocation.strokes[2]).toBe(1);
    expect(allocation.strokes[9]).toBe(1);
    expect(allocation.strokes[1]).toBe(1);
    expect(allocation.strokes[4]).toBe(0);
    expect(Object.values(allocation.strokes).filter((s) => s > 0)).toHaveLength(5);
  });

  it("PH 12 → two strokes on ranks 1–3, one on ranks 4–9", () => {
    // 12 − 9 = 3 → second stroke on ranks 1–3 (holes 5, 7, 2).
    const allocation = allocateStrokes(12, EXECUTIVE_9);
    expect(allocation.strokes[5]).toBe(2);
    expect(allocation.strokes[7]).toBe(2);
    expect(allocation.strokes[2]).toBe(2);
    expect(allocation.strokes[9]).toBe(1);
    expect(allocation.strokes[1]).toBe(1);
    expect(allocation.strokes[6]).toBe(1);
    expect(allocation.strokes[8]).toBe(1);
    expect(allocation.strokes[4]).toBe(1);
    expect(allocation.strokes[3]).toBe(1);
  });

  it("plus PH −2 on a 9-hole scale: strokes back on ranks 1–2", () => {
    const allocation = allocateStrokes(-2, EXECUTIVE_9);
    expect(allocation.strokes[5]).toBe(-1);
    expect(allocation.strokes[7]).toBe(-1);
    expect(allocation.strokes[3]).toBe(0);
  });
});

describe("9-hole rounds ranked against the 18-hole stroke index scale", () => {
  // BACK_NINE carries 18-hole stroke indices on its nine holes:
  //   hole 1→SI 8, 2→16, 3→2, 4→14, 5→10, 6→18, 7→6, 8→12, 9→4.
  // Re-ranked onto the 9-hole scale (SI − 9 for SI ≥ 10):
  //   hole 5→rank 1, 3→2, 8→3, 9→4, 4→5, 7→6, 2→7, 1→8, 6→9.
  it("mode back: PH 5 → one stroke on re-ranked ranks 1–5", () => {
    const allocation = allocateStrokes(5, BACK_NINE, "back");
    expect(allocation.strokeIndexScale).toBe(9);
    expect(allocation.strokes[5]).toBe(1);
    expect(allocation.strokes[3]).toBe(1);
    expect(allocation.strokes[8]).toBe(1);
    expect(allocation.strokes[9]).toBe(1);
    expect(allocation.strokes[4]).toBe(1);
    expect(allocation.strokes[1]).toBe(0); // rank 8
    expect(Object.values(allocation.strokes).filter((s) => s > 0)).toHaveLength(5);
  });

  it("mode back: PH 12 → second strokes on ranks 1–3, first on 4–9", () => {
    // 12 − 9 = 3: holes 5, 3, 8 carry two strokes; every hole has ≥ 1.
    const allocation = allocateStrokes(12, BACK_NINE, "back");
    expect(allocation.strokes[5]).toBe(2);
    expect(allocation.strokes[3]).toBe(2);
    expect(allocation.strokes[8]).toBe(2);
    expect(allocation.strokes[9]).toBe(1);
    expect(allocation.strokes[6]).toBe(1);
    expect(Object.values(allocation.strokes).filter((s) => s > 0)).toHaveLength(9);
  });

  it("mode back: plus PH −2 → strokes given back on ranks 1–2", () => {
    const allocation = allocateStrokes(-2, BACK_NINE, "back");
    expect(allocation.strokes[5]).toBe(-1);
    expect(allocation.strokes[3]).toBe(-1);
    expect(allocation.strokes[8]).toBe(0);
  });

  it("mode front: a front nine re-ranks its own SIs the same way", () => {
    // FRONT_NINE SIs: hole 1→7, 2→3, 3→11, 4→13, 5→1, 6→17, 7→15, 8→5, 9→9.
    // Ranks: 1→7, 2→3, 3→2 (11−9), 4→4 (13−9), 5→1, 6→8 (17−9),
    // 7→6 (15−9), 8→5, 9→9. PH 3 → strokes on ranks 1–3: holes 5, 3, 2.
    const allocation = allocateStrokes(3, FRONT_NINE, "front");
    expect(allocation.strokeIndexScale).toBe(9);
    expect(allocation.strokes[5]).toBe(1);
    expect(allocation.strokes[3]).toBe(1);
    expect(allocation.strokes[2]).toBe(1);
    expect(allocation.strokes[1]).toBe(0);
    expect(Object.values(allocation.strokes).filter((s) => s > 0)).toHaveLength(3);
  });

  it("mode full: a 9-hole round with 18-hole SIs keeps the 18-rank scale", () => {
    // Scale stays 18 and rank = raw SI; PH 12 → strokes on holes with
    // SI ≤ 12: hole 1 (8), 3 (2), 5 (10), 7 (6), 8 (12), 9 (4).
    const allocation = allocateStrokes(12, BACK_NINE, "full");
    expect(allocation.strokeIndexScale).toBe(18);
    expect(allocation.strokes[1]).toBe(1);
    expect(allocation.strokes[3]).toBe(1);
    expect(allocation.strokes[5]).toBe(1);
    expect(allocation.strokes[7]).toBe(1);
    expect(allocation.strokes[8]).toBe(1);
    expect(allocation.strokes[9]).toBe(1);
    expect(allocation.strokes[2]).toBe(0); // SI 16 > 12
    expect(allocation.strokes[4]).toBe(0); // SI 14 > 12
    expect(Object.values(allocation.strokes).filter((s) => s > 0)).toHaveLength(6);
  });
});
