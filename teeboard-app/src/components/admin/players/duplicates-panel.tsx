"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { mergePlayers } from "@/lib/players/actions";
import { pickMergeKeeper } from "@/lib/players/duplicates";
import type { DuplicateGroup, PlayersActionState } from "@/lib/players/schema";

/**
 * Duplicate players panel (M4-T002): players sharing the same name AND
 * email, with a one-click merge per pair. The keeper is the row with the
 * most event history (pickMergeKeeper, the same rule the table uses);
 * merges refresh the page so flags and counts recompute.
 */

function DuplicateGroupCard({
  group,
  keeperId,
  canEdit,
}: {
  group: DuplicateGroup;
  keeperId: string;
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

  const others = group.players.filter((player) => player.id !== keeperId);

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-heading text-sm font-medium text-amber-900 dark:text-amber-200">
          {group.fullName}
          <span className="ml-2 font-mono text-xs font-normal">
            {group.email}
          </span>
        </p>
      </div>
      <ul className="mt-2 flex flex-col gap-1 text-xs text-amber-900/80 dark:text-amber-200/80">
        {group.players.map((player) => (
          <li key={player.id} className="flex items-center gap-2">
            <Copy className="size-3 shrink-0" aria-hidden />
            <span className="font-medium">{player.fullName}</span>
            <span>· {player.eventCount} event(s)</span>
            <span>{player.id === keeperId ? "· keeps" : ""}</span>
          </li>
        ))}
      </ul>
      {canEdit ? (
        <div className="flex flex-col gap-1">
          {others.map((other) => (
            <form key={other.id} action={action}>
              <input type="hidden" name="keepId" value={keeperId} />
              <input type="hidden" name="mergeId" value={other.id} />
              <Button
                type="submit"
                size="xs"
                variant="outline"
                disabled={pending}
              >
                {pending
                  ? "Merging…"
                  : `Merge "${other.fullName}" into "${group.fullName}"`}
              </Button>
              {state.error ? (
                <span role="alert" className="ml-2 text-xs text-destructive">
                  {state.error}
                </span>
              ) : null}
            </form>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DuplicatesPanel({
  duplicates,
  canEdit,
}: {
  duplicates: readonly DuplicateGroup[];
  canEdit: boolean;
}) {
  if (duplicates.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Copy className="size-4" aria-hidden />
          Duplicate players
        </CardTitle>
        <CardDescription>
          {duplicates.length} group(s) share the same name and email. Merging
          keeps the row with the most events, preserves every event entry,
          and deletes the other row — nothing is orphaned.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {duplicates.map((group) => (
          <DuplicateGroupCard
            key={group.key}
            group={group}
            keeperId={pickMergeKeeper(group).id}
            canEdit={canEdit}
          />
        ))}
      </CardContent>
    </Card>
  );
}
