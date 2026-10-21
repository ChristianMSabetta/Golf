"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { EVENT_ADMIN_TABS, type EventAdminTabId } from "@/lib/events/admin";

/**
 * The event admin page's tab rail (M4-T008): Overview, Players, Groups,
 * Settings — server-rendered panels swapped client-side with `?tab=` deep
 * links kept in sync so a shared URL lands on the same tab. The panels
 * arrive as React nodes (server components), so the tab switch itself is a
 * cheap client toggle — no data refetch, no layout shift.
 */
export function EventAdminTabs({
  eventId,
  initialTab,
  overview,
  players,
  groups,
  settings,
}: {
  eventId: string;
  initialTab: EventAdminTabId;
  overview: React.ReactNode;
  players: React.ReactNode;
  groups: React.ReactNode;
  settings: React.ReactNode;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<EventAdminTabId>(initialTab);

  function select(next: EventAdminTabId) {
    if (next === tab) return;
    setTab(next);
    router.replace(`/admin/events/${eventId}?tab=${next}`, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Event sections" className="flex flex-row flex-wrap items-center gap-1 border-b">
        {EVENT_ADMIN_TABS.map((entry) => {
          const active = entry.id === tab;
          return (
            <button
              key={entry.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => select(entry.id)}
              className={cn(
                "-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {entry.label}
            </button>
          );
        })}
      </nav>

      <div role="tabpanel">
        {tab === "overview" ? overview : null}
        {tab === "players" ? players : null}
        {tab === "groups" ? groups : null}
        {tab === "settings" ? settings : null}
      </div>
    </div>
  );
}
