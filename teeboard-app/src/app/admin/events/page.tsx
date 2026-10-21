import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/authorization";
import { getStaffClub } from "@/lib/club/server";
import { listEvents } from "@/lib/events/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Events",
};

// Session-dependent: never prerendered at build time.
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  live: "Live",
  completed: "Completed",
  archived: "Archived",
};

function formatEventDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${month}/${day}/${year}`;
}

/**
 * Event management list (M4-T003). Server-rendered through the
 * request-bound client so RLS applies — only the signed-in club's events
 * are ever visible. Drafts continue in the wizard.
 */
export default async function EventsPage() {
  const staff = await requireStaff();
  const context = await getStaffClub();

  if (!context) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Events
        </h1>
        <p className="text-sm text-muted-foreground">
          {staff.isSuperadmin
            ? "Super admin tools arrive in a later phase."
            : "No club is linked to your account yet — ask your club owner to invite you."}
        </p>
      </div>
    );
  }

  const events = await listEvents(context.club.id);
  const drafts = events.filter((event) => event.status === "draft");
  const rest = events.filter((event) => event.status !== "draft");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Events
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {context.club.name}&apos;s tournaments and leagues. Drafts
            continue in the wizard; published events open their admin page.
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/admin/events/new">New event</Link>
        </Button>
      </div>

      {events.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No events yet</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Start the wizard — a name, date, and course create a draft you
            can refine and autosave as you go.
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {drafts.map((event) => (
            <li key={event.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-0">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/events/new?event=${event.id}&step=basics`}
                      className="font-heading text-base font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {event.name}
                    </Link>
                    <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
                      {formatEventDate(event.startDate)} ·{" "}
                      {STATUS_LABELS[event.status] ?? event.status}
                    </p>
                  </div>
                  <Button asChild variant="outline">
                    <Link
                      href={`/admin/events/new?event=${event.id}&step=basics`}
                    >
                      Continue draft
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
          {rest.map((event) => (
            <li key={event.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-0">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/events/${event.id}`}
                      className="font-heading text-base font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {event.name}
                    </Link>
                    <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
                      {formatEventDate(event.startDate)} ·{" "}
                      {STATUS_LABELS[event.status] ?? event.status}
                    </p>
                  </div>
                  <Button asChild variant="outline">
                    <Link href={`/admin/events/${event.id}`}>
                      Manage event
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
