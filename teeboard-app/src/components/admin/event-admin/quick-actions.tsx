"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, CircleAlert, CopyPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  archiveEvent,
  deleteEvent,
  duplicateEvent,
  type AdminActionState,
} from "@/lib/events/admin-actions";

/**
 * Event admin quick actions (M4-T008): Duplicate (a full copy into a new
 * draft), Archive (published events), and Delete — restricted to draft
 * events and enforced server-side (the delete filters status = draft, so a
 * tampered client deletes nothing on a published event). Duplicate and a
 * successful Delete land back on the events list, where the new draft /
 * the shrunken list render.
 */

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

export function QuickActions({
  eventId,
  status,
  readOnly = false,
}: {
  eventId: string;
  status: "draft" | "scheduled" | "live" | "completed" | "archived";
  readOnly?: boolean;
}) {
  const router = useRouter();
  const isDraft = status === "draft";
  const archivable = status === "scheduled" || status === "live";

  const [dupError, setDupError] = useState<string | null>(null);
  const [dupPending, startDupTransition] = useTransition();

  const [archiveState, archiveAction, archivePending] = useActionState<
    AdminActionState,
    FormData
  >(archiveEvent, {});

  const [deleteState, deleteAction, deletePending] = useActionState<
    AdminActionState,
    FormData
  >(deleteEvent, {});

  // The duplicate jumps to the events list on success (the new draft
  // continues in the wizard); its error surfaces inline.
  function duplicate(formData: FormData) {
    startDupTransition(async () => {
      const result = await duplicateEvent({}, formData);
      if (result.saved) {
        router.push("/admin/events");
      } else {
        setDupError(result.error ?? GENERIC_ERROR);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <form action={duplicate} className="inline">
          <input type="hidden" name="eventId" value={eventId} />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={readOnly || dupPending}
          >
            <CopyPlus className="size-3.5" aria-hidden />
            {dupPending ? "Duplicating…" : "Duplicate event"}
          </Button>
        </form>

        {archivable ? (
          <form action={archiveAction} className="inline">
            <input type="hidden" name="eventId" value={eventId} />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={readOnly || archivePending}
            >
              <Archive className="size-3.5" aria-hidden />
              {archivePending ? "Archiving…" : "Archive"}
            </Button>
          </form>
        ) : null}

        {isDraft ? (
          <form action={deleteAction} className="inline">
            <input type="hidden" name="eventId" value={eventId} />
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={readOnly || deletePending}
            >
              <Trash2 className="size-3.5" aria-hidden />
              {deletePending ? "Deleting…" : "Delete draft"}
            </Button>
          </form>
        ) : null}
      </div>

      {dupError ? <ActionError message={dupError} /> : null}
      {archiveState.error ? <ActionError message={archiveState.error} /> : null}
      {archiveState.saved && archiveState.message ? (
        <p className="text-sm font-medium text-primary">{archiveState.message}</p>
      ) : null}
      {deleteState.error ? <ActionError message={deleteState.error} /> : null}
      {deleteState.saved && deleteState.message ? (
        <p className="text-sm font-medium text-primary">{deleteState.message}</p>
      ) : null}

      {!isDraft ? (
        <p className="text-xs text-muted-foreground">
          Delete is restricted to drafts server-side — a published event is
          archived instead, so its history and scores are never silently
          destroyed.
        </p>
      ) : null}
    </div>
  );
}

function ActionError({ message }: { message: string }) {
  return (
    <p role="alert" className="text-sm font-medium text-destructive">
      <CircleAlert className="mr-1 inline size-4" aria-hidden />
      {message}
    </p>
  );
}
