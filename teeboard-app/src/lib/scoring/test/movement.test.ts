/**
 * Position-change movement verification.
 *
 * The movement contract is standings arithmetic (rule C13): the cases below
 * derive every expectation by hand from the definition — delta =
 * previousPosition - currentPosition, climbing is positive — rather than
 * mirroring the implementation.
 */
import { describe, expect, it } from "vitest";
import {
  computePositionMovements,
  standingPositions,
  strokePlayMovements,
} from "../src";
import type { StrokePlayStanding } from "../src";

function strokePlayStanding(
  id: string,
  position: number,
): StrokePlayStanding {
  return {
    id,
    position,
    tied: false,
    gross: 80,
    net: 72,
    playingHandicap: 8,
    courseHandicap: 8,
    card: [],
    thru: 18,
    cardOff: { stages: [], backwards: [] },
  };
}

describe("computePositionMovements", () => {
  it("reports no movement when both snapshots rank identically", () => {
    const previous = [
      { id: "a", position: 1 },
      { id: "b", position: 2 },
      { id: "c", position: 3 },
    ];
    const movements = computePositionMovements(previous, [...previous]);
    expect(movements.map((m) => [m.id, m.delta, m.direction])).toEqual([
      ["a", 0, "same"],
      ["b", 0, "same"],
      ["c", 0, "same"],
    ]);
  });

  it("reports climbing as positive delta and falling as negative", () => {
    // Hand-derived: b moved 2 -> 1 (delta 1, up); a moved 1 -> 2 (delta -1,
    // down); c stays at 3 (delta 0, same).
    const previous = [
      { id: "a", position: 1 },
      { id: "b", position: 2 },
      { id: "c", position: 3 },
    ];
    const current = [
      { id: "b", position: 1 },
      { id: "a", position: 2 },
      { id: "c", position: 3 },
    ];
    const movements = computePositionMovements(previous, current);
    expect(movements).toEqual([
      {
        id: "b",
        previousPosition: 2,
        currentPosition: 1,
        delta: 1,
        direction: "up",
      },
      {
        id: "a",
        previousPosition: 1,
        currentPosition: 2,
        delta: -1,
        direction: "down",
      },
      {
        id: "c",
        previousPosition: 3,
        currentPosition: 3,
        delta: 0,
        direction: "same",
      },
    ]);
  });

  it("marks a participant missing from the previous snapshot as new", () => {
    const movements = computePositionMovements(
      [{ id: "a", position: 1 }],
      [
        { id: "a", position: 1 },
        { id: "b", position: 2 },
      ],
    );
    expect(movements).toEqual([
      {
        id: "a",
        previousPosition: 1,
        currentPosition: 1,
        delta: 0,
        direction: "same",
      },
      {
        id: "b",
        previousPosition: null,
        currentPosition: 2,
        delta: 0,
        direction: "new",
      },
    ]);
  });

  it("keeps a participant missing from the current snapshot at delta 0", () => {
    const movements = computePositionMovements(
      [
        { id: "a", position: 1 },
        { id: "b", position: 2 },
      ],
      [{ id: "a", position: 1 }],
    );
    expect(movements).toEqual([
      {
        id: "a",
        previousPosition: 1,
        currentPosition: 1,
        delta: 0,
        direction: "same",
      },
      {
        id: "b",
        previousPosition: 2,
        currentPosition: null,
        delta: 0,
        direction: "same",
      },
    ]);
  });

  it("reports movement against both empty snapshots", () => {
    expect(computePositionMovements([], [])).toEqual([]);
  });
});

describe("standingPositions", () => {
  it("reduces any standings row to its id and position", () => {
    const rows = [
      strokePlayStanding("p1", 2),
      strokePlayStanding("p2", 1),
    ];
    expect(standingPositions(rows)).toEqual([
      { id: "p1", position: 2 },
      { id: "p2", position: 1 },
    ]);
  });
});

describe("strokePlayMovements", () => {
  it("derives movement from full stroke-play standings rows", () => {
    const previous = [
      strokePlayStanding("p1", 1),
      strokePlayStanding("p2", 2),
      strokePlayStanding("p3", 3),
    ];
    const current = [
      strokePlayStanding("p3", 1),
      strokePlayStanding("p1", 2),
      strokePlayStanding("p2", 3),
    ];
    const movements = strokePlayMovements(previous, current);
    expect(movements.map((m) => [m.id, m.delta, m.direction])).toEqual([
      ["p3", 2, "up"],
      ["p1", -1, "down"],
      ["p2", -1, "down"],
    ]);
  });
});
