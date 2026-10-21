/**
 * Flight assignment verification: explicit thresholds, inclusive bounds,
 * an open-top flight absorbing everyone above, and deterministic
 * ordering within a flight.
 */
import { describe, expect, it } from "vitest";
import { assignFlights } from "../src";

const players = [
  { id: "p1", handicap: 4.2, sortId: "p1" },
  { id: "p2", handicap: 11.9, sortId: "p2" },
  { id: "p3", handicap: 22.5, sortId: "p3" },
  { id: "p4", handicap: 8.0, sortId: "p4" },
  { id: "p5", handicap: 8.0, sortId: "p5" },
  { id: "p6", handicap: 36.0, sortId: "p6" },
];

const flights = [
  { name: "A", maxHandicap: 8 },
  { name: "B", maxHandicap: 15 },
  { name: "C", maxHandicap: null },
];

describe("assignFlights", () => {
  it("places players by inclusive thresholds", () => {
    const result = assignFlights({ players: players.slice(0, 4), flights });
    expect(result.map((r) => [r.playerId, r.flightName, r.flightIndex])).toEqual([
      ["p1", "A", 0],
      ["p4", "A", 0],
      ["p2", "B", 1],
      ["p3", "C", 2],
    ]);
  });

  it("the open-top flight absorbs everyone above the last threshold", () => {
    const result = assignFlights({ players: [players[5]], flights });
    expect(result[0].flightName).toBe("C");
    expect(result[0].flightIndex).toBe(2);
  });

  it("orders within a flight by handicap then sortId", () => {
    const result = assignFlights({ players: [players[4], players[3]], flights });
    expect(result.map((r) => r.playerId)).toEqual(["p4", "p5"]);
  });

  it("a handicap below every threshold lands in the first flight", () => {
    const low = [{ id: "scratch", handicap: -1.5, sortId: "scratch" }];
    expect(assignFlights({ players: low, flights })[0].flightName).toBe("A");
  });

  it("no flights → no assignments", () => {
    expect(assignFlights({ players, flights: [] })).toEqual([]);
  });

  it("flights sort by threshold regardless of input order", () => {
    const result = assignFlights({
      players: [players[0]],
      flights: [flights[2], flights[1], flights[0]],
    });
    expect(result[0].flightName).toBe("A");
    expect(result[0].flightIndex).toBe(0);
  });
});
