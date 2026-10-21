import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/authorization";
import { getStaffClub } from "@/lib/club/server";
import {
  getEventAdminCounters,
  getEventAdminEvent,
  getEventAdminFormat,
  getEventGroups,
  listGroupedPlayers,
} from "@/lib/events/server";
import { listEventRoster } from "@/lib/players/server";
import {
  EVENT_HOLES_COUNTS,
  EVENT_NINE_OPTIONS,
  EVENT_ROUNDS,
  EVENT_START_TYPES,
} from "@/lib/events/schema";
import { tabFromParams, STATUS_LABELS, type EventStatus } from "@/lib/events/admin";
import { EventAdminTabs } from "@/components/admin/event-admin/event-admin-tabs";
import { OverviewTab } from "@/components/admin/event-admin/overview-tab";
import { PlayersTab } from "@/components/admin/event-admin/players-tab";
import { GroupsTab } from "@/components/admin/event-admin/groups-tab";
import { SettingsTab } from "@/components/admin/event-admin/settings-tab";
import { QuickActions } from "@/components/admin/event-admin/quick-actions";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Event",
};

// Session-dependent: never prerendered at build time.
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The event admin page (M4-T008) - where staff land after the wizard: the
 * tabbed Overview / Players / Groups / Settings surface over the live event.
 * Reads run through the request-bound client so the Phase 1 events policies
 * scope every query to the signed-in club; the mutations (settings save,
 * duplicate, archive, delete) are role-gated server actions with the club
 * filter on every write.
 */
export default async function EventAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  await requireStaff();
  const context = await getStaffClub();

  if (!context) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Event
        </h1>
        <p className="text-sm text-muted-foreground">
          No club is linked to your account yet - ask your club owner to
          invite you.
        </p>
      </div>
    );
  }

  // App Router params arrive URL-decoded — no second decode pass.
  const { id: eventId } = await params;
  const tab = tabFromParams(first((await searchParams).tab));

  const clubId = context.club.id;
  const canEdit =
    context.staff.isSuperadmin ||
    ["owner", "head_pro", "event_manager"].includes(context.staff.role);

  const event = await getEventAdminEvent(clubId, eventId);
  if (!event) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Event not found
        </h1>
        <p className="text-sm text-muted-foreground">
          This event doesn&apos;t exist in {context.club.name} - it may have
          been deleted, or it belongs to another club.
        </p>
        <div>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/events">Back to events</Link>
          </Button>
        </div>
      </div>
    );
  }

  const [format, counters, roster, grouped] = await Promise.all([
    getEventAdminFormat(eventId),
    getEventAdminCounters(clubId, eventId),
    listEventRoster(clubId, eventId),
    listGroupedPlayers(clubId, eventId),
  ]);
  const groups = await getEventGroups(eventId);

  const groupNameById = new Map(
    groups.map((group: { id: string; name: string }) => [group.id, group.name]),
  );
  const rosterRows = roster
    .map((row: (typeof roster)[number]) => {
      const member = grouped.find(
        (entry: { playerId: string; groupId: string | null }) =>
          entry.playerId === row.playerId,
      );
      return {
        playerId: row.playerId,
        fullName: row.fullName,
        email: row.email,
        handicapIndex: row.handicapIndex,
        groupName:
          member?.groupId !== null && member?.groupId !== undefined
            ? (groupNameById.get(member.groupId) ?? null)
            : null,
      };
    })
    .sort((a: { fullName: string }, b: { fullName: string }) =>
      a.fullName.localeCompare(b.fullName),
    );

  const isDraft = event.status === "draft";

  const safeHolesCount = (EVENT_HOLES_COUNTS as readonly number[]).includes(
    event.holesCount,
  )
    ? event.holesCount
    : 18;
  const safeNineOption = (EVENT_NINE_OPTIONS as readonly string[]).includes(
    event.nineOption,
  )
    ? event.nineOption
    : "front";
  const safeRounds = (EVENT_ROUNDS as readonly number[]).includes(
    event.rounds,
  )
    ? event.rounds
    : 1;
  const safeStartType = (EVENT_START_TYPES as readonly string[]).includes(
    event.startType,
  )
    ? event.startType
    : "tee_times";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {STATUS_LABELS[event.status as EventStatus]} event
          </p>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            {event.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {event.courseName} - the day&apos;s field, groups, and settings.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isDraft ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/events/new?event=${event.id}&step=basics`}>
                Continue in wizard
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/events">All events</Link>
          </Button>
        </div>
      </div>

      <QuickActions eventId={event.id} status={event.status} readOnly={!canEdit} />

      <EventAdminTabs
        eventId={event.id}
        initialTab={tab}
        overview={
          <OverviewTab
            event={{
              name: event.name,
              startDate: event.startDate,
              status: event.status,
              courseName: event.courseName,
              holesCount: safeHolesCount,
              nineOption: safeNineOption,
              rounds: safeRounds,
              startType: safeStartType,
              shortCode: event.shortCode,
              publishedAt: event.publishedAt,
            }}
            counters={counters}
          />
        }
        players={
          <PlayersTab
            eventId={event.id}
            isDraft={isDraft}
            roster={rosterRows}
          />
        }
        groups={
          <GroupsTab
            groups={groups.map((group) => ({
              id: group.id,
              name: group.name,
              startingHole: group.startingHole,
              cartNumber: group.cartNumber,
            }))}
            members={grouped.map((member) => ({
              playerId: member.playerId,
              fullName: member.fullName,
              handicapIndex: member.handicapIndex,
              groupId: member.groupId,
            }))}
          />
        }
        settings={
          <SettingsTab
            event={{
              id: event.id,
              name: event.name,
              startDate: event.startDate,
              status: event.status,
              holesCount: safeHolesCount,
              nineOption: safeNineOption,
              rounds: safeRounds,
              startType: safeStartType,
              welcomeMessage: event.welcomeMessage,
              isPublic: event.isPublic,
            }}
            format={format}
            readOnly={!canEdit}
          />
        }
      />
    </div>
  );
}
