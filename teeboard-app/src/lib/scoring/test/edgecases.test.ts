/**
 * Boundary and defensive edge cases beyond the spec set: rank
 * exclusion in 9-hole modes, degenerate payout standings, empty team
 * members, Stableford tie ordering, flights with equal thresholds, and
 * skins re-ranking of front-nine 18-hole SIs.
 */
import { describe, expect, it } from "vitest";
import {
  allocateStrokes,
  assignFlights,
  compareCardOff,
  computeBestBallStandings,
  computeLongDrive,
  computeLongestPutt,
  computePayouts,
  computeScrambleStandings,
  computeSkins,
  computeStablefordStandings,
  computeStrokePlayStandings,
  cardOffBreakdown,
  stablefordPointsForHole,
} from "../src";
import { FLAT_18, MIXED_NINE } from "./fixtures";

const tee = FLAT_18.tees.white;

describe("stroke allocation boundaries", () => {
  it("PH beyond 3 passes the scale keeps cycling strokes", () => {
    // 54 on an 18-scale: 3 full passes → 3 strokes on every hole.
    const allocation = allocateStrokes(54, FLAT_18);
    expect(allocation.strokes[18]).toBe(3);
    expect(allocation.strokes[1]).toBe(3);
    // 58 → 3 + ranks 1–4.
    const allocation58 = allocateStrokes(58, FLAT_18);
    expect(allocation58.strokes[4]).toBe(4);
    expect(allocation58.strokes[5]).toBe(3);
  });

  it("PH exactly on a scale multiple gets exactly full passes", () => {
    const allocation = allocateStrokes(36, FLAT_18);
    expect(Object.values(allocation.strokes).every((s) => s === 2)).toBe(true);
  });

  it("PH −36 gives back two strokes on every hole", () => {
    const allocation = allocateStrokes(-36, FLAT_18);
    expect(Object.values(allocation.strokes).every((s) => s === -2)).toBe(true);
  });

  it("a 9-hole mixed-SI course re-ranks every hole in front mode", () => {
    // mode "front": each hole's SI maps onto the 9-scale (SI > 9 → SI−9),
    // so every hole is in range and PH 3 strokes holes with re-ranked
    // rank ≤ 3: hole 4 (SI 1 → rank 1), hole 1 (SI 3 → rank 3),
    // hole 2 (SI 12 → rank 3).
    const allocation = allocateStrokes(3, MIXED_NINE, "front");
    expect(allocation.strokeIndexScale).toBe(9);
    expect(Object.keys(allocation.strokes)).toHaveLength(9);
    expect(allocation.strokes[4]).toBe(1); // SI 1 → rank 1
    expect(allocation.strokes[1]).toBe(1); // SI 3 → rank 3
    expect(allocation.strokes[2]).toBe(1); // SI 12 → rank 3
    expect(allocation.strokes[3]).toBe(0); // SI 17 → rank 8
  });

  it("mode full on a mixed-SI 9-hole course keeps raw 18-scale ranks", () => {
    // Scale is 18 and PH 5 strokes holes with SI ≤ 5: 1 (SI 3),
    // 4 (SI 1), 7 (6? no >5), 9 (7 no) → holes 1 and 4 get strokes;
    // holes with SI 12, 14, 17, 18 rank beyond 5 → nothing.
    const allocation = allocateStrokes(5, MIXED_NINE, "full");
    expect(allocation.strokeIndexScale).toBe(18);
    expect(allocation.strokes[1]).toBe(1);
    expect(allocation.strokes[4]).toBe(1);
    expect(allocation.strokes[2]).toBe(0); // SI 12
    expect(allocation.strokes[3]).toBe(0); // SI 17
  });

  it("an out-of-scale stroke index is excluded from allocation (rank null)", () => {
    // SI 20 under mode "back" re-ranks to 11 > scale 9 → excluded;
    // SI 19 → rank 10 > 9 → excluded as well. Only in-range holes get a
    // strokes entry.
    const oddNine = {
      ...MIXED_NINE,
      holeList: [
        { holeNumber: 1, par: 4, strokeIndex: 20 },
        { holeNumber: 2, par: 4, strokeIndex: 19 },
        { holeNumber: 3, par: 4, strokeIndex: 2 },
      ],
    };
    const allocation = allocateStrokes(2, oddNine, "back");
    expect(allocation.strokes[1]).toBeUndefined();
    expect(allocation.strokes[2]).toBeUndefined();
    expect(allocation.strokes[3]).toBe(1);
  });

  it("PH 0 on a mixed course allocates zeros for all nine holes", () => {
    const allocation = allocateStrokes(0, MIXED_NINE, "back");
    expect(Object.keys(allocation.strokes)).toHaveLength(9);
    expect(Object.values(allocation.strokes).every((v) => v === 0)).toBe(true);
  });

  it("scratch PH allocates zeros for every ranked hole", () => {
    const allocation = allocateStrokes(0, FLAT_18);
    expect(Object.values(allocation.strokes).every((s) => s === 0)).toBe(true);
    expect(Object.keys(allocation.strokes)).toHaveLength(18);
  });
});

describe("payouts boundary standings", () => {
  it("positions below 1 are skipped entirely", () => {
    const payouts = computePayouts({
      config: { purse: 30000, positions: [{ share: 1 }] },
      standings: [
        { id: "zero", position: 0 },
        { id: "neg", position: -2 },
        { id: "ok", position: 1 },
      ],
    });
    expect(payouts.entries).toHaveLength(1);
    expect(payouts.entries[0].id).toBe("ok");
    expect(payouts.entries[0].amount).toBe(30000);
  });

  it("a share beyond the configured positions pays 0", () => {
    const payouts = computePayouts({
      config: { purse: 30000, positions: [{ share: 1 }] },
      standings: [
        { id: "first", position: 1 },
        { id: "second", position: 2 },
      ],
    });
    expect(payouts.entries.find((e) => e.id === "first")!.amount).toBe(30000);
    expect(payouts.entries.find((e) => e.id === "second")!.slots).toEqual([
      { slot: 2, amount: 0, share: 0 },
    ]);
  });
});

describe("format boundary inputs", () => {
  it("stroke play with a course missing a played hole still ranks", () => {
    const standings = computeStrokePlayStandings({
      course: FLAT_18,
      tee,
      players: [{ id: "ghost", handicapIndex: 10, scores: { 99: 4 } }],
    });
    // hole 99 is not on the card → thru 0, gross 0, net 0.
    expect(standings[0].thru).toBe(0);
    expect(standings[0].gross).toBe(0);
    expect(standings[0].net).toBe(0);
  });

  it("best ball with a team member who has no scores", () => {
    const standings = computeBestBallStandings({
      course: FLAT_18,
      tee,
      teams: [
        {
          id: "T1",
          members: [
            { id: "a", handicapIndex: 0.0, scores: { 1: 4 } },
            { id: "bench", handicapIndex: 20, scores: {} },
          ],
        },
      ],
    });
    expect(standings[0].total).toBe(5); // 4 − (−1) given back on SI 1
    expect(standings[0].thru).toBe(1);
  });

  it("scramble with an empty team score map totals zero", () => {
    const standings = computeScrambleStandings({
      course: FLAT_18,
      tee,
      allowanceFraction: 0.25,
      teamSize: { min: 1, max: 4 },
      teams: [
        {
          id: "T1",
          scores: {},
          members: [{ id: "m", handicapIndex: 10, scores: {} }],
        },
      ],
    });
    expect(standings[0].gross).toBe(0);
    expect(standings[0].net).toBe(0);
    expect(standings[0].thru).toBe(0);
  });

  it("scramble with basis gross ranks by team gross strokes", () => {
    const standings = computeScrambleStandings({
      course: FLAT_18,
      tee,
      basis: "gross",
      allowanceFraction: 0.25,
      teams: [
        {
          id: "T1",
          scores: { 1: 4, 2: 5 },
          members: [
            { id: "m1", handicapIndex: 10, scores: {} },
            { id: "m2", handicapIndex: 10, scores: {} },
          ],
        },
      ],
    });
    // gross total ignores the team handicap entirely.
    expect(standings[0].gross).toBe(9);
  });

  it("best ball with basis gross counts the best gross ball per hole", () => {
    const standings = computeBestBallStandings({
      course: FLAT_18,
      tee,
      basis: "gross",
      teams: [
        {
          id: "T1",
          members: [
            { id: "a", handicapIndex: 0.0, scores: { 1: 4 } },
            { id: "b", handicapIndex: 20, scores: { 1: 6 } },
          ],
        },
      ],
    });
    // best GROSS ball: 4 (not 4 − (−1) = 5).
    expect(standings[0].total).toBe(4);
  });

  it("best ball with an empty member list (bounds permitting) totals zero", () => {
    const standings = computeBestBallStandings({
      course: FLAT_18,
      tee,
      teamSize: { min: 0, max: 4 },
      teams: [{ id: "T-empty", members: [] }],
    });
    expect(standings[0].total).toBe(0);
    expect(standings[0].thru).toBe(0);
  });

  it("stableford ranks a tie by card-off when tiebreak is on", () => {
    const standings = computeStablefordStandings({
      course: FLAT_18,
      tee,
      tiebreak: true,
      players: [
        { id: "B", handicapIndex: 0.0, scores: { 18: 5, 17: 4 } },
        { id: "A", handicapIndex: 0.0, scores: { 18: 4, 17: 5 } },
      ],
    });
    // Both −2 net (−1 PH given back on SI 1 = hole 1 → unplayed): A's
    // backwards hole 18 (4) beats B's (5) → A first.
    expect(standings.map((s) => s.id)).toEqual(["A", "B"]);
    expect(standings[0].position).toBe(1);
  });
});

describe("stableford custom-scale boundary", () => {
  it("a net-to-par between fixed entries with a gap scores 0", () => {
    // Scale with a gap at −1: birdie-ish scores fall through to 0.
    const scale = {
      entries: [
        { toPar: -2, points: 4 },
        { toPar: 0, points: 2 },
      ],
      pointsPerStrokeBetterThanBest: 2,
      pointsPerStrokeWorseThanWorst: -1,
    };
    expect(stablefordPointsForHole(-1, scale)).toBe(0);
    expect(stablefordPointsForHole(1, scale)).toBe(1); // 2 + (1−0)×(−1)
  });
});

describe("measured side games without a value", () => {
  it("long drive and longest putt default the value to 0", () => {
    expect(
      computeLongDrive({ holeNumber: 4, measurements: [{ id: "A", measurement: 285 }] }),
    ).toEqual({ holeNumber: 4, winnerIds: ["A"], value: 0 });
    expect(
      computeLongestPutt({ holeNumber: 6, measurements: [{ id: "A", measurement: 30 }] }),
    ).toEqual({ holeNumber: 6, winnerIds: ["A"], value: 0 });
  });
});

describe("card-off stage totals with incomplete cards", () => {
  it("a complete stage beats one with unplayed holes", () => {
    const order = Array.from({ length: 18 }, (_, i) => i + 1);
    const full = cardOffBreakdown(
      Object.fromEntries(order.map((h) => [h, 4])),
      order,
    );
    const missing = cardOffBreakdown({ 17: 4, 16: 4, 15: 4 }, order);
    // full's last-9 total is 36; missing's is Infinity (13 absent) →
    // full wins; the reverse comparison loses.
    expect(Number.isFinite(full.stages[0].total)).toBe(true);
    expect(Number.isFinite(missing.stages[0].total)).toBe(false);
    expect(compareCardOff(full, missing)).toBe(-1);
    expect(compareCardOff(missing, full)).toBe(1);
  });
});

describe("flights boundary", () => {
  it("no matching threshold falls back to the last flight", () => {
    const result = assignFlights({
      players: [{ id: "over", handicap: 20, sortId: "over" }],
      flights: [{ name: "A", maxHandicap: 8 }],
    });
    expect(result[0].flightName).toBe("A");
    expect(result[0].flightIndex).toBe(0);
  });

  it("equal handicaps order by sortId deterministically", () => {
    const result = assignFlights({
      players: [
        { id: "z", handicap: 10.0, sortId: "z" },
        { id: "a", handicap: 10.0, sortId: "a" },
      ],
      flights: [{ name: "Only", maxHandicap: null }],
    });
    expect(result.map((r) => r.playerId)).toEqual(["a", "z"]);
  });

  it("the first threshold wins when handicaps straddle it", () => {
    const result = assignFlights({
      players: [{ id: "edge", handicap: 8.0, sortId: "e" }],
      flights: [
        { name: "A", maxHandicap: 8 },
        { name: "B", maxHandicap: null },
      ],
    });
    expect(result[0].flightName).toBe("A");
  });
});

describe("skins boundary", () => {
  it("gross skins where all ties leave the full value unawarded", () => {
    const skins = computeSkins({
      config: { variant: "gross", holeValue: 700, maxScoreRule: { kind: "none" } },
      holes: FLAT_18.holeList.slice(0, 2),
      entries: [
        { id: "A", scores: { 1: 4, 2: 4 } },
        { id: "B", scores: { 1: 4, 2: 4 } },
      ],
    });
    expect(skins.leftovers).toBe(1400);
    expect(skins.totals).toEqual([]);
  });

  it("a single player wins every hole outright", () => {
    const skins = computeSkins({
      config: { variant: "gross", holeValue: 100, maxScoreRule: { kind: "none" } },
      holes: FLAT_18.holeList.slice(0, 2),
      entries: [{ id: "solo", scores: { 1: 4, 2: 5 } }],
    });
    expect(skins.holeResults.every((h) => h.winnerId === "solo")).toBe(true);
    expect(skins.totals).toEqual([{ id: "solo", value: 200 }]);
  });
});
