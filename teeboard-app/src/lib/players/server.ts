import "server-only";
import { getRequestSupabase } from "@/lib/supabase/server";
import {
  PLAYER_GENDERS,
  type DuplicateGroup,
  type PlayerListParams,
  type PlayerRow,
  type PlayerSortField,
} from "./schema";
import { groupDuplicates } from "./duplicates";

/**
 * RLS-respecting player data access (M4-T002). Reads go through the
 * request-bound client so PostgREST applies the signed-in staff member's
 * club policies — another club's players are simply invisible. Event
 * aggregates (entry count, last start date) are loaded with a flat second
 * query per club — also through the request client, so the same RLS
 * applies — and joined in memory.
 */

export type EventEntryRecord = {
  readonly playerId: string;
  readonly startDate: string | null;
};

type PlayerDbRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  gender: "mens" | "womens" | null;
  handicap_index: number | string | null;
  whs_number: string | null;
};

function toHandicap(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  return typeof raw === "string" ? Number(raw) : raw;
}

function normalizeGender(raw: string | null): "mens" | "womens" | null {
  return raw !== null && (PLAYER_GENDERS as readonly string[]).includes(raw)
    ? (raw as "mens" | "womens")
    : null;
}

const POSTGRES_SORT_COLUMNS: Record<PlayerSortField, string> = {
  full_name: "full_name",
  email: "email",
  handicap_index: "handicap_index",
  event_count: "full_name",
  last_event_date: "full_name",
};

const DB_SORTABLE = ["full_name", "email", "handicap_index"] as const;

function latestDate(dates: readonly string[]): string | null {
  return dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null;
}

function aggregateEntries(
  entries: readonly EventEntryRecord[],
  playerId: string,
): Pick<PlayerRow, "eventCount" | "lastEventDate"> {
  const mine = entries.filter((entry) => entry.playerId === playerId);
  return Object.freeze({
    eventCount: mine.length,
    lastEventDate: latestDate(
      mine
        .map((entry) => entry.startDate)
        .filter((date): date is string => date !== null),
    ),
  });
}

function toPlayer(
  row: PlayerDbRow,
  entries: readonly EventEntryRecord[],
): PlayerRow {
  return Object.freeze({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    gender: normalizeGender(row.gender),
    handicapIndex: toHandicap(row.handicap_index),
    whsNumber: row.whs_number,
    ...aggregateEntries(entries, row.id),
  });
}

/** Loads the club's event entries (player → event start dates) for aggregation. */
async function loadEventEntries(
  client: Awaited<ReturnType<typeof getRequestSupabase>>,
  clubId: string,
): Promise<EventEntryRecord[]> {
  const { data, error } = await client
    .from("event_players")
    .select("player_id, events!inner(start_date, club_id)")
    .eq("events.club_id", clubId);

  if (error) {
    throw new Error(`Failed to load player event entries: ${error.message}`);
  }

  type EntryRow = {
    player_id: string;
    events: { start_date?: string | null } | { start_date?: string | null }[] | null;
  };

  return (data ?? []).map((row: EntryRow) => {
    const event = Array.isArray(row.events) ? row.events[0] : row.events;
    return Object.freeze({
      playerId: row.player_id,
      startDate: event?.start_date ?? null,
    });
  });
}

/**
 * Lists the signed-in club's players with server-side filtering. The
 * search term matches name/email/phone/WHS via PostgREST `or` ilike;
 * name/email/HI sort in the database, aggregate sorts (event count /
 * last event) sort in TypeScript after the aggregate loads.
 */
export async function listPlayers(
  clubId: string,
  params: PlayerListParams,
): Promise<PlayerRow[]> {
  const client = await getRequestSupabase();

  let query = client
    .from("players")
    .select("id, full_name, email, phone, gender, handicap_index, whs_number")
    .eq("club_id", clubId);

  const term = params.search.trim();
  if (term !== "") {
    const pattern = `%${term.replace(/[%,()\\]/g, "")}%`;
    query = query.or(
      `full_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern},whs_number.ilike.${pattern}`,
    );
  }

  if ((DB_SORTABLE as readonly string[]).includes(params.sort)) {
    query = query.order(POSTGRES_SORT_COLUMNS[params.sort], {
      ascending: params.direction === "asc",
      nullsFirst: false,
    });
  }

  const [{ data, error }, entries] = await Promise.all([
    query,
    loadEventEntries(client, clubId),
  ]);

  if (error) {
    throw new Error(`Failed to list players: ${error.message}`);
  }

  let players = (data ?? []).map((row: PlayerDbRow) => toPlayer(row, entries));
  if (!(DB_SORTABLE as readonly string[]).includes(params.sort)) {
    players = sortAggregates(players, params.sort, params.direction);
  }
  return players;
}

function sortAggregates(
  players: PlayerRow[],
  sort: PlayerSortField,
  direction: "asc" | "desc",
): PlayerRow[] {
  const flip = direction === "desc" ? -1 : 1;
  return [...players].sort((a, b) => {
    let cmp = 0;
    if (sort === "event_count") {
      cmp = a.eventCount - b.eventCount;
    } else {
      const aDate = a.lastEventDate ?? "";
      const bDate = b.lastEventDate ?? "";
      cmp = aDate === bDate ? 0 : aDate > bDate ? 1 : -1;
    }
    if (cmp !== 0) return cmp * flip;
    return (a.fullName > b.fullName ? 1 : -1) * flip;
  });
}

/** Loads the club's players with aggregates, for the duplicates scan. */
async function loadPlayersWithAggregates(clubId: string): Promise<PlayerRow[]> {
  const client = await getRequestSupabase();
  const [rows, entries] = await Promise.all([
    client
      .from("players")
      .select("id, full_name, email, phone, gender, handicap_index, whs_number")
      .eq("club_id", clubId),
    loadEventEntries(client, clubId),
  ]);

  if (rows.error) {
    throw new Error(`Failed to scan players: ${rows.error.message}`);
  }
  return (rows.data ?? []).map((row: PlayerDbRow) => toPlayer(row, entries));
}

/**
 * Detects duplicate players within the club (identical name AND email),
 * grouped for the one-click merge UI.
 */
export async function findDuplicateGroups(
  clubId: string,
): Promise<readonly DuplicateGroup[]> {
  const players = await loadPlayersWithAggregates(clubId);
  return groupDuplicates(players);
}
