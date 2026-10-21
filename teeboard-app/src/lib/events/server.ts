import "server-only";
import { cache } from "react";
import { getRequestSupabase } from "@/lib/supabase/server";
import {
  toWizardDraft,
  type EventFormatRow,
  type EventWizardRow,
  type WizardDraftData,
} from "./wizard";
import {
  SPONSOR_BUCKET,
  sideGamesFromRows,
  sponsorsFromRows,
  flightsFromRows,
  payoutStepFromStored,
  type EventFlightRow,
  type EventSponsorRow,
  type SideGameRow,
} from "./extras";

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

// ─── Extras & publish step loads (M4-T007) ──────────────────────────────────

/**
 * The extras state the wizard renders: flights, side games, sponsors, the
 * welcome message, and visibility, all read through the request-bound
 * client so the Phase 1 policies scope them to the signed-in club.
 */
export type EventExtras = {
  readonly flights: readonly {
    readonly name: string;
    readonly maxHandicap: number | null;
  }[];
  readonly sideGames: readonly {
    readonly kind: "skins" | "closest_to_pin" | "long_drive" | "longest_putt";
    readonly holeValue: number | null;
    readonly holeValueText: string;
  }[];
  readonly sponsors: readonly {
    readonly id: string;
    readonly name: string;
    readonly logoPath: string;
    readonly logoUrl: string | null;
  }[];
  readonly payouts: {
    readonly presetId: string;
    readonly purse: number;
  };
  readonly welcomeMessage: string;
  readonly isPublic: boolean;
};

/**
 * The public CDN URL of a stored sponsor logo (the bucket is public-read).
 * Null only when Supabase is not configured — the renderer shows a
 * placeholder rather than a broken image.
 */
export function sponsorLogoUrl(logoPath: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${SPONSOR_BUCKET}/${logoPath}`;
}

type EventExtrasRow = {
  welcome_message: string | null;
  is_public: boolean;
  payout_preset_id: string | null;
  payout_purse: number | string | null;
};

/**
 * Loads one draft event's extras state (M4-T007): flights, the four side
 * games the step manages, sponsor rows with their public URLs, and the
 * welcome message + visibility columns. Draft events only — a published
 * event belongs to its admin page.
 */
export const getEventExtras = cache(
  async (
    clubId: string,
    eventId: string,
  ): Promise<EventExtras | null> => {
    const client = await getRequestSupabase();

    const { data: event, error: eventError } = await client
      .from("events")
      .select("welcome_message, is_public, status, club_id, payout_preset_id, payout_purse")
      .eq("id", eventId)
      .maybeSingle<
        EventExtrasRow & {
          status: EventDbRow["status"];
          club_id: string;
        }
      >();

    if (eventError) {
      throw new Error(`Failed to load event extras: ${eventError.message}`);
    }
    // RLS scopes the read; the club filter is defense in depth for the
    // service-role path and a correctness guard for the request path.
    if (!event || event.club_id !== clubId) return null;
    if (event.status !== "draft") return null;

    const [flights, sideGames, sponsors] = await Promise.all([
      client
        .from("event_flights")
        .select("id, name, max_handicap, position")
        .eq("event_id", eventId)
        .order("position", { ascending: true })
        .returns<EventFlightRow[]>(),
      client
        .from("side_games")
        .select("id, game_type, name, hole_value")
        .eq("event_id", eventId)
        .returns<SideGameRow[]>(),
      client
        .from("event_sponsors")
        .select("id, name, logo_path, position")
        .eq("event_id", eventId)
        .order("position", { ascending: true })
        .returns<EventSponsorRow[]>(),
    ]);

    return Object.freeze({
      flights: flightsFromRows(flights.data ?? []),
      sideGames: sideGamesFromRows(sideGames.data ?? []),
      sponsors: sponsorsFromRows(sponsors.data ?? []).map((sponsor, index) => {
        const row = (sponsors.data ?? [])[index];
        return {
          id: row?.id ?? "",
          name: sponsor.name,
          logoPath: sponsor.logoPath,
          logoUrl: sponsorLogoUrl(sponsor.logoPath),
        };
      }),
      payouts: payoutStepFromStored(
        event.payout_preset_id,
        event.payout_purse === null ? null : Number(event.payout_purse),
      ),
      welcomeMessage: event.welcome_message ?? "",
      isPublic: event.is_public,
    });
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
