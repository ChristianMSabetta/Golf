"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateHandicap, mergePlayers } from "@/lib/players/actions";
import {
  PLAYER_SORT_FIELDS,
  type DuplicateGroup,
  type PlayerRow,
  type PlayerSortField,
  type PlayersActionState,
} from "@/lib/players/schema";

/**
 * The club player table (M4-T002): search + sortable columns, an inline
 * handicap-index editor that persists per row through the shared Zod
 * contract, and one-click merge on flagged duplicates (same name AND
 * email). Search/sort ride the URL query so the server component
 * re-renders with server-side filtering; a merge refreshes the page so
 * counts and flags recompute server-side.
 */

const SORT_LABELS: Record<PlayerSortField, string> = {
  full_name: "Name",
  email: "Email",
  handicap_index: "HI",
  event_count: "Events",
  last_event_date: "Last event",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${month}/${day}/${year}`;
}

/** Sort field for a query string, defaulting to full_name. */
function sortFromParams(raw: string | null): PlayerSortField {
  return (PLAYER_SORT_FIELDS as readonly string[]).includes(raw ?? "")
    ? (raw as PlayerSortField)
    : "full_name";
}

// ─── Inline handicap edit ──────────────────────────────────────────────────────

function HandicapCell({
  player,
  canEdit,
}: {
  player: PlayerRow;
  canEdit: boolean;
}) {
  const original =
    player.handicapIndex === null ? "" : String(player.handicapIndex);
  const [value, setValue] = useState(original);
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<
    PlayersActionState,
    FormData
  >(updateHandicap, {});

  useEffect(() => {
    if (state.saved) setEditing(false);
  }, [state.saved]);

  if (!canEdit) {
    return (
      <span className="font-mono text-[0.8rem] tabular-nums">
        {original === "" ? "—" : original}
      </span>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-lg px-1.5 py-0.5 font-mono text-[0.8rem] tabular-nums hover:bg-muted"
        title="Edit handicap index"
      >
        {original === "" ? "—" : original}
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="playerId" value={player.id} />
      <Input
        name="handicapIndex"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        inputMode="decimal"
        className="h-7 w-20 font-mono text-[0.8rem] tabular-nums"
        aria-label={`Handicap index for ${player.fullName}`}
        aria-invalid={state.error ? true : undefined}
      />
      <Button
        type="submit"
        size="icon-xs"
        variant="ghost"
        disabled={pending}
        aria-label="Save handicap index"
      >
        <Check aria-hidden />
      </Button>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        onClick={() => {
          setEditing(false);
          setValue(original);
        }}
      >
        Cancel
      </Button>
      {state.error ? (
        <span role="alert" className="text-xs text-destructive">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

// ─── Duplicate merge ───────────────────────────────────────────────────────────

function MergeCell({
  keep,
  merge,
  canEdit,
}: {
  keep: PlayerRow;
  merge: PlayerRow;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<
    PlayersActionState,
    FormData
  >(mergePlayers, {});

  useEffect(() => {
    if (state.saved) router.refresh();
  }, [state.saved, router]);

  if (!canEdit) return <span className="text-muted-foreground">—</span>;

  return (
    <form action={action} className="flex flex-col items-start gap-0.5">
      <input type="hidden" name="keepId" value={keep.id} />
      <input type="hidden" name="mergeId" value={merge.id} />
      <Button
        type="submit"
        size="xs"
        variant="outline"
        disabled={pending}
        title={`Merge "${merge.fullName}" into "${keep.fullName}" — keep this row, move its ${merge.eventCount} event entries over`}
      >
        {pending ? "Merging…" : `Merge into this row (${merge.eventCount} event${merge.eventCount === 1 ? "" : "s"})`}
      </Button>
      {state.error ? (
        <span role="alert" className="text-xs text-destructive">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

// ─── Table ─────────────────────────────────────────────────────────────────────

export function PlayersTable({
  players,
  duplicates,
  canEdit,
}: {
  players: readonly PlayerRow[];
  duplicates: readonly DuplicateGroup[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [term, setTerm] = useState(searchParams.get("q") ?? "");

  const sort = sortFromParams(searchParams.get("sort"));
  const direction = searchParams.get("dir") === "desc" ? "desc" : "asc";

  // player id → the one other member of its duplicate group (pairs only;
  // groups of 3+ fall back to the panel above, one merge at a time).
  const mergePartner = new Map<string, PlayerRow>();
  for (const group of duplicates) {
    if (group.players.length === 2) {
      mergePartner.set(group.players[0]!.id, group.players[1]!);
      mergePartner.set(group.players[1]!.id, group.players[0]!);
    }
  }

  function navigate(next: {
    q?: string;
    sort?: PlayerSortField;
    dir?: "asc" | "desc";
  }) {
    const params = new URLSearchParams();
    const q = next.q ?? term.trim();
    const nextSort = next.sort ?? sort;
    const nextDir = next.dir ?? direction;
    if (q) params.set("q", q);
    if (nextSort !== "full_name") params.set("sort", nextSort);
    if (nextDir !== "asc") params.set("dir", nextDir);
    const query = params.toString();
    router.push(query ? `/admin/players?${query}` : "/admin/players");
  }

  function toggleSort(field: PlayerSortField) {
    if (field === sort) {
      navigate({ dir: direction === "asc" ? "desc" : "asc" });
    } else {
      navigate({ sort: field, dir: "asc" });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ q: term });
        }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search name, email, phone, or WHS #"
            className="pl-8"
            aria-label="Search players"
          />
        </div>
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-200 text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              {(
                ["full_name", "email", "handicap_index", "event_count", "last_event_date"] as const
              ).map((field) => {
                const active = sort === field;
                const Arrow = direction === "asc" ? ArrowUp : ArrowDown;
                return (
                  <th key={field} className="px-3 py-2 font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort(field)}
                      className={active ? "text-foreground" : undefined}
                      aria-label={`Sort by ${SORT_LABELS[field]}`}
                    >
                      {SORT_LABELS[field]}
                      {active ? (
                        <Arrow className="ml-1 inline size-3.5" aria-hidden />
                      ) : null}
                    </button>
                  </th>
                );
              })}
              <th className="px-3 py-2 font-medium">Merge</th>
            </tr>
          </thead>
          <tbody>
            {players.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  No players match your search.
                </td>
              </tr>
            ) : (
              players.map((player) => {
                const partner = mergePartner.get(player.id);
                return (
                  <tr
                    key={player.id}
                    className="border-b border-border/60 last:border-b-0"
                  >
                    <td className="px-3 py-2 font-medium">
                      {player.fullName}
                      {partner ? (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[0.7rem] font-medium text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
                          Duplicate
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {player.email ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <HandicapCell player={player} canEdit={canEdit} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {player.eventCount}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">
                      {formatDate(player.lastEventDate)}
                    </td>
                    <td className="px-3 py-2">
                      {partner ? (
                        <MergeCell
                          keep={player}
                          merge={partner}
                          canEdit={canEdit}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
