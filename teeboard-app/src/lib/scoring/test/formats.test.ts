/**
 * Competition format verification: the five formats with WHS allowance
 * defaults (Rules of Handicapping 5.5 — 95% individual, 85% four-ball),
 * ranking bases, tiebreak wiring, and team-size bounds. Handicap
 * values are derived through the handicap layer exactly as the rules
 * prescribe; per-hole expectations are hand-derived from the fixtures.
 */
import { describe, expect, it } from "vitest";
import {
  computeBestBallStandings,
  computePlayerCard,
  computeScrambleStandings,
  computeShambleStandings,
  computeStablefordStandings,
  computeStrokePlayStandings,
  validateTeamSize,
} from "../src";
import { FLAT_18 } from "./fixtures";

const course = FLAT_18;
const tee = FLAT_18.tees.white;

describe("computePlayerCard", () => {
  it("chains handicap → allocation → scorecard", () => {
    // HI 12.4 → CH 13 → PH 12 (95%): strokes on SI 1–12 of FLAT_18.
    const card = computePlayerCard({
      player: { id: "p", handicapIndex: 12.4, scores: { 1: 5, 2: 4, 13: 6 } },
      course,
      tee,
      allowance: { fraction: 0.95 },
      maxScoreRule: { kind: "none" },
      strokeIndexMode: "full",
    });
    expect(card.playingHandicap).toBe(12);
    expect(card.strokesByHole[1]).toBe(1);
    expect(card.strokesByHole[13]).toBe(0);
    expect(card.thru).toBe(3);
    expect(card.card[0].netStrokes).toBe(4);
    // hole 13 (SI 13 > PH 12) → no strokes received
    expect(card.card[12].strokes).toBe(6);
    expect(card.card[12].netStrokes).toBe(6);
    expect(card.card[12].strokesReceived).toBe(0);
  });

  it("honors committee overrides end-to-end (RoH 5.6)", () => {
    const card = computePlayerCard({
      player: {
        id: "p",
        handicapIndex: 12.4,
        scores: { 1: 5 },
        playingHandicapOverride: { playingHandicap: 0 },
      },
      course,
      tee,
      allowance: { fraction: 0.95 },
      maxScoreRule: { kind: "none" },
      strokeIndexMode: "full",
    });
    expect(card.playingHandicap).toBe(0);
    expect(card.strokesByHole[1]).toBe(0);
    expect(card.card[0].netStrokes).toBe(5);
  });
});

describe("stroke play (RoH 5.5: default 95% allowance)", () => {
  it("spec case: net totals and 95% default allowance", () => {
    const standings = computeStrokePlayStandings({
      course,
      tee,
      players: [
        { id: "A", handicapIndex: 12.4, scores: { 1: 5, 2: 4, 3: 4, 4: 5 } },
        { id: "B", handicapIndex: 8.0, scores: { 1: 5, 2: 4, 3: 4, 4: 5 } },
      ],
    });
    // A: CH 13, PH 12 → strokes SI 1–12 → holes 1–4 get 1 → net 14.
    // B: CH 8, PH 8 → net 14. Tied at 1; next position is 3.
    expect(standings.map((s) => [s.id, s.position, s.tied, s.net, s.gross])).toEqual([
      ["A", 1, true, 14, 18],
      ["B", 1, true, 14, 18],
    ]);
    expect(standings[0].playingHandicap).toBe(12);
    expect(standings[1].playingHandicap).toBe(8);
    expect(standings[0].thru).toBe(4);
  });

  it("ranks by gross when basis is gross (PH applies only to net)", () => {
    const standings = computeStrokePlayStandings({
      course,
      tee,
      basis: "gross",
      players: [
        { id: "high", handicapIndex: 20, scores: { 1: 7, 2: 6 } },
        { id: "low", handicapIndex: 0.0, scores: { 1: 5, 2: 4 } },
      ],
    });
    expect(standings.map((s) => [s.id, s.position, s.gross])).toEqual([
      ["low", 1, 9],
      ["high", 2, 13],
    ]);
    // Net is still reported: high CH 22 (20×128/113 − 0.8 = 21.885… → 22),
    // PH 21 (22×0.95 = 20.9 → 21) → 2 strokes on holes 1–2.
    // low CH −1 (0×128/113 − 0.8), PH −1 → 1 stroke given back on hole 1.
    expect(standings[1].net).toBe(7 + 6 - 2 - 2);
    expect(standings[0].net).toBe(5 + 1 + 4);
  });

  it("tiebreak: card-off resolves a total tie hole-by-hole", () => {
    // Both total 13 (PH forced to 0 by Committee override, RoH 5.6);
    // stages 9/6/3 all cover holes 1–3 and tie, then the backwards read
    // hits hole 3 first: A 4 vs B 5 → A wins the position.
    const scratch = { playingHandicap: 0 };
    const standings = computeStrokePlayStandings({
      course,
      tee,
      tiebreak: true,
      players: [
        { id: "B", handicapIndex: 10, scores: { 1: 4, 2: 4, 3: 5 }, playingHandicapOverride: scratch },
        { id: "A", handicapIndex: 10, scores: { 1: 4, 2: 5, 3: 4 }, playingHandicapOverride: scratch },
      ],
    });
    expect(standings.map((s) => [s.id, s.position, s.tied, s.net])).toEqual([
      ["A", 1, false, 13],
      ["B", 2, false, 13],
    ]);
  });

  it("tiebreak: identical cards stay genuinely tied", () => {
    const standings = computeStrokePlayStandings({
      course,
      tee,
      tiebreak: true,
      players: [
        { id: "A", handicapIndex: 10, scores: { 1: 5, 2: 4 } },
        { id: "B", handicapIndex: 10, scores: { 1: 5, 2: 4 } },
      ],
    });
    expect(standings.map((s) => [s.id, s.position, s.tied])).toEqual([
      ["A", 1, true],
      ["B", 1, true],
    ]);
  });

  it("empty field → empty standings", () => {
    expect(computeStrokePlayStandings({ course, tee, players: [] })).toEqual([]);
  });

  it("partial scorecards rank by played holes only", () => {
    const standings = computeStrokePlayStandings({
      course,
      tee,
      players: [
        { id: "partial", handicapIndex: 10, scores: { 1: 6 } },
        { id: "full", handicapIndex: 10, scores: { 1: 4, 2: 5 } },
      ],
    });
    // partial net 6−1=5 (PH 9); full net 4−1 + 5−1 = 7 → partial wins.
    expect(standings.map((s) => [s.id, s.position, s.net, s.thru])).toEqual([
      ["partial", 1, 5, 1],
      ["full", 2, 7, 2],
    ]);
  });

  it("a max-score rule caps scores before totals", () => {
    const standings = computeStrokePlayStandings({
      course,
      tee,
      players: [{ id: "blowup", handicapIndex: 10, scores: { 1: 12 } }],
      maxScoreRule: { kind: "net_double_bogey" },
    });
    // PH 9 → 1 stroke on hole 1 → cap 4+2+1 = 7 → net 6.
    expect(standings[0].gross).toBe(7);
    expect(standings[0].net).toBe(6);
  });
});

describe("stableford standings (ranked by points, higher wins)", () => {
  it("awards positions by total points with the 95% default", () => {
    const standings = computeStablefordStandings({
      course,
      tee,
      players: [
        // PH 12 → nets 4,3,3,4 → 0+2+2+0 = 4 points
        { id: "low", handicapIndex: 12.4, scores: { 1: 5, 2: 4, 3: 4, 4: 5 } },
        // PH 21 → 2 strokes SI 1–3, 1 on SI 4 → nets 4,3,3,5 → 3 points
        { id: "high", handicapIndex: 20.0, scores: { 1: 6, 2: 5, 3: 5, 4: 6 } },
      ],
    });
    expect(standings.map((s) => [s.id, s.points, s.position, s.tied])).toEqual([
      ["low", 4, 1, false],
      ["high", 3, 2, false],
    ]);
  });

  it("tied points share a position without tiebreak; card-off orders with it", () => {
    const players = [
      { id: "A", handicapIndex: 10, scores: { 1: 4, 2: 4 } },
      { id: "B", handicapIndex: 10, scores: { 1: 4, 2: 4 } },
    ];
    const shared = computeStablefordStandings({ course, tee, players });
    expect(shared.map((s) => s.position)).toEqual([1, 1]);
    expect(shared.every((s) => s.tied)).toBe(true);
  });
});

describe("scramble (team handicap = sum of allowance-reduced CHs)", () => {
  it("reduces each member's CH by the allowance fraction, allocates to the team", () => {
    const standings = computeScrambleStandings({
      course,
      tee,
      allowanceFraction: 0.25,
      teams: [
        {
          id: "T1",
          scores: { 1: 4, 2: 4, 3: 5 },
          members: [
            // CH: 10×128/113 − 0.8 = 10.53… → 11; reduced 11×0.25 = 2.75 → 3
            { id: "m1", handicapIndex: 10, scores: {} },
            // CH: 15×128/113 − 0.8 = 16.2… → 16; reduced 4
            { id: "m2", handicapIndex: 15, scores: {} },
          ],
        },
      ],
    });
    expect(standings[0].playingHandicap).toBe(7);
    expect(standings[0].members.map((m) => [m.id, m.courseHandicap, m.reducedHandicap])).toEqual([
      ["m1", 11, 3],
      ["m2", 16, 4],
    ]);
    // Team strokes: 1 on SI 1–7 → holes 1–3 → nets 3 + 3 + 4 = 10.
    expect(standings[0].net).toBe(10);
    expect(standings[0].gross).toBe(13);
  });

  it("validates team size against the bounds", () => {
    expect(() =>
      computeScrambleStandings({
        course,
        tee,
        allowanceFraction: 0.25,
        teams: [
          {
            id: "T1",
            scores: {},
            members: [
              { id: "a", handicapIndex: 10, scores: {} },
              { id: "b", handicapIndex: 10, scores: {} },
              { id: "c", handicapIndex: 10, scores: {} },
              { id: "d", handicapIndex: 10, scores: {} },
              { id: "e", handicapIndex: 10, scores: {} },
            ],
          },
        ],
      }),
    ).toThrow(/outside the configured bounds/);
    expect(() => validateTeamSize(5)).toThrow();
    expect(() => validateTeamSize(1)).toThrow();
    expect(() => validateTeamSize(2)).not.toThrow();
    expect(() => validateTeamSize(4)).not.toThrow();
    expect(() => validateTeamSize(3, { min: 3, max: 3 })).not.toThrow();
    expect(() => validateTeamSize(2, { min: 3, max: 3 })).toThrow();
  });
});

describe("best ball / four-ball (RoH 5.5: default 85% allowance)", () => {
  it("counts the best ball per hole under the 85% default", () => {
    const standings = computeBestBallStandings({
      course,
      tee,
      teams: [
        {
          id: "T1",
          members: [
            // CH 6×128/113−0.8 = 5.996… → 6; PH round(6×0.85) = round(5.1) = 5
            { id: "a", handicapIndex: 6, scores: { 1: 5, 2: 4, 3: 4 } },
            // CH 14×128/113−0.8 = 15.06… → 15; PH round(12.75) = 13
            { id: "b", handicapIndex: 14, scores: { 1: 7, 2: 6, 3: 5 } },
          ],
        },
      ],
    });
    // a nets 4,3,3 (strokes SI 1–5 → holes 1–3); b nets 6,5,4 (SI 1–13).
    // Best ball: 4, 3, 3 → total 10.
    expect(standings[0].total).toBe(10);
    expect(standings[0].members.map((m) => m.playingHandicap)).toEqual([5, 13]);
    expect(standings[0].thru).toBe(3);
  });

  it("countable N > 1 sums the N best balls per hole", () => {
    const standings = computeBestBallStandings({
      course,
      tee,
      countable: 2,
      teams: [
        {
          id: "T1",
          members: [
            { id: "a", handicapIndex: 0.0, scores: { 1: 4 } },
            { id: "b", handicapIndex: 0.0, scores: { 1: 5 } },
            { id: "c", handicapIndex: 0.0, scores: { 1: 6 } },
          ],
        },
      ],
    });
    // Scratch HI on this tee: CH 0 × 128/113 + (71.2 − 72) = −0.8 → −1;
    // PH round(−1 × 0.85) = round(−0.85) = −1 → one stroke given back on
    // hole 1 → nets 5, 6, 7 → best two = 11.
    expect(standings[0].members.map((m) => m.playingHandicap)).toEqual([-1, -1, -1]);
    expect(standings[0].total).toBe(11);
  });

  it("holes nobody played are absent (thru counts played holes)", () => {
    const standings = computeBestBallStandings({
      course,
      tee,
      teams: [
        {
          id: "T1",
          members: [
            { id: "a", handicapIndex: 0.0, scores: { 2: 4 } },
            { id: "b", handicapIndex: 0.0, scores: {} },
          ],
        },
      ],
    });
    expect(standings[0].total).toBe(4);
    expect(standings[0].thru).toBe(1);
  });
});

describe("shamble", () => {
  it("reduces every member's PH by the required allowance fraction", () => {
    const standings = computeShambleStandings({
      course,
      tee,
      allowanceFraction: 0.9,
      teams: [
        {
          id: "S1",
          members: [
            // CH 5×128/113 − 0.8 = 4.858… → 5; PH 5×0.9 = 4.5 → 5 (.5 up)
            { id: "s1a", handicapIndex: 5, scores: { 1: 5, 2: 4 } },
            { id: "s1b", handicapIndex: 12, scores: { 1: 6, 2: 5 } },
          ],
        },
      ],
    });
    expect(standings[0].members.map((m) => m.playingHandicap)).toEqual([5, 12]);
    // s1a nets 4,3; s1b (CH 13×0.9 = 11.7 → 12) nets 4,3 → best 4 + 3 = 7.
    expect(standings[0].total).toBe(7);
  });
});
