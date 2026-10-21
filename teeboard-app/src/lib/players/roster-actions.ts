"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getStaff } from "@/lib/auth/authorization";
import {
  handicapCellSchema,
  PLAYER_GENDERS,
  type PlayersActionState,
} from "./schema";
import {
  newGroupToken,
  rosterKey,
  type RosterRow,
} from "./roster";

/**
 * Wizard Players-step server actions (M4-T005). Authorization runs
 * server-side before any validation on every action; writes go through the
 * service-role client with the club check enforced in every
 * `.eq("club_id", …)` filter (the service role bypasses RLS, so the tenant
 * guard is the filter itself). Staff roles allowed to manage rosters match
 * the events RLS policy set (`owner`, `head_pro`, `event_manager`).
 *
 * Roster commits are idempotent: a player already attached to the event is
 * skipped (never duplicated — `event_players` is unique per event+player),
 * and club-player upserts key on (name, email) exactly like the M4-T002
 * import, so committing the same file twice attaches nothing new.
 */

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const NO_CLUB_ERROR =
  "No club is linked to your account yet — ask your club owner to invite you.";
const FORBIDDEN_ERROR =
  "Your role doesn't allow managing events. Ask the club owner.";
const NOT_FOUND_ERROR =
  "This draft event doesn't exist in your club — it may have been deleted.";
const NOT_DRAFT_ERROR = "Only draft events can be edited in the wizard.";

const EVENT_ROLES = ["owner", "head_pro", "event_manager"] as const;

type AuthedClub = { readonly clubId: string };

async function authorizeEventStaff(): Promise<AuthedClub | null> {
  const staff = await getStaff();
  if (!staff) return null;
  if (staff.clubId === null) return null;
  if (
    !staff.isSuperadmin &&
    !EVENT_ROLES.includes(staff.role as (typeof EVENT_ROLES)[number])
  ) {
    return null;
  }
  return { clubId: staff.clubId };
}

async function unauthorizedState(): Promise<PlayersActionState> {
  const staff = await getStaff();
  if (!staff) return { error: "Please sign in to continue." };
  if (staff.clubId === null) return { error: NO_CLUB_ERROR };
  return { error: FORBIDDEN_ERROR };
}

// ─── Payload schema ──────────────────────────────────────────────────────────

const rosterRowSchema = z.object({
  source: z.enum(["csv", "club", "manual"]),
  playerId: z.string().nullable(),
  fullName: z.string().trim().min(1, "Enter the player's name."),
  email: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
      "Enter a valid email address.",
    )
    .transform((v) => (v === "" ? null : v.toLowerCase())),
  phone: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || /^[+()\-.\s0-9]{5,25}$/.test(v),
      "Enter a valid phone number (or clear it).",
    )
    .transform((v) => (v === "" ? null : v)),
  gender: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || PLAYER_GENDERS.includes(v.toLowerCase() as (typeof PLAYER_GENDERS)[number]),
      "Enter mens or womens (or clear it).",
    )
    .transform((v) =>
      v === "" ? null : (v.toLowerCase() as (typeof PLAYER_GENDERS)[number]),
    ),
  handicapIndex: handicapCellSchema,
  whsNumber: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || /^[A-Za-z0-9-]{3,20}$/.test(v),
      "WHS numbers are 3–20 letters, digits, or dashes.",
    )
    .transform((v) => (v === "" ? null : v)),
});

const commitPayloadSchema = z.object({
  eventId: z.string().min(1, "Save the event basics first."),
  rows: z.array(rosterRowSchema).max(500, "Import at most 500 players per batch."),
});

export type RosterCommitRow = z.output<typeof rosterRowSchema>;

export type RosterCommitReport = {
  readonly attachedCount: number;
  readonly skippedCount: number;
  readonly upsertedCount: number;
  readonly rejected: readonly {
    readonly label: string;
    readonly messages: readonly string[];
  }[];
};

export type RosterCommitState = PlayersActionState & {
  readonly report?: RosterCommitReport;
};

// ─── Row helpers ─────────────────────────────────────────────────────────────

type ClubPlayerRow = {
  readonly id: string;
  readonly full_name: string;
  readonly email: string | null;
};

type DraftEventRow = {
  readonly id: string;
  readonly status: "draft" | "scheduled" | "live" | "completed" | "archived";
};

async function loadDraftEvent(
  client: ReturnType<typeof getServerSupabase>,
  eventId: string,
  clubId: string,
): Promise<DraftEventRow | null> {
  const { data, error } = await client
    .from("events")
    .select("id, status")
    .eq("id", eventId)
    .eq("club_id", clubId)
    .maybeSingle<DraftEventRow>();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function loadClubPlayers(
  client: ReturnType<typeof getServerSupabase>,
  clubId: string,
): Promise<readonly ClubPlayerRow[]> {
  const { data, error } = await client
    .from("players")
    .select("id, full_name, email")
    .eq("club_id", clubId);

  if (error) throw new Error(error.message);
  return (data ?? []) as ClubPlayerRow[];
}

/**
 * Upserts one roster row into the club player database, keyed on (name,
 * email) like the M4-T002 import: an existing club row is patched with any
 * new details (blank never overwrites set); a new row is inserted. Returns
 * the club player id plus whether an insert happened.
 */
async function upsertClubPlayer(
  client: ReturnType<typeof getServerSupabase>,
  clubId: string,
  existing: readonly ClubPlayerRow[],
  row: RosterRow,
): Promise<{ id: string; inserted: boolean }> {
  const key = rosterKey(row.fullName, row.email);

  const matches = existing.filter(
    (player) =>
      rosterKey(player.full_name, player.email) === key,
  );

  if (matches.length > 1) {
    throw new Error(
      `player "${row.fullName}" matches ${matches.length} existing records — merge the duplicates first`,
    );
  }

  const target = matches[0];
  if (target !== undefined) {
    const patch: Record<string, unknown> = {};
    if (row.email !== null && row.email !== target.email) patch.email = row.email;
    if (row.phone !== null) patch.phone = row.phone;
    if (row.gender !== null) patch.gender = row.gender;
    if (row.handicapIndex !== null) patch.handicap_index = row.handicapIndex;
    if (row.whsNumber !== null) patch.whs_number = row.whsNumber;
    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString();
      const { data: updated, error } = await client
        .from("players")
        .update(patch)
        .eq("id", target.id)
        .eq("club_id", clubId)
        .select("id")
        .maybeSingle<{ id: string }>();
      if (error) throw new Error(error.message);
      if (!updated) throw new Error("player row vanished mid-attach");
    }
    return { id: target.id, inserted: false };
  }

  const { data: inserted, error } = await client
    .from("players")
    .insert({
      club_id: clubId,
      full_name: row.fullName,
      email: row.email,
      phone: row.phone,
      gender: row.gender,
      handicap_index: row.handicapIndex,
      whs_number: row.whsNumber,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single<{ id: string }>();

  if (error) throw new Error(error.message);
  return { id: inserted.id, inserted: true };
}

/** Idempotently attaches one club player to the event with a fresh token. */
async function attachEventPlayer(
  client: ReturnType<typeof getServerSupabase>,
  eventId: string,
  playerId: string,
): Promise<boolean> {
  const { data: existing, error } = await client
    .from("event_players")
    .select("id")
    .eq("event_id", eventId)
    .eq("player_id", playerId)
    .maybeSingle<{ id: string }>();

  if (error) throw new Error(error.message);
  if (existing) return false;

  const { error: insertError } = await client.from("event_players").insert({
    event_id: eventId,
    player_id: playerId,
    group_token: newGroupToken(),
  });
  if (insertError) {
    // A concurrent attach lost the race on (event_id, player_id) — the
    // player is in; treat it as the skip it is, not a user-facing failure.
    if (insertError.code === "23505") return false;
    throw new Error(insertError.message);
  }
  return true;
}

// ─── Commit ──────────────────────────────────────────────────────────────────

function jsonField(formData: FormData, name: string): unknown {
  const raw = formData.get(name);
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

/**
 * Commits the confirmed roster preview onto the draft event: every row is
 * upserted into the club player database (new details patch the existing
 * club row; new players are inserted) and attached to the event with a
 * crypto-random group token. Attach is idempotent — players already in the
 * event are skipped, so re-running an import attaches nothing new. Rows
 * that fail to validate against the same schema as the preview are
 * rejected individually with actionable messages.
 */
export async function saveEventRoster(
  _prev: RosterCommitState,
  formData: FormData,
): Promise<RosterCommitState> {
  const auth = await authorizeEventStaff();
  if (!auth) return unauthorizedState();

  const parsed = commitPayloadSchema.safeParse(
    jsonField(formData, "payload"),
  );
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? GENERIC_ERROR,
    };
  }
  const { eventId, rows } = parsed.data;

  const client = getServerSupabase();

  try {
    const event = await loadDraftEvent(client, eventId, auth.clubId);
    if (!event) return { error: NOT_FOUND_ERROR };
    if (event.status !== "draft") return { error: NOT_DRAFT_ERROR };

    // Skip rows already attached (by club player id when known).
    const { data: attachedRows, error: attachedError } = await client
      .from("event_players")
      .select("player_id")
      .eq("event_id", eventId);
    if (attachedError) throw new Error(attachedError.message);
    const alreadyAttached = new Set(
      (attachedRows ?? []).map((row: { player_id: string }) => row.player_id),
    );

    const clubPlayers = await loadClubPlayers(client, auth.clubId);

    const rejected: { label: string; messages: readonly string[] }[] = [];
    let attachedCount = 0;
    let skippedCount = 0;
    let upsertedCount = 0;

    // In-batch dedupe: the same person twice in one file attaches once.
    const seenKeys = new Set<string>();

    for (const [index, row] of rows.entries()) {
      const label = `Row ${index + 1} (${row.fullName})`;
      const key = rosterKey(row.fullName, row.email);
      if (seenKeys.has(key)) {
        skippedCount += 1;
        continue;
      }
      seenKeys.add(key);

      try {
        const { id: playerId } = await upsertClubPlayer(
          client,
          auth.clubId,
          clubPlayers,
          row,
        );
        upsertedCount += 1;

        if (alreadyAttached.has(playerId)) {
          skippedCount += 1;
          continue;
        }
        const attached = await attachEventPlayer(client, eventId, playerId);
        if (attached) {
          attachedCount += 1;
          alreadyAttached.add(playerId);
        } else {
          skippedCount += 1;
        }
      } catch (rowError) {
        rejected.push({
          label,
          messages: [rowError instanceof Error ? rowError.message : GENERIC_ERROR],
        });
      }
    }

    revalidatePath("/admin/events");
    revalidatePath("/admin/events/new");
    revalidatePath("/admin/players");

    return {
      saved: true,
      message: `Attached ${attachedCount} player${attachedCount === 1 ? "" : "s"} to the event${skippedCount > 0 ? ` — ${skippedCount} already in` : ""}.`,
      report: {
        attachedCount,
        skippedCount,
        upsertedCount,
        rejected,
      },
    };
  } catch (error) {
    console.error(
      `[players] roster commit failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}

/** Removes one player from the event roster (the club row stays). */
export async function removeEventPlayer(
  _prev: PlayersActionState,
  formData: FormData,
): Promise<PlayersActionState> {
  const auth = await authorizeEventStaff();
  if (!auth) return unauthorizedState();

  const eventId = String(formData.get("eventId") ?? "");
  const playerId = String(formData.get("playerId") ?? "");
  if (eventId === "" || playerId === "") {
    return { error: "Choose the roster entry to remove." };
  }

  const client = getServerSupabase();

  try {
    const event = await loadDraftEvent(client, eventId, auth.clubId);
    if (!event) return { error: NOT_FOUND_ERROR };
    if (event.status !== "draft") return { error: NOT_DRAFT_ERROR };

    const { data: removed, error } = await client
      .from("event_players")
      .delete({ count: "exact" })
      .eq("event_id", eventId)
      .eq("player_id", playerId)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) throw new Error(error.message);
    if (!removed) return { error: "That player isn't in the event roster." };

    revalidatePath("/admin/events/new");
    return { saved: true, message: "Removed from the event roster." };
  } catch (error) {
    console.error(
      `[players] roster remove failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}
