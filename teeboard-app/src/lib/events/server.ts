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

// ─── Event admin page loads (M4-T008) ───────────────────────────────────────

/** The event admin page's view of one event: any status, full shape. */
export type EventAdminEvent = {
  readonly id: string;
  readonly clubId: string;
  readonly name: string;
  readonly startDate: string;
  readonly status: "draft" | "scheduled" | "live" | "completed" | "archived";
  readonly courseId: string;
  readonly courseName: string;
  readonly holesCount: number;
  readonly nineOption: "front" | "back";
  readonly rounds: number;
  readonly startType: "tee_times" | "shotgun";
  readonly shortCode: string | null;
  readonly welcomeMessage: string;
  readonly isPublic: boolean;
  readonly publishedAt: string | null;
};

type EventAdminDbRow = {
  id: string;
  club_id: string;
  name: string;
  start_date: string;
  status: "draft" | "scheduled" | "live" | "completed" | "archived";
  course_id: string;
  holes_count: number;
  nine_option: string;
  rounds: number;
  start_type: string;
  short_code: string | null;
  welcome_message: string | null;
  is_public: boolean;
  published_at: string | null;
};

/**
 * Loads one event for its admin page (M4-T008) — any status (the wizard
 * loads drafts only; this is the post-publish management surface). The read
 * goes through the request-bound client so the Phase 1 events policies scope
 * it to the signed-in club, and the `courses` join carries the course name
 * for the header. The club filter is defense in depth for the request path.
 */
export const getEventAdminEvent = cache(
  async (
    clubId: string,
    eventId: string,
  ): Promise<EventAdminEvent | null> => {
    const client = await getRequestSupabase();
    const { data, error } = await client
      .from("events")
      .select(
        "id, club_id, name, start_date, status, course_id, holes_count, nine_option, rounds, start_type, short_code, welcome_message, is_public, published_at, courses!inner(name)",
      )
      .eq("id", eventId)
      .eq("club_id", clubId)
      .maybeSingle<
        EventAdminDbRow & {
          courses: { name: string } | { name: string }[] | null;
        }
      >();

    if (error) {
      throw new Error(`Failed to load event: ${error.message}`);
    }
    if (!data) return null;

    const course = Array.isArray(data.courses) ? data.courses[0] : data.courses;

    return Object.freeze({
      id: data.id,
      clubId: data.club_id,
      name: data.name,
      startDate: data.start_date,
      status: data.status,
      courseId: data.course_id,
      courseName: course?.name ?? "",
      holesCount: data.holes_count,
      nineOption: data.nine_option === "back" ? "back" : "front",
      rounds: data.rounds,
      startType: data.start_type === "shotgun" ? "shotgun" : "tee_times",
      shortCode: data.short_code,
      welcomeMessage: data.welcome_message ?? "",
      isPublic: data.is_public,
      publishedAt: data.published_at,
    });
  },
);

/**
 * The event's primary format row as the Settings tab edits it (M4-T008):
 * the same shape the wizard's Format step persists, read through the
 * request-bound client so RLS applies.
 */
export type EventAdminFormat = {
  readonly format: string;
  readonly teamSize: number;
  readonly scoringBasis: "gross" | "net" | "both";
  readonly handicapAllowancePct: number | null;
  readonly maxScoreRule: "none" | "fixed" | "double_par" | "net_double_bogey";
  readonly maxScoreFixedCap: number | null;
  readonly tiebreakMethod: "card_off" | "none";
};

export const getEventAdminFormat = cache(
  async (eventId: string): Promise<EventAdminFormat | null> => {
    const client = await getRequestSupabase();
    const { data, error } = await client
      .from("event_formats")
      .select(
        "format, team_size, scoring_basis, handicap_allowance_pct, max_score_rule, max_score_fixed_cap, tiebreak_method",
      )
      .eq("event_id", eventId)
      .eq("is_primary", true)
      .maybeSingle<{
        format: string;
        team_size: number;
        scoring_basis: string;
        handicap_allowance_pct: number | string | null;
        max_score_rule: string;
        max_score_fixed_cap: number | null;
        tiebreak_method: string;
      }>();

    if (error) {
      throw new Error(`Failed to load event format: ${error.message}`);
    }
    if (!data) return null;

    return Object.freeze({
      format: data.format,
      teamSize: data.team_size,
      scoringBasis: (["gross", "net", "both"] as const).includes(
        data.scoring_basis as "gross",
      )
        ? (data.scoring_basis as EventAdminFormat["scoringBasis"])
        : "both",
      handicapAllowancePct:
        data.handicap_allowance_pct === null
          ? null
          : Number(data.handicap_allowance_pct),
      maxScoreRule: (
        ["none", "fixed", "double_par", "net_double_bogey"] as const
      ).includes(data.max_score_rule as "none")
        ? (data.max_score_rule as EventAdminFormat["maxScoreRule"])
        : "none",
      maxScoreFixedCap: data.max_score_fixed_cap,
      tiebreakMethod: (["card_off", "none"] as const).includes(
        data.tiebreak_method as "card_off",
      )
        ? (data.tiebreak_method as EventAdminFormat["tiebreakMethod"])
        : "card_off",
    });
  },
);

/**
 * The Overview tab's counters (M4-T008): players attached, groups persisted,
 * and scores recorded — each read through the request-bound client so RLS
 * applies.
 */
export type EventAdminCounters = {
  readonly players: number;
  readonly groups: number;
  readonly scores: number;
};

export const getEventAdminCounters = cache(
  async (
    clubId: string,
    eventId: string,
  ): Promise<EventAdminCounters> => {
    const client = await getRequestSupabase();

    const [players, groups, scores] = await Promise.all([
      client
        .from("event_players")
        .select("id, events!inner(club_id)", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("events.club_id", clubId),
      client
        .from("groups")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId),
      client
        .from("scores")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId),
    ]);

    if (players.error) {
      throw new Error(`Failed to count players: ${players.error.message}`);
    }
    if (groups.error) {
      throw new Error(`Failed to count groups: ${groups.error.message}`);
    }
    if (scores.error) {
      throw new Error(`Failed to count scores: ${scores.error.message}`);
    }

    return Object.freeze({
      players: players.count ?? 0,
      groups: groups.count ?? 0,
      scores: scores.count ?? 0,
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
