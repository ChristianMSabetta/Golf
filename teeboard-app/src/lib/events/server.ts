import "server-only";
import { cache } from "react";
import { getRequestSupabase } from "@/lib/supabase/server";
import {
  toWizardDraft,
  type EventFormatRow,
  type EventWizardRow,
  type WizardDraftData,
} from "./wizard";

/**
 * RLS-respecting event data access (M4-T003). Reads go through the
 * request-bound client so PostgREST applies the signed-in staff member's
 * club policies — another club's draft events are simply invisible.
 */

export type EventSummary = {
  readonly id: string;
  readonly name: string;
  readonly startDate: string;
  readonly status: "draft" | "scheduled" | "live" | "completed" | "archived";
};

type EventDbRow = {
  id: string;
  name: string;
  start_date: string;
  status: "draft" | "scheduled" | "live" | "completed" | "archived";
};

function toSummary(row: EventDbRow): EventSummary {
  return Object.freeze({
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    status: row.status,
  });
}

/** Lists the club's events, newest first. */
export async function listEvents(clubId: string): Promise<EventSummary[]> {
  const client = await getRequestSupabase();
  const { data, error } = await client
    .from("events")
    .select("id, name, start_date, status")
    .eq("club_id", clubId)
    .order("start_date", { ascending: false });

  if (error) {
    throw new Error(`Failed to list events: ${error.message}`);
  }
  return (data ?? []).map(toSummary);
}

const WIZARD_EVENT_COLUMNS = [
  "id",
  "name",
  "start_date",
  "course_id",
  "holes_count",
  "nine_option",
  "rounds",
  "start_type",
] as const;

/**
 * Loads one draft event with its primary format row and maps it onto the
 * wizard draft shape. RLS scopes both reads to the signed-in club; a
 * missing row, a missing course, or a published-and-beyond event all
 * surface as null so the wizard page falls back to a fresh draft.
 */
export const getWizardDraft = cache(
  async (eventId: string): Promise<WizardDraftData | null> => {
    const client = await getRequestSupabase();

    const { data: event, error } = await client
      .from("events")
      .select(WIZARD_EVENT_COLUMNS.join(", "))
      .eq("id", eventId)
      .maybeSingle<
        EventWizardRow & { status: EventDbRow["status"] }
      >();

    if (error) {
      throw new Error(`Failed to load event draft: ${error.message}`);
    }
    if (!event) return null;
    if (event.status !== "draft") return null;

    const { data: formats, error: formatsError } = await client
      .from("event_formats")
      .select(
        "format, is_primary, team_size, scoring_basis, handicap_allowance_pct, max_score_rule, max_score_fixed_cap, tiebreak_method",
      )
      .eq("event_id", eventId);

    if (formatsError) {
      throw new Error(
        `Failed to load event formats: ${formatsError.message}`,
      );
    }

    const primary =
      (formats ?? []).find((row: EventFormatRow) => row.is_primary) ??
      null;

    return toWizardDraft(event, primary);
  },
);
