"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getStaff } from "@/lib/auth/authorization";
import { hashScorerPin } from "@/lib/scorer/pin-hash";
import { newGroupToken } from "./publish";
import { fieldErrors } from "@/lib/course/field-errors";
import {
  eventSettingsSchema,
  formatChangeNeedsConfirmation,
  isFormatChangeConfirmed,
} from "./admin";

/**
 * Event admin server actions (M4-T008): the Settings tab save (with the
 * CHANGE confirmation enforced server-side for format changes on live
 * events) and the quick actions — Duplicate, Archive, Delete. Authorization
 * runs server-side before validation on every action; writes go through the
 * service-role client with the club check enforced in every
 * `.eq("club_id", …)` filter (the service role bypasses RLS, so the tenant
 * guard is the filter itself). Staff roles match the events RLS policy set
 * (`owner`, `head_pro`, `event_manager`).
 *
 * Delete is restricted to draft events **server-side** — the guard is a
 * status filter on the delete itself, not a UI affordance. Duplicate always
 * lands a fresh draft (statuses never copy); Archive works on published
 * events.
 */

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const VALIDATION_ERROR = "Please fix the highlighted fields.";
const NO_CLUB_ERROR =
  "No club is linked to your account yet — ask your club owner to invite you.";
const FORBIDDEN_ERROR =
  "Your role doesn't allow managing events. Ask the club owner.";
const NOT_FOUND_ERROR =
  "This event doesn't exist in your club — it may have been deleted.";
const CHANGE_CONFIRM_ERROR =
  "Type CHANGE to confirm changing the scoring format on a live event.";
const DELETE_DRAFT_ONLY_ERROR =
  "Only draft events can be deleted — archive a published event instead.";
const ARCHIVE_DRAFT_ERROR =
  "Archive a published event, not a draft — drafts are deleted.";
const ARCHIVE_CLOSED_ERROR =
  "This event is already archived or completed.";

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

async function unauthorizedState(): Promise<AdminActionState> {
  const staff = await getStaff();
  if (!staff) return { error: "Please sign in to continue." };
  if (staff.clubId === null) return { error: NO_CLUB_ERROR };
  return { error: FORBIDDEN_ERROR };
}

/** The admin actions' state: a message, field errors, and the draft gate. */
export type AdminActionState = {
  readonly error?: string;
  readonly fields?: Record<string, string>;
  readonly saved?: boolean;
  readonly message?: string;
  readonly savedAt?: string;
};

type EventRow = {
  id: string;
  status: "draft" | "scheduled" | "live" | "completed" | "archived";
};

/** Loads the club's event row (any status) via the service-role client. */
async function loadEvent(
  client: ReturnType<typeof getServerSupabase>,
  eventId: string,
  clubId: string,
): Promise<EventRow | null> {
  const { data, error } = await client
    .from("events")
    .select("id, status")
    .eq("id", eventId)
    .eq("club_id", clubId)
    .maybeSingle<EventRow>();

  if (error) throw new Error(error.message);
  return data ?? null;
}

function jsonField(formData: FormData, name: string): unknown {
  const raw = formData.get(name);
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

/** A byte source backed by `node:crypto` — the actions' only randomness. */
function cryptoByteSource(): () => number {
  let pool = randomBytes(64);
  let index = 0;
  return () => {
    if (index >= pool.length) {
      pool = randomBytes(64);
      index = 0;
    }
    const value = pool[index] ?? 0;
    index += 1;
    return value;
  };
}

// ─── Settings save ───────────────────────────────────────────────────────────

/**
 * Persists the Settings tab (M4-T008): the event's basics columns plus the
 * primary `event_formats` row. On a live (published) event, a **format
 * change** — a different scoring format than the persisted one — requires
 * the typed CHANGE confirmation, enforced **here** (a tampered client that
 * skips the input cannot apply the change). Drafts change freely.
 */
export async function saveEventSettings(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const auth = await authorizeEventStaff();
  if (!auth) return unauthorizedState();

  const eventId = String(formData.get("eventId") ?? "");
  if (eventId === "") return { error: NOT_FOUND_ERROR };

  const payload = jsonField(formData, "payload");
  const parsed = eventSettingsSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      error: VALIDATION_ERROR,
      fields: fieldErrors(parsed.error.issues),
    };
  }
  const settings = parsed.data;
  const confirm = String(formData.get("confirmFormat") ?? "");

  const client = getServerSupabase();

  try {
    const event = await loadEvent(client, eventId, auth.clubId);
    if (!event) return { error: NOT_FOUND_ERROR };

    // The mid-event edit safeguard: on a live (published) event, changing
    // the scoring format requires the typed CHANGE confirmation. The
    // guard runs server-side — the client's confirm input is a
    // convenience, never the enforcement.
    const { data: current, error: currentError } = await client
      .from("event_formats")
      .select("format")
      .eq("event_id", eventId)
      .eq("is_primary", true)
      .maybeSingle<{ format: string }>();
    if (currentError) throw new Error(currentError.message);

    if (
      current !== null &&
      current.format !== settings.format &&
      formatChangeNeedsConfirmation(event.status) &&
      !isFormatChangeConfirmed(confirm)
    ) {
      return {
        error: CHANGE_CONFIRM_ERROR,
        fields: { confirmFormat: CHANGE_CONFIRM_ERROR },
      };
    }

    const eventRow = {
      name: settings.name,
      start_date: settings.startDate,
      holes_count: settings.holesCount,
      nine_option: settings.nineOption,
      rounds: settings.rounds,
      start_type: settings.startType,
      welcome_message:
        settings.welcomeMessage === "" ? null : settings.welcomeMessage,
      is_public: settings.isPublic,
      updated_at: new Date().toISOString(),
    };

    const { error: eventError } = await client
      .from("events")
      .update(eventRow)
      .eq("id", eventId)
      .eq("club_id", auth.clubId);
    if (eventError) throw new Error(eventError.message);

    // The primary format row: an unchanged format is updated in place (no
    // row-id churn, no delete window); a changed format is a delete +
    // insert so the `(event_id, format)` unique constraint can never clash
    // — exactly the wizard's Format-step split.
    const formatRow = {
      team_size: settings.teamSize,
      scoring_basis: settings.scoringBasis,
      handicap_allowance_pct: settings.handicapAllowancePct,
      max_score_rule: settings.maxScoreRule,
      max_score_fixed_cap:
        settings.maxScoreRule === "fixed" ? settings.maxScoreFixedCap : null,
      tiebreak_method: settings.tiebreakMethod,
    };

    if (current !== null && current.format === settings.format) {
      const { error: updateError } = await client
        .from("event_formats")
        .update(formatRow)
        .eq("event_id", eventId)
        .eq("format", settings.format)
        .eq("is_primary", true);
      if (updateError) throw new Error(updateError.message);
    } else {
      if (current !== null) {
        const { error: deleteError } = await client
          .from("event_formats")
          .delete()
          .eq("event_id", eventId)
          .eq("format", current.format)
          .eq("is_primary", true);
        if (deleteError) throw new Error(deleteError.message);
      }

      const { error: insertError } = await client
        .from("event_formats")
        .insert({ ...formatRow, event_id: eventId, format: settings.format, is_primary: true });
      if (insertError) throw new Error(insertError.message);
    }

    revalidatePath("/admin/events");
    revalidatePath(`/admin/events/${eventId}`);
    return {
      saved: true,
      message: "Settings saved.",
      savedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(
      `[events] settings save failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}

// ─── Duplicate ──────────────────────────────────────────────────────────────

type EventCopyRow = {
  id: string;
  name: string;
  start_date: string;
  course_id: string;
  holes_count: number;
  nine_option: string;
  rounds: number;
  start_type: string;
  welcome_message: string | null;
  is_public: boolean;
  payout_preset_id: string | null;
  payout_purse: number | null;
};

type FormatCopyRow = {
  format: string;
  team_size: number;
  scoring_basis: string;
  handicap_allowance_pct: number | string | null;
  max_score_rule: string;
  max_score_fixed_cap: number | null;
  tiebreak_method: string;
};

type FlightCopyRow = {
  name: string;
  max_handicap: number | string | null;
  position: number;
};

type SideGameCopyRow = {
  game_type: string;
  name: string | null;
  hole_value: number | string | null;
};

type SponsorCopyRow = {
  name: string;
  logo_path: string;
  position: number;
};

type GroupCopyRow = {
  name: string;
  starting_hole: number | null;
  cart_number: number | null;
};

type MemberCopyRow = {
  player_id: string;
  tee_set_id: string | null;
  group_id: string | null;
  course_handicap: number | null;
};

const COPY_NAME_SUFFIX = " (copy)";

/**
 * Duplicates an event into a fresh draft (M4-T008): the event row (statuses
 * and credentials never copy — a draft gets its own unpublished PIN hash),
 * its primary format, flights, side games, sponsors (the logo objects are
 * shared, not re-uploaded), groups, and roster attachments (with fresh
 * 32-char crypto-random group tokens). Scores are player observations of a
 * played day — they never copy.
 */
export async function duplicateEvent(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const auth = await authorizeEventStaff();
  if (!auth) return unauthorizedState();

  const eventId = String(formData.get("eventId") ?? "");
  if (eventId === "") return { error: NOT_FOUND_ERROR };

  const client = getServerSupabase();

  try {
    const { data: source, error: sourceError } = await client
      .from("events")
      .select(
        "id, name, start_date, course_id, holes_count, nine_option, rounds, start_type, welcome_message, is_public, payout_preset_id, payout_purse",
      )
      .eq("id", eventId)
      .eq("club_id", auth.clubId)
      .maybeSingle<EventCopyRow>();
    if (sourceError) throw new Error(sourceError.message);
    if (!source) return { error: NOT_FOUND_ERROR };

    // The copy's date: a fresh event usually plays on a day of its own;
    // pre-filling today gives the staff member something to change.
    const pin = hashScorerPin(randomBytes(16).toString("hex"));
    const { data: inserted, error: insertError } = await client
      .from("events")
      .insert({
        club_id: auth.clubId,
        course_id: source.course_id,
        name: `${source.name}${COPY_NAME_SUFFIX}`,
        start_date: new Date().toISOString().slice(0, 10),
        status: "draft",
        holes_count: source.holes_count,
        nine_option: source.nine_option,
        rounds: source.rounds,
        start_type: source.start_type,
        welcome_message: source.welcome_message,
        is_public: source.is_public,
        payout_preset_id: source.payout_preset_id,
        payout_purse: source.payout_purse,
        scorer_pin_hash: pin.hash,
        scorer_pin_salt: pin.salt,
      })
      .select("id")
      .single<{ id: string }>();
    if (insertError) throw new Error(insertError.message);

    const copyId = inserted.id;

    const [formats, flights, sideGames, sponsors, groups] = await Promise.all([
      client
        .from("event_formats")
        .select(
          "format, team_size, scoring_basis, handicap_allowance_pct, max_score_rule, max_score_fixed_cap, tiebreak_method",
        )
        .eq("event_id", eventId)
        .eq("is_primary", true)
        .returns<FormatCopyRow[]>(),
      client
        .from("event_flights")
        .select("name, max_handicap, position")
        .eq("event_id", eventId)
        .order("position", { ascending: true })
        .returns<FlightCopyRow[]>(),
      client
        .from("side_games")
        .select("game_type, name, hole_value")
        .eq("event_id", eventId)
        .returns<SideGameCopyRow[]>(),
      client
        .from("event_sponsors")
        .select("name, logo_path, position")
        .eq("event_id", eventId)
        .order("position", { ascending: true })
        .returns<SponsorCopyRow[]>(),
      client
        .from("groups")
        .select("name, starting_hole, cart_number")
        .eq("event_id", eventId)
        .order("created_at", { ascending: true })
        .returns<GroupCopyRow[]>(),
    ]);

    for (const [index, format] of (formats.data ?? []).entries()) {
      const { error } = await client.from("event_formats").insert({
        event_id: copyId,
        format: format.format,
        is_primary: index === 0,
        team_size: format.team_size,
        scoring_basis: format.scoring_basis,
        handicap_allowance_pct:
          format.handicap_allowance_pct === null
            ? null
            : Number(format.handicap_allowance_pct),
        max_score_rule: format.max_score_rule,
        max_score_fixed_cap: format.max_score_fixed_cap,
        tiebreak_method: format.tiebreak_method,
      });
      if (error) throw new Error(error.message);
    }

    for (const flight of flights.data ?? []) {
      const { error } = await client.from("event_flights").insert({
        event_id: copyId,
        name: flight.name,
        max_handicap:
          flight.max_handicap === null ? null : Number(flight.max_handicap),
        position: flight.position,
      });
      if (error) throw new Error(error.message);
    }

    for (const game of sideGames.data ?? []) {
      const { error } = await client.from("side_games").insert({
        event_id: copyId,
        game_type: game.game_type,
        name: game.name,
        hole_value: game.hole_value === null ? null : Number(game.hole_value),
      });
      if (error) throw new Error(error.message);
    }

    for (const sponsor of sponsors.data ?? []) {
      const { error } = await client.from("event_sponsors").insert({
        event_id: copyId,
        name: sponsor.name,
        logo_path: sponsor.logo_path,
        position: sponsor.position,
      });
      if (error) throw new Error(error.message);
    }

    // Groups + roster: groups insert in source order, then each member
    // re-attaches to the copy group at the same position (matched by name —
    // group names are unique per event) with a fresh crypto-random token.
    const insertedGroupIds: string[] = [];
    for (const group of groups.data ?? []) {
      const { data: inserted, error } = await client
        .from("groups")
        .insert({
          event_id: copyId,
          name: group.name,
          starting_hole: group.starting_hole,
          cart_number: group.cart_number,
        })
        .select("id")
        .single<{ id: string }>();
      if (error) throw new Error(error.message);
      insertedGroupIds.push(inserted.id);
    }

    // name → copy group id, so members map across by their source group name.
    const groupIdByName = new Map<string, string>();
    (groups.data ?? []).forEach((group, index) => {
      const copyIdForGroup = insertedGroupIds[index];
      if (copyIdForGroup !== undefined) groupIdByName.set(group.name, copyIdForGroup);
    });

    const { data: members, error: membersError } = await client
      .from("event_players")
      .select("player_id, tee_set_id, group_id, course_handicap, groups(name)")
      .eq("event_id", eventId);
    if (membersError) throw new Error(membersError.message);

    type MemberRow = MemberCopyRow & {
      groups: { name: string } | { name: string }[] | null;
    };
    for (const row of (members ?? []) as MemberRow[]) {
      const member = { ...row, groups: Array.isArray(row.groups) ? row.groups[0] : row.groups };
      const sourceGroup = member.groups;
      const groupId =
        sourceGroup != null &&
        member.group_id !== null &&
        groupIdByName.has(sourceGroup.name)
          ? (groupIdByName.get(sourceGroup.name) ?? null)
          : null;

      const { error } = await client.from("event_players").insert({
        event_id: copyId,
        player_id: member.player_id,
        tee_set_id: member.tee_set_id,
        group_id: groupId,
        course_handicap: member.course_handicap,
        group_token: newGroupToken(cryptoByteSource()),
      });
      if (error) {
        // A unique (event_id, player_id) clash means a concurrent duplicate
        // already attached them — skip those, never fail the copy.
        if (error.code !== "23505") throw new Error(error.message);
      }
    }

    revalidatePath("/admin/events");
    return {
      saved: true,
      message: `Duplicated into a new draft — finish it in the wizard.`,
      savedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(
      `[events] duplicate failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}

// ─── Archive ────────────────────────────────────────────────────────────────

/**
 * Archives a published event (M4-T008): scheduled/live events move to
 * `archived`; completed events archive idempotently; drafts are refused
 * (drafts are deleted, not archived). The status filter rides the update —
 * the guard is server-side, not a hidden button.
 */
export async function archiveEvent(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const auth = await authorizeEventStaff();
  if (!auth) return unauthorizedState();

  const eventId = String(formData.get("eventId") ?? "");
  if (eventId === "") return { error: NOT_FOUND_ERROR };

  const client = getServerSupabase();

  try {
    const event = await loadEvent(client, eventId, auth.clubId);
    if (!event) return { error: NOT_FOUND_ERROR };
    if (event.status === "draft") return { error: ARCHIVE_DRAFT_ERROR };
    if (event.status === "archived" || event.status === "completed") {
      return { error: ARCHIVE_CLOSED_ERROR };
    }

    const { data: archived, error } = await client
      .from("events")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", eventId)
      .eq("club_id", auth.clubId)
      .in("status", ["scheduled", "live"])
      .select("id")
      .maybeSingle<{ id: string }>();
    if (error) throw new Error(error.message);
    if (!archived) return { error: ARCHIVE_CLOSED_ERROR };

    revalidatePath("/admin/events");
    revalidatePath(`/admin/events/${eventId}`);
    return {
      saved: true,
      message: "Event archived.",
      savedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(
      `[events] archive failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}

// ─── Delete (draft only, server-enforced) ───────────────────────────────────

/**
 * Deletes a **draft** event (M4-T008). The restriction is enforced on the
 * write itself: the delete filters `.eq("status", "draft")`, so a
 * manipulated client posting a published event's id deletes nothing. The
 * cascade clears the event's formats, flights, sponsors, side games,
 * groups, roster, and scores.
 */
export async function deleteEvent(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const auth = await authorizeEventStaff();
  if (!auth) return unauthorizedState();

  const eventId = String(formData.get("eventId") ?? "");
  if (eventId === "") return { error: NOT_FOUND_ERROR };

  const client = getServerSupabase();

  try {
    const { count, error } = await client
      .from("events")
      .delete({ count: "exact" })
      .eq("id", eventId)
      .eq("club_id", auth.clubId)
      .eq("status", "draft");
    if (error) throw new Error(error.message);

    if ((count ?? 0) === 0) {
      // Distinguish "not yours / gone" from "not a draft" for a clearer
      // message — both fail closed, the write already happened (or not).
      const event = await loadEvent(client, eventId, auth.clubId);
      if (!event) return { error: NOT_FOUND_ERROR };
      return { error: DELETE_DRAFT_ONLY_ERROR };
    }

    revalidatePath("/admin/events");
    return {
      saved: true,
      message: "Draft deleted.",
      savedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(
      `[events] delete failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}
