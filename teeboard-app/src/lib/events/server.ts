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

// ─── Groups & teams step loads (M4-T006) ─────────────────────────────────────

export type GroupRow = {
  readonly id: string;
  readonly name: string;
  readonly startingHole: number | null;
  readonly cartNumber: number | null;
};

export type GroupedAttachmentRow = {
  readonly playerId: string;
  readonly fullName: string;
  readonly handicapIndex: number | null;
  readonly groupId: string | null;
};

type GroupsDbRow = {
  id: string;
  name: string;
  starting_hole: number | null;
  cart_number: number | null;
};

/**
 * Loads the event's persisted groups (M4-T006) — the wizard's Groups step
 * reads them through the request-bound client so the Phase 1 groups
 * policies scope them to the signed-in club; another club's groups stay
 * invisible.
 */
export const getEventGroups = cache(
  async (eventId: string): Promise<readonly GroupRow[]> => {
    const client = await getRequestSupabase();
    const { data, error } = await client
      .from("groups")
      .select("id, name, starting_hole, cart_number")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`Failed to load event groups: ${error.message}`);
    }
    return (data ?? []).map((row: GroupsDbRow) =>
      Object.freeze({
        id: row.id,
        name: row.name,
        startingHole: row.starting_hole,
        cartNumber: row.cart_number,
      }),
    );
  },
);

type GroupedPlayerDbRow = {
  player_id: string;
  group_id: string | null;
  players:
    | { full_name: string; handicap_index: number | string | null }
    | { full_name: string; handicap_index: number | string | null }[]
    | null;
};

function toHandicap(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  return typeof raw === "string" ? Number(raw) : raw;
}

/**
 * Loads the event roster joined to its group membership (M4-T006): every
 * attached player with their current group_id, read through the
 * request-bound client so the events/groups policies scope the join to
 * the signed-in club.
 */
export const listGroupedPlayers = cache(
  async (
    clubId: string,
    eventId: string,
  ): Promise<readonly GroupedAttachmentRow[]> => {
    const client = await getRequestSupabase();
    const { data, error } = await client
      .from("event_players")
      .select(
        "player_id, group_id, players!inner(full_name, handicap_index), events!inner(club_id)",
      )
      .eq("event_id", eventId)
      .eq("events.club_id", clubId);

    if (error) {
      throw new Error(`Failed to load grouped players: ${error.message}`);
    }

    return (data ?? []).map((row: GroupedPlayerDbRow) => {
      const player = Array.isArray(row.players) ? row.players[0] : row.players;
      return Object.freeze({
        playerId: row.player_id,
        fullName: player?.full_name ?? "",
        handicapIndex: toHandicap(player?.handicap_index ?? null),
        groupId: row.group_id,
      });
    });
  },
);
