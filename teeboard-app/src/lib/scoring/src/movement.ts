/**
 * Position-change movement between two snapshots of the same standings.
 *
 * Part of the lib/scoring package on purpose: computing "how a position
 * changed" is standings arithmetic, so the architectural rule that no
 * scoring math lives outside this package (rule C13) applies to it too.
 * Pages and components render movement, they never compute it.
 */
import type { StrokePlayStanding } from "./types";

/** Movement of one participant between two snapshots of the standings. */
export interface StandingMovement {
  id: string;
  /** Position in the previous snapshot (`null` when newly posted). */
  previousPosition: number | null;
  /** Position in the current snapshot (`null` when no longer posted). */
  currentPosition: number | null;
  /** Positions climbed (positive), lost (negative), 0 = unchanged/absent. */
  delta: number;
  /** "up" (climbed), "down" (lost), "same", "new" (was not posted before). */
  direction: "up" | "down" | "same" | "new";
}

/** Comparable position view of one standings row. */
export interface StandingPosition {
  id: string;
  position: number;
}

/** Position view of a standings row (any format row carries id + position). */
export function standingPositions<Row extends StandingPosition>(
  standings: Row[],
): StandingPosition[] {
  return standings.map(({ id, position }) => ({ id, position }));
}

/**
 * Compute the position change of every participant between two snapshots
 * of the same standings. A participant is identified by `id`; a participant
 * missing from the current snapshot (picked up, no completed holes) is
 * reported with a `null` current position rather than dropped.
 *
 * `delta` is `previousPosition - currentPosition`: climbing to a lower
 * (better) position number is positive.
 */
export function computePositionMovements(
  previous: StandingPosition[],
  current: StandingPosition[],
): StandingMovement[] {
  const previousById = new Map(previous.map((row) => [row.id, row.position]));

  const movements: StandingMovement[] = current.map((row) => {
    const previousPosition = previousById.get(row.id) ?? null;
    const delta =
      previousPosition === null ? 0 : previousPosition - row.position;
    return {
      id: row.id,
      previousPosition,
      currentPosition: row.position,
      delta,
      direction:
        previousPosition === null
          ? "new"
          : delta > 0
            ? "up"
            : delta < 0
              ? "down"
              : "same",
    };
  });

  const currentIds = new Set(current.map((row) => row.id));
  for (const [id, previousPosition] of previousById) {
    if (!currentIds.has(id)) {
      movements.push({
        id,
        previousPosition,
        currentPosition: null,
        delta: 0,
        direction: "same",
      });
    }
  }

  return movements;
}

/** Movement of each stroke-play row between two standings snapshots. */
export function strokePlayMovements(
  previous: StrokePlayStanding[],
  current: StrokePlayStanding[],
): StandingMovement[] {
  return computePositionMovements(
    standingPositions(previous),
    standingPositions(current),
  );
}
