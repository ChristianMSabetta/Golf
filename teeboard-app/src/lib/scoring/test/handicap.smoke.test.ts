/**
 * Minimal smoke test proving the package's Vitest wiring and the spec
 * example from the milestone spec (Rules of Handicapping 5.1/5.5):
 * Handicap Index 12.4, slope 128, CR 71.2, par 72 → Course Handicap 13;
 * 95% allowance → Playing Handicap 12.
 *
 * The full verification suite (spec cases + 40+ edge cases, ≥95% coverage)
 * is M3-T003; expected values there must be derived from the published
 * Rules of Handicapping (see README.md → "WHS verification policy").
 */
import { describe, expect, it } from "vitest";
import {
  allocateStrokes,
  computeHandicap,
  NET_COMPETITION_DEFAULT_ALLOWANCE,
} from "../src";

const course18 = {
  holes: 18 as const,
  par: 72,
  holeList: Array.from({ length: 18 }, (_, i) => ({
    holeNumber: i + 1,
    par: 4,
    strokeIndex: i + 1,
  })),
  tees: { white: { courseRating: 71.2, slopeRating: 128 } },
};

describe("spec smoke case (RoH 5.1/5.5)", () => {
  it("HI 12.4 @ slope 128 / CR 71.2 / par 72 → CH 13, PH 12", () => {
    const result = computeHandicap({
      handicapIndex: 12.4,
      course: course18,
      tee: course18.tees.white,
      allowance: { fraction: NET_COMPETITION_DEFAULT_ALLOWANCE },
    });
    expect(result.courseHandicap).toBe(13);
    expect(result.playingHandicap).toBe(12);
  });

  it("allocates 12 strokes across holes ranked 1..12", () => {
    const allocation = allocateStrokes(12, course18);
    const holesWithStrokes = Object.values(allocation.strokes).filter(
      (s) => s > 0,
    );
    expect(holesWithStrokes).toHaveLength(12);
    expect(allocation.strokes[1]).toBe(1);
    expect(allocation.strokes[13]).toBe(0);
  });

  it("back-nine 9-hole round: PH 5 → one stroke on holes with 18-SI 10–14, re-ranked 1–5", () => {
    // Holes 1–9 carry the back-nine stroke indices 10–18 in scrambled order.
    const course9back = {
      holes: 9 as const,
      par: 36,
      holeList: [
        { holeNumber: 1, par: 4, strokeIndex: 17 },
        { holeNumber: 2, par: 4, strokeIndex: 11 },
        { holeNumber: 3, par: 4, strokeIndex: 15 },
        { holeNumber: 4, par: 4, strokeIndex: 10 },
        { holeNumber: 5, par: 4, strokeIndex: 13 },
        { holeNumber: 6, par: 4, strokeIndex: 18 },
        { holeNumber: 7, par: 4, strokeIndex: 12 },
        { holeNumber: 8, par: 4, strokeIndex: 16 },
        { holeNumber: 9, par: 4, strokeIndex: 14 },
      ],
      tees: { w: { courseRating: 35.4, slopeRating: 111 } },
    };
    const allocation = allocateStrokes(5, course9back, "back");
    expect(allocation.strokeIndexScale).toBe(9);
    // Re-ranked: SI 17→8, 11→2, 15→6, 10→1, 13→4, 18→9, 12→3, 16→7, 14→5.
    expect(allocation.strokes[1]).toBe(0); // rank 8
    expect(allocation.strokes[2]).toBe(1); // rank 2
    expect(allocation.strokes[3]).toBe(0); // rank 6
    expect(allocation.strokes[4]).toBe(1); // rank 1
    expect(allocation.strokes[5]).toBe(1); // rank 4
    expect(allocation.strokes[6]).toBe(0); // rank 9
    expect(allocation.strokes[7]).toBe(1); // rank 3
    expect(allocation.strokes[8]).toBe(0); // rank 7
    expect(allocation.strokes[9]).toBe(1); // rank 5
  });
});
