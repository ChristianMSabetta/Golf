import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth/authorization";
import { getStaffClub } from "@/lib/club/server";
import { listCourses } from "@/lib/course/server";
import { getWizardDraft } from "@/lib/events/server";
import {
  listEventRoster,
  listRosterPlayers,
  type RosterAttachmentRow,
  type RosterPlayerRow,
} from "@/lib/players/server";
import { EventWizard } from "@/components/admin/event-wizard/event-wizard";
import {
  WIZARD_STEP_IDS,
  type WizardStepId,
} from "@/lib/events/schema";

export const metadata: Metadata = {
  title: "New event",
};

// Session-dependent: never prerendered at build time.
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function stepFromParams(raw: string | undefined): WizardStepId {
  return (WIZARD_STEP_IDS as readonly string[]).includes(raw ?? "")
    ? (raw as WizardStepId)
    : "basics";
}

/**
 * The event creation wizard (M4-T003). `?event=<id>` reloads a draft with
 * everything previously autosaved; `?step=` deep-links a step (gated
 * client-side by per-step Zod validation). Reads run through the
 * request-bound client so RLS applies — another club's drafts are
 * invisible.
 */
export default async function NewEventPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireStaff();
  const context = await getStaffClub();

  if (!context) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          New event
        </h1>
        <p className="text-sm text-muted-foreground">
          No club is linked to your account yet — ask your club owner to
          invite you.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const eventId = first(params.event);
  const initialStep = stepFromParams(first(params.step));

  const [draft, courses, clubPlayers, attachedPlayers]: [
    Awaited<ReturnType<typeof getWizardDraft>>,
    Awaited<ReturnType<typeof listCourses>>,
    readonly RosterPlayerRow[],
    readonly RosterAttachmentRow[],
  ] = await Promise.all([
    eventId ? getWizardDraft(eventId) : Promise.resolve(null),
    listCourses(context.club.id),
    listRosterPlayers(context.club.id),
    eventId ? listEventRoster(context.club.id, eventId) : Promise.resolve([]),
  ]);

  const canEdit =
    context.staff.isSuperadmin ||
    ["owner", "head_pro", "event_manager"].includes(context.staff.role);

  return (
    <EventWizard
      draft={draft}
      courses={courses}
      clubPlayers={clubPlayers}
      attachedPlayers={attachedPlayers}
      initialStep={initialStep}
      canEdit={canEdit}
    />
  );
}
