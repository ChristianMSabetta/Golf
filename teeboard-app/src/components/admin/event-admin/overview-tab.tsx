"use client";

import { CalendarDays, Users, UsersRound, ClipboardList } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyLinkButton } from "./copy-link-button";
import {
  STATUS_LABELS,
  formatEventDate,
  type EventStatus,
} from "@/lib/events/admin";

/**
 * Event admin Overview tab (M4-T008): the event's status card, the live
 * counters (players, groups, scores), and the shareable public / TV /
 * scorer+PIN links from publish. Absolute URLs derive from the env-var-backed
 * product domain (`src/lib/brand.ts`), so no host is hardcoded here.
 */
export function OverviewTab({
  event,
  counters,
}: {
  event: {
    readonly name: string;
    readonly startDate: string;
    readonly status: EventStatus;
    readonly courseName: string;
    readonly holesCount: number;
    readonly nineOption: "front" | "back";
    readonly rounds: number;
    readonly startType: "tee_times" | "shotgun";
    readonly shortCode: string | null;
    readonly publishedAt: string | null;
  };
  counters: {
    readonly players: number;
    readonly groups: number;
    readonly scores: number;
  };
}) {
  const published = event.status !== "draft" && event.shortCode !== null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
              <CalendarDays className="size-3.5" aria-hidden />
              Event day
            </CardTitle>
            <CardDescription className="tabular-nums">
              {formatEventDate(event.startDate)} · {STATUS_LABELS[event.status]}
            </CardDescription>
            <CardDescription>
              {event.courseName} · {event.holesCount} holes
              {event.holesCount === 9 ? ` (${event.nineOption} nine)` : ""} ·{" "}
              {event.rounds} round{event.rounds === 1 ? "" : "s"} ·{" "}
              {event.startType === "shotgun" ? "Shotgun" : "Tee times"}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
              <Users className="size-3.5" aria-hidden />
              Players
            </CardTitle>
            <CardDescription className="tabular-nums">
              {counters.players} attached
            </CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
              <UsersRound className="size-3.5" aria-hidden />
              Groups
            </CardTitle>
            <CardDescription className="tabular-nums">
              {counters.groups} group{counters.groups === 1 ? "" : "s"}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="size-4" aria-hidden />
            Scores recorded
          </CardTitle>
          <CardDescription className="tabular-nums">
            {counters.scores} hole score{counters.scores === 1 ? "" : "s"} on
            the board.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shareable links</CardTitle>
          <CardDescription>
            {published
              ? "Minted at publish — absolute URLs from the product domain."
              : "Publish the event to mint the public, TV, and scorer links."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {published ? <ShareableLinks shortCode={event.shortCode!} /> : (
            <p className="text-sm text-muted-foreground">
              Draft events have no public surface yet. Finish the wizard and
              publish — the short code, per-group tokens, and scorer PIN are
              minted in one atomic transition.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** The public / TV / scorer link rows with their copy buttons. */
function ShareableLinks({ shortCode }: { shortCode: string }) {
  const domain =
    typeof window !== "undefined" ? window.location.host : "";
  const rows = [
    {
      label: "Public leaderboard",
      href: `/e/${shortCode}`,
      hint: `Short code ${shortCode} — the player-facing standings.`,
    },
    {
      label: "TV view",
      href: `/e/${shortCode}/tv`,
      hint: "Full-screen standings for the clubhouse TV.",
    },
    {
      label: "Scorer entry",
      href: "/score",
      hint: "Scorers enter the 4-digit event PIN there.",
    },
  ] as const;

  return (
    <ul className="grid gap-2">
      {rows.map((row) => (
        <li
          key={row.label}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-input px-3 py-2"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{row.label}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {domain !== "" ? `https://${domain}` : ""}
              {row.href}
            </p>
            <p className="text-xs text-muted-foreground">{row.hint}</p>
          </div>
          <CopyLinkButton
            text={`${domain !== "" ? `https://${domain}` : ""}${row.href}`}
          />
        </li>
      ))}
      <li className="rounded-lg border border-dashed border-input px-3 py-2 text-xs text-muted-foreground">
        The 4-digit scorer PIN is stored only as a salted hash — it was shown
        once at publish and cannot be displayed here. Copy it from the
        publish confirmation if scorers need it re-shared.
      </li>
    </ul>
  );
}
