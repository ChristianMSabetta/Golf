"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  CircleAlert,
  Dices,
  GripVertical,
  Plus,
  Save,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { saveGroupsStep } from "@/lib/events/groups-actions";
import {
  generatePairingPlan,
  movePairingPlayer,
  normalizePairingPlan,
  shotgunHoles,
  validatePairingPlan,
  PAIRING_STRATEGIES,
  type PairingPlan,
  type PairingPlayer,
  type PairingStrategy,
} from "@/lib/events/pairing";
import type { WizardActionState } from "@/lib/events/schema";
import type { GroupRow, GroupedAttachmentRow } from "@/lib/events/server";

/**
 * Wizard Groups & teams step (M4-T006): automatic group generation with
 * four pairing strategies (random, balanced by handicap, sorted,
 * manual), an interactive drag-and-drop editor across groups and the
 * unassigned pool, shotgun starting-hole assignment when the event is a
 * shotgun start, and cart numbers per group — all persisted through the
 * role-gated server action onto the event's `groups` +
 * `event_players.group_id` rows.
 *
 * Drag-and-drop rides the native HTML5 API (draggable + dataTransfer) —
 * no virtual list or third-party DnD dependency — so a 120-player field
 * renders as flat rows and every move is a state splice, never a reflow
 * storm: the UI stays responsive while the field grows.
 */

const STRING_SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const STRATEGY_LABELS: Record<PairingStrategy, string> = {
  random: "Random",
  handicap_balance: "Balance by handicap",
  sorted: "Sorted by handicap",
  manual: "Manual (drag players yourself)",
};

const DRAG_MIME = "application/x-teeboard-player";

export function GroupsStep({
  eventId,
  draft,
  attached,
  groups,
  readOnly = false,
  onSaved = () => {},
}: {
  eventId: string | null;
  draft: {
    readonly holesCount: number;
    readonly nineOption: "front" | "back";
    readonly startType: "tee_times" | "shotgun";
    readonly formatData: { readonly teamSize: number } | null;
  } | null;
  attached: readonly GroupedAttachmentRow[];
  groups: readonly GroupRow[];
  readOnly?: boolean;
  /** Notified after a successful save — the wizard refreshes its props. */
  onSaved?: (savedAt: string) => void;
}) {
  const teamSize = draft?.formatData?.teamSize ?? 1;
  const isShotgun = draft?.startType === "shotgun";
  const holes = useMemo(
    () => shotgunHoles(draft?.holesCount ?? 18, draft?.nineOption ?? "front"),
    [draft?.holesCount, draft?.nineOption],
  );

  // The players as the pairing engine sees them — attached rows only.
  const players = useMemo<readonly PairingPlayer[]>(
    () =>
      attached.map((row) => ({
        playerId: row.playerId,
        fullName: row.fullName,
        handicapIndex: row.handicapIndex,
      })),
    [attached],
  );
  const playerById = useMemo(() => {
    const map = new Map<string, (typeof players)[number]>();
    for (const player of players) map.set(player.playerId, player);
    return map;
  }, [players]);

  // Rebuild the persisted plan once, from the server rows.
  const persistedPlan = useMemo<PairingPlan>(() => {
    if (groups.length === 0) {
      return {
        groups: [],
        unassigned: players.map((player) => player.playerId),
      };
    }
    const groupIds = new Set(groups.map((group) => group.id));
    const grouped = new Map<string, string[]>();
    for (const group of groups) grouped.set(group.id, []);
    const unassigned: string[] = [];
    for (const row of attached) {
      if (row.groupId !== null && groupIds.has(row.groupId)) {
        grouped.get(row.groupId)!.push(row.playerId);
      } else {
        unassigned.push(row.playerId);
      }
    }
    return {
      groups: groups.map((group) => ({
        name: group.name,
        playerIds: grouped.get(group.id) ?? [],
        startingHole: group.startingHole,
        cartNumber: group.cartNumber,
      })),
      unassigned,
    };
  }, [groups, attached, players]);

  const [strategy, setStrategy] = useState<PairingStrategy>("random");
  const [seed, setSeed] = useState(1);
  const [plan, setPlan] = useState<PairingPlan>(persistedPlan);
  const [clientIssues, setClientIssues] = useState<string | null>(null);

  const [state, formAction, pending] = useActionState<
    WizardActionState,
    FormData
  >(saveGroupsStep, {});

  // Persisted groups unlock the Extras & publish step (publishing mints a
  // token per group) — the rail needs fresh server props after a save.
  useEffect(() => {
    if (state.saved && state.savedAt) onSaved(state.savedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.saved, state.savedAt]);

  const draftShape = {
    teamSize,
    holesCount: draft?.holesCount ?? 18,
    nineOption: draft?.nineOption ?? "front",
    startType: draft?.startType ?? "tee_times",
  } as const;

  // Seed a plan on first visit when nothing persisted yet: groups are
  // generated once so the editor starts from a real pairing, not a blank
  // pool.
  const needsSeed =
    groups.length === 0 && attached.length > 0 && !readOnly;
  const [seeded, setSeeded] = useState(!needsSeed);
  useEffect(() => {
    if (seeded) return;
    setSeeded(true);
    setPlan(
      generatePairingPlan({
        players,
        teamSize,
        strategy,
        holesCount: draftShape.holesCount,
        nineOption: draftShape.nineOption,
        startType: draftShape.startType,
        seed,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeded]);

  function regenerate(nextStrategy: PairingStrategy = strategy) {
    if (readOnly) return;
    setStrategy(nextStrategy);
    setClientIssues(null);
    if (nextStrategy === "manual") {
      setPlan((current) => ({
        groups: [],
        unassigned: [
          ...current.groups.flatMap((group) => group.playerIds),
          ...current.unassigned,
        ],
      }));
      return;
    }
    setSeed((current) => current + 1);
    setPlan(
      generatePairingPlan({
        players,
        teamSize,
        strategy: nextStrategy,
        holesCount: draftShape.holesCount,
        nineOption: draftShape.nineOption,
        startType: draftShape.startType,
        seed: seed + 1,
      }),
    );
  }

  function drop(target: number | null) {
    return (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      // Stop the parent list from re-handling the same drop.
      event.stopPropagation();
      if (readOnly || pending) return;
      const playerId = event.dataTransfer.getData(DRAG_MIME);
      if (playerId === "") return;
      setClientIssues(null);
      setPlan((current) =>
        normalizePairingPlan(movePairingPlayer(current, playerId, target)),
      );
    };
  }

  function dragOver(event: React.DragEvent<HTMLElement>) {
    if (readOnly || pending) return;
    if (event.dataTransfer.types.includes(DRAG_MIME)) {
      event.preventDefault();
    }
  }

  function setStartingHole(index: number, hole: number | null) {
    setClientIssues(null);
    setPlan((current) => {
      const next = [...current.groups];
      next[index] = { ...next[index]!, startingHole: hole };
      return { groups: next, unassigned: current.unassigned };
    });
  }

  function setCartNumber(index: number, cart: number | null) {
    setClientIssues(null);
    setPlan((current) => {
      const next = [...current.groups];
      next[index] = { ...next[index]!, cartNumber: cart };
      return { groups: next, unassigned: current.unassigned };
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    const issues = validatePairingPlan(plan, {
      teamSize,
      startType: draftShape.startType,
      holesCount: draftShape.holesCount,
      nineOption: draftShape.nineOption,
    });
    if (issues.length > 0) {
      event.preventDefault();
      setClientIssues(issues[0]!.message);
      return;
    }
    if (plan.groups.length === 0) {
      event.preventDefault();
      setClientIssues("Generate or build at least one group before saving.");
      return;
    }
    setClientIssues(null);
  }

  function payload() {
    return {
      eventId,
      teamSize,
      startType: draftShape.startType,
      holesCount: draftShape.holesCount,
      nineOption: draftShape.nineOption,
      groups: plan.groups.map((group) => ({
        name: group.name,
        playerIds: group.playerIds,
        startingHole: group.startingHole,
        cartNumber: group.cartNumber,
      })),
      unassigned: plan.unassigned,
    };
  }

  const groupedCount = plan.groups.reduce(
    (total, group) => total + group.playerIds.length,
    0,
  );
  const issue =
    clientIssues ??
    state.error ??
    null;
  const shotgunShort =
    isShotgun && plan.groups.length > holes.length
      ? `${plan.groups.length} groups won't fit on ${holes.length} holes — split the start or reduce the groups.`
      : null;
  const errorText = issue ?? shotgunShort;

  if (eventId === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Save the basics first</CardTitle>
          <CardDescription>
            The groups step attaches to a saved draft — finish the basics
            above and pairings unlock here.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (attached.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4" aria-hidden />
            Groups &amp; teams
          </CardTitle>
          <CardDescription>
            Add players to the event first — the Players step builds the
            field this step pairs.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="payload" value={JSON.stringify(payload())} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4" aria-hidden />
            Groups &amp; teams
          </CardTitle>
          <CardDescription>
            Pair the field — {groupedCount} of {attached.length} players
            placed in {plan.groups.length} group
            {plan.groups.length === 1 ? "" : "s"} of up to {teamSize}. Drag
            players between groups (or back to the pool) and save when it
            looks right.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid w-full max-w-xs gap-2">
              <Label htmlFor="pairing-strategy">Pairing strategy</Label>
              <select
                id="pairing-strategy"
                value={strategy}
                onChange={(e) =>
                  regenerate(e.target.value as PairingStrategy)
                }
                disabled={readOnly || pending}
                className={STRING_SELECT_CLASS}
              >
                {PAIRING_STRATEGIES.map((option) => (
                  <option key={option} value={option}>
                    {STRATEGY_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => regenerate()}
              disabled={readOnly || pending || strategy === "manual"}
              title="Reshuffle with the same strategy"
            >
              <Dices className="size-3.5" aria-hidden />
              Regenerate
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setClientIssues(null);
                setPlan((current) => ({
                  ...current,
                  groups: [
                    ...current.groups,
                    {
                      name: `Group ${current.groups.length + 1}`,
                      playerIds: [],
                      startingHole:
                        draftShape.startType === "shotgun"
                          ? (holes[
                              current.groups.length %
                                Math.max(1, holes.length)
                            ] ?? null)
                          : null,
                      cartNumber: null,
                    },
                  ],
                }));
              }}
              disabled={readOnly || pending}
            >
              <Plus className="size-3.5" aria-hidden />
              Add empty group
            </Button>
          </div>

          {isShotgun ? (
            <p className="text-xs text-muted-foreground">
              Shotgun start — each group gets one of holes{" "}
              {holes[0]}–{holes[holes.length - 1]} as its starting hole, and
              every hole starts exactly one group.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Tee-times start — groups play in order; starting holes stay
              unset.
            </p>
          )}

          {errorText ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs font-medium text-destructive"
            >
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {errorText}
            </p>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(280px,1fr)_2fr]">
            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Unassigned</CardTitle>
                <CardDescription className="text-xs">
                  {plan.unassigned.length} waiting — drag into a group.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul
                  onDrop={drop(null)}
                  onDragOver={dragOver}
                  className="grid max-h-80 gap-1 overflow-y-auto"
                >
                  {plan.unassigned.map((playerId) => (
                    <li
                      key={playerId}
                      draggable={!readOnly && !pending}
                      onDragStart={(event) =>
                        event.dataTransfer.setData(DRAG_MIME, playerId)
                      }
                      className="flex cursor-grab items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm active:cursor-grabbing"
                    >
                      <GripVertical
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="truncate font-medium">
                        {playerById.get(playerId)?.fullName ?? playerId}
                      </span>
                      <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                        {playerById.get(playerId)?.handicapIndex ?? "—"}
                      </span>
                    </li>
                  ))}
                  {plan.unassigned.length === 0 ? (
                    <li className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                      Everyone is placed.
                    </li>
                  ) : null}
                </ul>
              </CardContent>
            </Card>

            <div className="grid max-h-[32rem] gap-3 overflow-y-auto pr-1">
              {plan.groups.map((group, index) => (
                <Card
                  key={`${group.name}-${index}`}
                  onDrop={drop(index)}
                  onDragOver={dragOver}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                      {group.name}
                      <span className="font-normal text-muted-foreground">
                        {group.playerIds.length}/{teamSize}
                      </span>
                  </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2">
                    {isShotgun ? (
                      <div className="grid max-w-[10rem] gap-1">
                        <Label
                          htmlFor={`group-${index}-hole`}
                          className="text-xs text-muted-foreground"
                        >
                          Starting hole
                        </Label>
                        <select
                          id={`group-${index}-hole`}
                          value={group.startingHole ?? ""}
                          disabled={readOnly || pending}
                          className={STRING_SELECT_CLASS}
                          onChange={(e) =>
                            setStartingHole(
                              index,
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                            )
                          }
                        >
                          <option value="">—</option>
                          {holes.map((hole) => (
                            <option key={hole} value={hole}>
                              Hole {hole}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    <div className="grid max-w-[10rem] gap-1">
                      <Label
                        htmlFor={`group-${index}-cart`}
                        className="text-xs text-muted-foreground"
                      >
                        Cart #
                      </Label>
                      <Input
                        id={`group-${index}-cart`}
                        type="number"
                        min={1}
                        max={99}
                        value={group.cartNumber ?? ""}
                        disabled={readOnly || pending}
                        className="h-8"
                        onChange={(e) =>
                          setCartNumber(
                            index,
                            e.target.value === "" ? null : Number(e.target.value),
                          )
                        }
                      />
                    </div>
                    <ul className="grid gap-1">
                      {group.playerIds.map((playerId) => (
                        <li
                          key={playerId}
                          draggable={!readOnly && !pending}
                          onDragStart={(event) =>
                            event.dataTransfer.setData(DRAG_MIME, playerId)
                          }
                          className="flex cursor-grab items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm active:cursor-grabbing"
                        >
                          <GripVertical
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          <span className="truncate font-medium">
                            {playerById.get(playerId)?.fullName ?? playerId}
                          </span>
                          <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                            {playerById.get(playerId)?.handicapIndex ?? "—"}
                          </span>
                          {!readOnly ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              title={`Return ${
                                playerById.get(playerId)?.fullName ?? playerId
                              } to the pool`}
                              onClick={() =>
                                setPlan((current) =>
                                  normalizePairingPlan(
                                    movePairingPlayer(current, playerId, null),
                                  ),
                                )
                              }
                            >
                              <span aria-hidden>↩</span>
                              <span className="sr-only">
                                Return {playerById.get(playerId)?.fullName} to
                                the pool
                              </span>
                            </Button>
                          ) : null}
                        </li>
                      ))}
                      {group.playerIds.length === 0 ? (
                        <li className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                          Empty group — drop players here.
                        </li>
                      ) : null}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={readOnly || pending}>
              <Save className="size-3.5" aria-hidden />
              {pending ? "Saving groups…" : "Save groups"}
            </Button>
            {state.saved && !pending ? (
              <p className="text-xs text-muted-foreground">
                Groups saved — drag more players any time and save again.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
