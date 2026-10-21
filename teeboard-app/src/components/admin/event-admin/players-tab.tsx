"use client";

import { useActionState } from "react";
import { CircleAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { removeEventPlayer } from "@/lib/players/roster-actions";
import type { PlayersActionState } from "@/lib/players/schema";

/**
 * Event admin Players tab (M4-T008): the event roster with quick edits —
 * remove a player from the event (the club player row stays). The handicap
 * index cell links to the club player table, where the inline edit lives
 * (one source of truth for a player's HI). Draft events only: a published
 * event's roster is the day's actual field, and the remove action is
 * refused server-side past publish.
 */

export function PlayersTab({
  eventId,
  isDraft,
  roster,
}: {
  eventId: string;
  isDraft: boolean;
  roster: readonly {
    readonly playerId: string;
    readonly fullName: string;
    readonly email: string | null;
    readonly handicapIndex: number | null;
    readonly groupName: string | null;
  }[];
}) {
  if (roster.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No players attached</CardTitle>
          <CardDescription>
            The roster is built in the wizard&apos;s Players step — CSV import,
            the club database, or one at a time.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event roster</CardTitle>
        <CardDescription>
          {roster.length} player{roster.length === 1 ? "" : "s"} attached
          {isDraft
            ? " — quick removals are open while the event is a draft."
            : " — the published field. Removal is closed past publish."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="py-2 pr-3">Player</th>
                <th scope="col" className="py-2 pr-3">Email</th>
                <th scope="col" className="py-2 pr-3 text-right">HI</th>
                <th scope="col" className="py-2 pr-3">Group</th>
                <th scope="col" className="py-2">
                  <span className="sr-only">Quick actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {roster.map((row) => (
                <PlayerRow
                  key={row.playerId}
                  eventId={eventId}
                  isDraft={isDraft}
                  row={row}
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function PlayerRow({
  eventId,
  isDraft,
  row,
}: {
  eventId: string;
  isDraft: boolean;
  row: {
    readonly playerId: string;
    readonly fullName: string;
    readonly email: string | null;
    readonly handicapIndex: number | null;
    readonly groupName: string | null;
  };
}) {
  const [state, formAction, pending] = useActionState<
    PlayersActionState,
    FormData
  >(removeEventPlayer, {});

  return (
    <tr className="border-t">
      <td className="py-2 pr-3 font-medium">{row.fullName}</td>
      <td className="py-2 pr-3 text-muted-foreground">{row.email ?? "—"}</td>
      <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">
        {row.handicapIndex === null ? "—" : row.handicapIndex}
      </td>
      <td className="py-2 pr-3 text-muted-foreground">{row.groupName ?? "—"}</td>
      <td className="py-2">
        {isDraft ? (
          <form action={formAction} className="inline">
            <input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="playerId" value={row.playerId} />
            <Button
              type="submit"
              variant="ghost"
              size="icon-xs"
              disabled={pending}
              title={state.error ?? `Remove ${row.fullName} from this event`}
            >
              <Trash2 className="size-3.5" aria-hidden />
              <span className="sr-only">
                Remove {row.fullName} from this event
              </span>
            </Button>
          </form>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
        {state.error ? (
          <p role="alert" className="text-xs text-destructive">
            <CircleAlert className="mr-1 inline size-3" aria-hidden />
            {state.error}
          </p>
        ) : null}
      </td>
    </tr>
  );
}
