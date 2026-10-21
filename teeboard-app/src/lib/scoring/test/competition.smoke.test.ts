/**
 * Minimal smoke test proving the competition layer's wiring (M3-T002):
 * one hand-verified case per format and per side game. The full
 * verification suite (spec cases + 40+ edge cases, ≥95% coverage) is
 * M3-T003; every expected value below is derived by hand from the
 * published rules (see README.md → "WHS verification policy").
 */
import { describe, expect, it } from "vitest";
import * as S from "../src";

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

describe("competition layer smoke (RoH 5.1/5.5, USGA card-off)", () => {
  it("stroke play: net totals, allowances, and shared tie positions", () => {
    const standings = S.computeStrokePlayStandings({
      course: course18,
      tee: course18.tees.white,
      players: [
        { id: "A", handicapIndex: 12.4, scores: { 1: 5, 2: 4, 3: 4, 4: 5 } },
        { id: "B", handicapIndex: 8.0, scores: { 1: 5, 2: 4, 3: 4, 4: 5 } },
        { id: "C", handicapIndex: 20.0, scores: { 1: 6, 2: 5, 3: 5, 4: 6 } },
      ],
    });
    // A: CH 13 → PH round(13 × .95) = 12; net (5−1)+(4−1)+(4−1)+(5−1) = 14
    // B: CH 8 → PH 8; net 14 (identical card → tied at position 1)
    // C: CH 22 → PH 21; strokes: 2 on SI 1–3, 1 on SI 4 → net 4+3+3+5 = 15
    expect(standings.map((s) => [s.id, s.position, s.tied])).toEqual([
      ["A", 1, true],
      ["B", 1, true],
      ["C", 3, false],
    ]);
    expect(standings.map((s) => s.net)).toEqual([14, 14, 15]);
    expect(standings.map((s) => s.playingHandicap)).toEqual([12, 8, 21]);
  });

  it("tiebreak: card-off resolves a total tie via the last holes", () => {
    const standings = S.computeStrokePlayStandings({
      course: course18,
      tee: course18.tees.white,
      players: [
        { id: "A", handicapIndex: 12.4, scores: { 1: 5, 2: 4, 3: 4, 4: 5 } },
        { id: "B", handicapIndex: 8.0, scores: { 1: 5, 2: 4, 3: 4, 4: 5 } },
      ],
      tiebreak: true,
    });
    // Identical cards: every card-off stage is equal and the backwards
    // comparison finds no difference → a genuine tie → shared position 1.
    expect(standings[0].tied).toBe(true);
    expect(standings[0].position).toBe(1);
    expect(standings[1].position).toBe(1);
    expect(standings[1].tied).toBe(true);
  });

  it("stableford: USGA/EGA scale points from net scores", () => {
    const standings = S.computeStablefordStandings({
      course: course18,
      tee: course18.tees.white,
      players: [
        // PH 12 → 1 stroke on SI 1–4: nets 4,3,3,4 → 0+2+2+0 = 4 points
        { id: "low", handicapIndex: 12.4, scores: { 1: 5, 2: 4, 3: 4, 4: 5 } },
        // PH 21 → 2 strokes on SI 1–3, 1 on SI 4: nets 4,3,3,5 → 0+2+2−1 = 3
        { id: "high", handicapIndex: 20.0, scores: { 1: 6, 2: 5, 3: 5, 4: 6 } },
      ],
    });
    expect(standings.map((s) => [s.id, s.points, s.position])).toEqual([
      ["low", 4, 1],
      ["high", 3, 2],
    ]);
  });

  it("best ball: team counts the single best net ball per hole (85%)", () => {
    const standings = S.computeBestBallStandings({
      course: course18,
      tee: course18.tees.white,
      teams: [
        {
          id: "T1",
          members: [
            // PH round(6.3 × .85) = 5 → 1 stroke on SI 1–5: nets 4,3,3
            { id: "a", handicapIndex: 6, scores: { 1: 5, 2: 4, 3: 4 } },
            { id: "b", handicapIndex: 14, scores: { 1: 7, 2: 6, 3: 5 } },
          ],
        },
      ],
    });
    // Best net ball: min(4,6), min(3,5), min(3,4) → 4+3+3 = 10
    expect(standings[0].total).toBe(10);
    expect(standings[0].members[0].playingHandicap).toBe(5);
  });

  it("scramble: team handicap is the sum of members' reduced handicaps", () => {
    const standings = S.computeScrambleStandings({
      course: course18,
      tee: course18.tees.white,
      allowanceFraction: 0.25,
      teams: [
        {
          id: "T1",
          scores: { 1: 4, 2: 4, 3: 5 },
          members: [
            // CH 11 (10 × 1.133 − 0.8 = 10.53 → 11) → reduced round(11 × .25) = 3
            { id: "m1", handicapIndex: 10, scores: {} },
            // CH 16 (15 × 1.133 − 0.8 = 16.2 → 16) → reduced 4
            { id: "m2", handicapIndex: 15, scores: {} },
          ],
        },
      ],
    });
    expect(standings[0].playingHandicap).toBe(7);
    // Team strokes: 1 on SI 1–7 → nets (4−1)+(4−1)+(5−1) = 10
    expect(standings[0].net).toBe(10);
  });

  it("shamble: every member plays their own ball, best N count", () => {
    const standings = S.computeShambleStandings({
      course: course18,
      tee: course18.tees.white,
      allowanceFraction: 0.9,
      teams: [
        {
          id: "S1",
          members: [
            // PH round(5.3 × .9) = 5 → nets 4,3
            { id: "s1a", handicapIndex: 5, scores: { 1: 5, 2: 4 } },
            { id: "s1b", handicapIndex: 12, scores: { 1: 6, 2: 5 } },
          ],
        },
      ],
    });
    expect(standings[0].total).toBe(4 + 3);
  });

  it("max score: net double bogey caps played and unplayed holes", () => {
    const card = S.computeScorecard({
      holes: [
        { holeNumber: 1, par: 4, strokeIndex: 18, strokes: 9 },
        { holeNumber: 2, par: 5, strokeIndex: 1, strokes: 11 },
      ],
      strokesByHole: { 1: 0, 2: 2 },
      maxScoreRule: { kind: "net_double_bogey" },
    });
    // RoH 3.3b: cap = par + 2 + strokes received → 6 and 9
    expect(card.map((h) => h.strokes)).toEqual([6, 9]);
    expect(card[1].netStrokes).toBe(7);
    expect(S.pickupScore({ kind: "net_double_bogey" }, 4, 1)).toBe(7);
  });

  it("flights: thresholds place players, open top absorbs the rest", () => {
    const flights = S.assignFlights({
      players: [
        { id: "p1", handicap: 4.2, sortId: "p1" },
        { id: "p2", handicap: 11.9, sortId: "p2" },
        { id: "p3", handicap: 22.5, sortId: "p3" },
      ],
      flights: [
        { name: "A", maxHandicap: 8 },
        { name: "B", maxHandicap: 15 },
        { name: "C", maxHandicap: null },
      ],
    });
    expect(flights.map((f) => [f.playerId, f.flightName])).toEqual([
      ["p1", "A"],
      ["p2", "B"],
      ["p3", "C"],
    ]);
  });

  it("payouts: 50/30/20 with a tie combining and splitting spanned slots", () => {
    const payouts = S.computePayouts({
      config: S.defaultPayoutConfig(30000),
      standings: [
        { id: "X", position: 1 },
        { id: "Y", position: 1 },
        { id: "Z", position: 3 },
      ],
    });
    // The X/Y tie spans slots 1–2 (50% + 30% = 24000), split evenly:
    // 12000 each — the combined amount is redistributed, never duplicated.
    expect(payouts.entries.find((e) => e.id === "X")?.amount).toBe(12000);
    expect(payouts.entries.find((e) => e.id === "Y")?.amount).toBe(12000);
    expect(payouts.entries.find((e) => e.id === "Z")?.amount).toBe(6000);
    const paid = payouts.entries.reduce((sum, e) => sum + e.amount, 0);
    expect(paid).toBe(30000);
  });

  it("skins: net variant with carryover on tied holes", () => {
    const skins = S.computeSkins({
      config: {
        variant: "net",
        holeValue: 1000,
        maxScoreRule: { kind: "none" },
      },
      holes: course18.holeList.slice(0, 4),
      entries: [
        {
          id: "A",
          scores: { 1: 4, 2: 5, 3: 4, 4: 4 },
          strokesByHole: { 1: 1, 2: 1, 3: 1, 4: 1 },
        },
        { id: "B", scores: { 1: 4, 2: 5, 3: 4, 4: 3 }, strokesByHole: {} },
      ],
    });
    // A nets 3,4,3 (strokes received) vs B's gross 4,5,4 → A wins holes
    // 1–3 at 1000 each; hole 4 ties (A net 3 vs B 3) → carryover.
    expect(skins.holeResults.map((h) => h.winnerId)).toEqual([
      "A",
      "A",
      "A",
      null,
    ]);
    expect(skins.holeResults[2].potValue).toBe(1000);
    expect(skins.holeResults[3].carryAmount).toBe(1000);
    expect(skins.leftovers).toBe(1000);
    expect(skins.totals).toEqual([{ id: "A", value: 3000 }]);
  });

  it("measured side games: lowest and highest measurements win", () => {
    expect(
      S.computeClosestToPin({
        holeNumber: 3,
        value: 500,
        measurements: [
          { id: "A", measurement: 6.5 },
          { id: "B", measurement: 8.2 },
        ],
      }),
    ).toEqual({ holeNumber: 3, winnerIds: ["A"], value: 500 });
    expect(
      S.computeLongDrive({
        holeNumber: 5,
        value: 500,
        measurements: [
          { id: "A", measurement: 280 },
          { id: "B", measurement: 295 },
        ],
      }),
    ).toEqual({ holeNumber: 5, winnerIds: ["B"], value: 500 });
    expect(
      S.computeLongestPutt({
        holeNumber: 7,
        value: 300,
        measurements: [
          { id: "A", measurement: 42 },
          { id: "B", measurement: 55 },
        ],
      }),
    ).toEqual({ holeNumber: 7, winnerIds: ["B"], value: 300 });
  });
});
