"use server";

import { revalidatePath } from "next/cache";
import {
  getRequestSupabase,
  getServerSupabase,
} from "@/lib/supabase/server";
import { getStaff } from "@/lib/auth/authorization";
import {
  handicapEditSchema,
  PLAYER_MERGE_SAVED_MESSAGE,
  PLAYER_SAVED_MESSAGE,
  type PlayersActionState,
} from "./schema";
import { parsePlayersCsv, serializePlayersCsv } from "./csv";

/**
 * Player management server actions (M4-T002). Authorization runs
 * server-side on every action before any validation; every write goes
 * through the service-role client with the club check enforced in the
 * `.eq("club_id", …)` filter (the service role bypasses RLS, so the tenant
 * guard is the filter itself). Staff roles allowed to manage players match
 * the players RLS policy set (`owner`, `head_pro`, `event_manager`).
 */

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const FORBIDDEN_ERROR =
  "Your role doesn't allow managing players. Ask the club owner.";

const PLAYER_ROLES = ["owner", "head_pro", "event_manager"] as const;

type AuthedClub = { readonly clubId: string };

async function authorizePlayerStaff(): Promise<AuthedClub | null> {
  const staff = await getStaff();
  if (!staff) return null;
  if (staff.clubId === null) return null;
  if (
    !staff.isSuperadmin &&
    !PLAYER_ROLES.includes(staff.role as (typeof PLAYER_ROLES)[number])
  ) {
    return null;
  }
  return { clubId: staff.clubId };
}

function unauthorizedState(): PlayersActionState {
  return { error: FORBIDDEN_ERROR };
}

type ClubPlayerRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  gender: "mens" | "womens" | null;
  handicap_index: number | string | null;
  whs_number: string | null;
};

async function loadClubPlayers(clubId: string): Promise<readonly ClubPlayerRow[]> {
  const client = getServerSupabase();
  const { data, error } = await client
    .from("players")
    .select("id, full_name, email, phone, gender, handicap_index, whs_number")
    .eq("club_id", clubId);

  if (error) throw new Error(error.message);
  return (data ?? []) as ClubPlayerRow[];
}

// ─── Inline handicap edit ─────────────────────────────────────────────────────

/** Updates one player's handicap index (inline table edit). */
export async function updateHandicap(
  _prev: PlayersActionState,
  formData: FormData,
): Promise<PlayersActionState> {
  const auth = await authorizePlayerStaff();
  if (!auth) return unauthorizedState();

  const parsed = handicapEditSchema.safeParse({
    playerId: String(formData.get("playerId") ?? ""),
    handicapIndex: String(formData.get("handicapIndex") ?? ""),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const { playerId, handicapIndex } = parsed.data;
  const client = getServerSupabase();

  try {
    const { data: updated, error } = await client
      .from("players")
      .update({ handicap_index: handicapIndex, updated_at: new Date().toISOString() })
      .eq("id", playerId)
      .eq("club_id", auth.clubId)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) throw new Error(error.message);
    if (!updated) throw new Error("player not found for this club");

    revalidatePath("/admin/players");
    return { saved: true, message: PLAYER_SAVED_MESSAGE };
  } catch (error) {
    console.error(
      `[players] handicap update failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}

// ─── CSV import / export ──────────────────────────────────────────────────────

type ImportReport = {
  readonly importedCount: number;
  readonly updatedCount: number;
  readonly rejected: readonly {
    readonly rowNumber: number;
    readonly messages: readonly string[];
  }[];
};

export type ImportActionState = PlayersActionState & {
  readonly report?: ImportReport;
};

/**
 * Upserts CSV rows into the club player database. Rows are keyed by
 * (trimmed name, lowercased email) — matching the duplicate detector — so
 * importing the same file twice updates rather than duplicates. Rows whose
 * key matches multiple existing players are rejected (merge first).
 */
export async function importPlayers(
  _prev: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const auth = await authorizePlayerStaff();
  if (!auth) return unauthorizedState();

  const raw = String(formData.get("csv") ?? "");
  if (raw.trim() === "") {
    return { error: "Paste or upload a CSV file first." };
  }

  const result = parsePlayersCsv(raw);
  if (result.parsed.length === 0) {
    return {
      error: "No valid rows found.",
      report: {
        importedCount: 0,
        updatedCount: 0,
        rejected: result.rejected,
      },
    };
  }

  const client = getServerSupabase();

  try {
    const existing = await loadClubPlayers(auth.clubId);

    const keyOf = (name: string, email: string | null) =>
      `${name.trim().toLowerCase()}|${(email ?? "").trim().toLowerCase()}`;

    const byKey = new Map<string, ClubPlayerRow[]>();
    for (const row of existing) {
      const key = keyOf(row.full_name, row.email);
      const list = byKey.get(key) ?? [];
      list.push(row);
      byKey.set(key, list);
    }

    const rejected: { rowNumber: number; messages: readonly string[] }[] = [];
    let importedCount = 0;
    let updatedCount = 0;

    for (const { rowNumber, row } of result.parsed) {
      const key = keyOf(row.fullName, row.email);
      const matches = byKey.get(key) ?? [];

      if (matches.length > 1) {
        rejected.push({
          rowNumber,
          messages: [
            `This player matches ${matches.length} existing records with the same name and email — merge the duplicates first, then import this row.`,
          ],
        });
        continue;
      }

      const target = matches[0];
      const rowPayload = {
        club_id: auth.clubId,
        full_name: row.fullName,
        email: row.email,
        phone: row.phone,
        gender: row.gender,
        handicap_index: row.handicapIndex,
        whs_number: row.whsNumber,
        updated_at: new Date().toISOString(),
      };

      if (target) {
        // Update only our club's row (defense in depth under the service role).
        const patch: Record<string, unknown> = { updated_at: rowPayload.updated_at };
        if (row.email !== null) patch.email = row.email;
        if (row.phone !== null) patch.phone = row.phone;
        if (row.gender !== null) patch.gender = row.gender;
        if (row.handicapIndex !== null) patch.handicap_index = row.handicapIndex;
        if (row.whsNumber !== null) patch.whs_number = row.whsNumber;

        const { data: updated, error } = await client
          .from("players")
          .update(patch)
          .eq("id", target.id)
          .eq("club_id", auth.clubId)
          .select("id")
          .maybeSingle<{ id: string }>();

        if (error) throw new Error(error.message);
        if (!updated) throw new Error("player row vanished mid-import");
        updatedCount += 1;
      } else {
        const { error } = await client.from("players").insert(rowPayload);
        if (error) throw new Error(error.message);
        importedCount += 1;
      }
    }

    revalidatePath("/admin/players");
    revalidatePath("/admin", "layout");

    return {
      saved: true,
      message: `Imported ${importedCount} new and updated ${updatedCount} existing players.`,
      report: {
        importedCount,
        updatedCount,
        rejected: [...result.rejected.map((r) => ({
          rowNumber: r.rowNumber,
          messages: r.messages,
        })), ...rejected],
      },
    };
  } catch (error) {
    console.error(
      `[players] import failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}

/**
 * Exports the club player list as CSV text. Reads use the request-bound
 * client so RLS applies; the serializer is the pure helper in ./csv.
 */
export async function exportPlayers(): Promise<
  { ok: true; csv: string; filename: string } | { ok: false; error: string }
> {
  const auth = await authorizePlayerStaff();
  if (!auth) return { ok: false, error: FORBIDDEN_ERROR };

  const client = await getRequestSupabase();
  const { data, error } = await client
    .from("players")
    .select("id, full_name, email, phone, gender, handicap_index, whs_number")
    .eq("club_id", auth.clubId)
    .order("full_name", { ascending: true });

  if (error) return { ok: false, error: GENERIC_ERROR };

  type ExportRow = {
    full_name: string;
    email: string | null;
    phone: string | null;
    gender: "mens" | "womens" | null;
    handicap_index: number | string | null;
    whs_number: string | null;
  };

  const csv = serializePlayersCsv(
    (data ?? []).map((row: ExportRow) => ({
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      gender: row.gender,
      handicapIndex:
        row.handicap_index === null || row.handicap_index === undefined
          ? null
          : typeof row.handicap_index === "string"
            ? Number(row.handicap_index)
            : row.handicap_index,
      whsNumber: row.whs_number,
    })),
  );

  const stamp = new Date().toISOString().slice(0, 10);
  return { ok: true, csv, filename: `players-${stamp}.csv` };
}

// ─── Duplicate merge ──────────────────────────────────────────────────────────

/**
 * Merges `mergeId` into `keepId` in one click: every `event_players` row
 * referencing the merge source is re-pointed at the keeper (event history
 * preserved), and only when the keeper has no entry for that event —
 * event_players is unique on (event_id, player_id). Rows that would clash
 * are simply deleted from the source (the keeper's entry already covers
 * the event). Finally the source player row is deleted. Service-role
 * writes carry the club filter; both players are verified club members
 * before anything moves.
 */
export async function mergePlayers(
  _prev: PlayersActionState,
  formData: FormData,
): Promise<PlayersActionState> {
  const auth = await authorizePlayerStaff();
  if (!auth) return unauthorizedState();

  const keepId = String(formData.get("keepId") ?? "");
  const mergeId = String(formData.get("mergeId") ?? "");
  if (keepId === "" || mergeId === "" || keepId === mergeId) {
    return { error: "Choose which player to keep and which to merge." };
  }

  const client = getServerSupabase();

  try {
    const { data: keep, error: keepError } = await client
      .from("players")
      .select("id, handicap_index, email, phone, gender, whs_number")
      .eq("id", keepId)
      .eq("club_id", auth.clubId)
      .maybeSingle();

    const { data: merge, error: mergeError } = await client
      .from("players")
      .select("id, handicap_index, email, phone, gender, whs_number")
      .eq("id", mergeId)
      .eq("club_id", auth.clubId)
      .maybeSingle();

    if (keepError || mergeError) throw new Error((keepError ?? mergeError)!.message);
    if (!keep || !merge) throw new Error("player not found for this club");

    // Fill blank keeper fields from the source before it disappears.
    const backfill: Record<string, unknown> = {};
    if (keep.handicap_index === null && merge.handicap_index !== null) {
      backfill.handicap_index = merge.handicap_index;
    }
    if (keep.email === null && merge.email !== null) backfill.email = merge.email;
    if (keep.phone === null && merge.phone !== null) backfill.phone = merge.phone;
    if (keep.gender === null && merge.gender !== null) backfill.gender = merge.gender;
    if (keep.whs_number === null && merge.whs_number !== null) {
      backfill.whs_number = merge.whs_number;
    }
    if (Object.keys(backfill).length > 0) {
      const { error } = await client
        .from("players")
        .update({ ...backfill, updated_at: new Date().toISOString() })
        .eq("id", keepId)
        .eq("club_id", auth.clubId);
      if (error) throw new Error(error.message);
    }

    // Re-point every source event entry at the keeper; entries where the
    // keeper already holds a slot in the same event are dropped (the
    // keeper's row is the surviving history for that event).
    const { data: sourceEntries, error: entriesError } = await client
      .from("event_players")
      .select("id, event_id")
      .eq("player_id", mergeId);

    if (entriesError) throw new Error(entriesError.message);

    const keepEventIds = new Set<string>();
    if (sourceEntries && sourceEntries.length > 0) {
      const { data: keepEntries, error: keepEntriesError } = await client
        .from("event_players")
        .select("event_id")
        .eq("player_id", keepId);

      if (keepEntriesError) throw new Error(keepEntriesError.message);
      for (const entry of keepEntries ?? []) {
        keepEventIds.add(entry.event_id);
      }
    }

    for (const entry of sourceEntries ?? []) {
      if (keepEventIds.has(entry.event_id)) {
        const { error } = await client
          .from("event_players")
          .delete()
          .eq("id", entry.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await client
          .from("event_players")
          .update({ player_id: keepId })
          .eq("id", entry.id);
        if (error) throw new Error(error.message);
      }
    }

    // scores/side_game_entries/score_audit reference event_players rows by
    // id — the re-point above keeps them attached to the surviving rows;
    // cascades handle any dropped duplicate entries. Delete the source row.
    const { error: deleteError } = await client
      .from("players")
      .delete()
      .eq("id", mergeId)
      .eq("club_id", auth.clubId);

    if (deleteError) throw new Error(deleteError.message);

    revalidatePath("/admin/players");
    revalidatePath("/admin", "layout");
    return { saved: true, message: PLAYER_MERGE_SAVED_MESSAGE };
  } catch (error) {
    console.error(
      `[players] merge failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}
