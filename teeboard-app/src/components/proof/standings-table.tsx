"use client";

/**
 * The proof leaderboard: gross and net stroke-play standings, computed
 * entirely through @teeboard/scoring. The component renders standings; it
 * never computes them — every total, handicap, and position comes from the
 * package, and every position-change arrow comes from its movement module.
 */
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import {
  computeStrokePlayStandings,
  computePositionMovements,
  type ScoringBasis,
  type StrokePlayStanding,
} from "@/lib/scoring";
import {
  SEEDED_EVENT,
  UPDATED_PLAYERS,
  type SeededPlayer,
} from "@/lib/leaderboard/fixture";
import { Button } from "@/components/ui/button";

const { course, tee, players } = SEEDED_EVENT;

/** One full standings snapshot: computed rows plus display names. */
interface StandingsSnapshot {
  standings: StrokePlayStanding[];
  names: Record<string, string>;
}

/** Compute one standings snapshot, ranked by the given basis. */
function computeSnapshot(
  field: readonly SeededPlayer[],
  basis: ScoringBasis,
): StandingsSnapshot {
  return {
    standings: computeStrokePlayStandings({
      course,
      tee,
      basis,
      players: field.map(({ id, handicapIndex, scores }) => ({
        id,
        handicapIndex,
        scores,
      })),
    }),
    names: Object.fromEntries(field.map((p) => [p.id, p.name])),
  };
}

const TABLE_HEADERS = [
  { label: "Pos", align: "text-left" },
  { label: "Player", align: "text-left" },
  { label: "Thru", align: "text-right" },
  { label: "CH", align: "text-right" },
  { label: "PH", align: "text-right" },
  { label: "Gross", align: "text-right" },
  { label: "Net", align: "text-right" },
  { label: "Move", align: "text-right" },
] as const;

/** Movement arrow for one standings row (up / down / same / new). */
function MovementArrow({
  direction,
  delta,
}: {
  direction: "up" | "down" | "same" | "new";
  delta: number;
}) {
  const label =
    direction === "up"
      ? `Moved up ${delta}`
      : direction === "down"
        ? `Moved down ${Math.abs(delta)}`
        : direction === "new"
          ? "New to the standings"
          : "No change";
  if (direction === "up") {
    return (
      <span
        className="inline-flex items-center gap-1 text-emerald-700"
        aria-label={label}
        title={label}
      >
        <ArrowUp className="size-3.5" aria-hidden />
        <span className="numeric">{delta}</span>
      </span>
    );
  }
  if (direction === "down") {
    return (
      <span
        className="inline-flex items-center gap-1 text-red-700"
        aria-label={label}
        title={label}
      >
        <ArrowDown className="size-3.5" aria-hidden />
        <span className="numeric">{Math.abs(delta)}</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-muted-foreground"
      aria-label={label}
      title={label}
    >
      <Minus className="size-3.5" aria-hidden />
    </span>
  );
}

/** One standings table: gross- or net-ranked view of the field. */
function StandingsSection({
  title,
  snapshot,
  movements,
}: {
  title: string;
  snapshot: StandingsSnapshot;
  movements: ReturnType<typeof computePositionMovements>;
}) {
  const movementById = new Map(movements.map((m) => [m.id, m]));
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="font-heading text-lg font-semibold text-foreground">
        {title}
      </h3>
      <table className="w-full overflow-hidden rounded-xl text-sm ring-1 ring-foreground/10">
        <thead>
          <tr className="bg-secondary text-secondary-foreground">
            {TABLE_HEADERS.map((header) => (
              <th
                key={header.label}
                scope="col"
                className={`px-3 py-2 font-medium ${header.align}`}
              >
                {header.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/80">
          {snapshot.standings.map((row) => {
            const movement = movementById.get(row.id);
            return (
              <tr key={row.id} className="bg-card">
                <td className="px-3 py-2 text-left font-medium text-foreground">
                  <span className="mr-1 font-heading text-brand">
                    {row.position}
                  </span>
                  {row.tied ? <span title="Tied">T</span> : null}
                </td>
                <td className="px-3 py-2 text-left font-medium text-foreground">
                  {snapshot.names[row.id]}
                </td>
                <td className="numeric px-3 py-2 text-right text-muted-foreground">
                  {row.thru}
                </td>
                <td className="numeric px-3 py-2 text-right text-foreground">
                  {row.courseHandicap}
                </td>
                <td className="numeric px-3 py-2 text-right text-foreground">
                  {row.playingHandicap}
                </td>
                <td className="numeric px-3 py-2 text-right font-medium text-foreground">
                  {row.gross}
                </td>
                <td className="numeric px-3 py-2 text-right font-medium text-brand">
                  {row.net}
                </td>
                <td className="px-3 py-2 text-right">
                  <MovementArrow
                    direction={movement?.direction ?? "same"}
                    delta={movement?.delta ?? 0}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/**
 * The full proof view: the seeded standings, the standings after the
 * simulated score update, and the movement arrows between the snapshots.
 */
export function StandingsTable() {
  const [updated, setUpdated] = useState(false);

  const field = updated ? UPDATED_PLAYERS : players;

  const beforeGross = useMemo(() => computeSnapshot(players, "gross"), []);
  const beforeNet = useMemo(() => computeSnapshot(players, "net"), []);
  const afterGross = useMemo(
    () => computeSnapshot(field, "gross"),
    [field],
  );
  const afterNet = useMemo(() => computeSnapshot(field, "net"), [field]);

  const grossMovements = useMemo(
    () => computePositionMovements(beforeGross.standings, afterGross.standings),
    [beforeGross, afterGross],
  );
  const netMovements = useMemo(
    () => computePositionMovements(beforeNet.standings, afterNet.standings),
    [beforeNet, afterNet],
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-semibold text-brand">
            {SEEDED_EVENT.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            {SEEDED_EVENT.course.holes} holes · par{" "}
            <span className="numeric">{SEEDED_EVENT.course.par}</span> ·{" "}
            {SEEDED_EVENT.teeName} tees (CR{" "}
            <span className="numeric">{SEEDED_EVENT.tee.courseRating}</span> ·
            SR <span className="numeric">{SEEDED_EVENT.tee.slopeRating}</span>)
          </p>
        </div>
        <Button
          onClick={() => setUpdated((v) => !v)}
          variant={updated ? "outline" : "default"}
          aria-pressed={updated}
        >
          {updated ? "Reset to seeded scores" : "Apply simulated score update"}
        </Button>
      </div>

      <StandingsSection
        title="Gross standings"
        snapshot={afterGross}
        movements={grossMovements}
      />
      <StandingsSection
        title="Net standings"
        snapshot={afterNet}
        movements={netMovements}
      />

      <p className="text-sm text-muted-foreground">
        {updated
          ? "Simulated update applied to the seed data in memory: every total, position, and movement arrow recomputed through the scoring package."
          : "Seeded fixture standings. Apply the simulated score update to recompute every total and movement arrow client-side."}
      </p>
    </div>
  );
}
