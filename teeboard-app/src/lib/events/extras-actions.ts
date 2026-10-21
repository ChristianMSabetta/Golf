"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getStaff } from "@/lib/auth/authorization";
import { hashScorerPin } from "@/lib/scorer/pin-hash";
import { fieldErrors } from "@/lib/course/field-errors";
import {
  SPONSOR_BUCKET,
  extrasStepSchema,
  sideGamesToRows,
  type ExtrasStep,
} from "./extras";
import {
  publishStepSchema,
  newGroupToken,
  newScorerPin,
  newShortCode,
  publicLeaderboardUrl,
  scorerEntryUrl,
  tvUrl,
  type PublishResult,
} from "./publish";
import type { WizardActionState } from "./schema";

/**
 * Wizard Extras & publish server actions (M4-T007). Authorization runs
 * server-side before validation on every action; writes go through the
 * service-role client with the club check enforced in every filter (the
 * service role bypasses RLS, so the tenant guard is the filter itself).
 * Staff roles match the events RLS policy set (`owner`, `head_pro`,
 * `event_manager`). Draft events only — a published event is managed from
 * its admin page, not the wizard.
 *
 * Publish is atomic in one update: the short code, the rotated salted
 * 4-digit PIN, and `published_at` land together, then every group member's
 * `event_players.group_token` is re-minted (32-char crypto-random hex, per
 * the Phase 1 column checks). A mid-publish failure leaves the event a
 * draft with its old credentials — publish is retried, never half-live.
 */

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const VALIDATION_ERROR = "Please fix the highlighted fields.";
const NO_CLUB_ERROR =
  "No club is linked to your account yet — ask your club owner to invite you.";
const FORBIDDEN_ERROR =
  "Your role doesn't allow managing events. Ask the club owner.";
const NOT_FOUND_ERROR =
  "This draft event doesn't exist in your club — it may have been deleted.";
const NOT_DRAFT_ERROR = "Only draft events can be edited in the wizard.";
const NO_PLAYERS_ERROR =
  "Add players to the event before publishing — a published event needs a field.";
const SHORT_CODE_BUSY_ERROR =
  "Couldn't allocate a short code — please try publishing again.";

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

async function unauthorizedState(): Promise<WizardActionState> {
  const staff = await getStaff();
  if (!staff) return { error: "Please sign in to continue." };
  if (staff.clubId === null) return { error: NO_CLUB_ERROR };
  return { error: FORBIDDEN_ERROR };
}

/** The sponsor id encoded in a flattened remove-<uuid> field name. */
function sponsorIdFromField(field: string): string {
  return field.slice("remove-".length);
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

type DraftEventRow = {
  id: string;
  status: "draft" | "scheduled" | "live" | "completed" | "archived";
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

// ─── Extras step save ────────────────────────────────────────────────────────

/**
 * Persists the Extras step: flights replace `event_flights` wholesale,
 * side games replace `side_games` (the step owns the four kinds it offers —
 * rows of other kinds stay untouched), and the welcome message + visibility
 * land on the event row. Sponsor logos are uploaded separately (they carry
 * file bytes) and are only read here.
 */
export async function saveExtrasStep(
  _prev: WizardActionState,
  formData: FormData,
): Promise<WizardActionState> {
  const auth = await authorizeEventStaff();
  if (!auth) return unauthorizedState();

  const eventId = String(formData.get("eventId") ?? "");
  if (eventId === "") {
    return { error: "Save the earlier steps before the extras." };
  }

  const payload = jsonField(formData, "payload");
  const parsed = extrasStepSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: VALIDATION_ERROR, fields: fieldErrors(parsed.error.issues) };
  }
  const extras: ExtrasStep = parsed.data;
  const client = getServerSupabase();

  try {
    const event = await loadDraftEvent(client, eventId, auth.clubId);
    if (!event) return { error: NOT_FOUND_ERROR };
    if (event.status !== "draft") return { error: NOT_DRAFT_ERROR };

    const { error: eventError } = await client
      .from("events")
      .update({
        welcome_message: extras.welcomeMessage === "" ? null : extras.welcomeMessage,
        is_public: extras.isPublic,
        payout_preset_id: extras.payouts.presetId,
        payout_purse: extras.payouts.purse,
        updated_at: new Date().toISOString(),
      })
      .eq("id", eventId)
      .eq("club_id", auth.clubId);
    if (eventError) throw new Error(eventError.message);

    // Flights replace wholesale: delete then insert in threshold order.
    const { error: flightsDeleteError } = await client
      .from("event_flights")
      .delete()
      .eq("event_id", eventId);
    if (flightsDeleteError) throw new Error(flightsDeleteError.message);

    for (const [index, flight] of extras.flights.entries()) {
      const { error } = await client.from("event_flights").insert({
        event_id: eventId,
        name: flight.name,
        max_handicap: flight.maxHandicap,
        position: index,
      });
      if (error) throw new Error(error.message);
    }

    // Side games: the step owns skins / closest_to_pin / long_drive /
    // longest_putt. Rows of any other kind are left exactly as they are.
    const { data: existing, error: existingError } = await client
      .from("side_games")
      .select("id, game_type")
      .eq("event_id", eventId);
    if (existingError) throw new Error(existingError.message);

    const mine = new Set(["skins", "closest_to_pin", "long_drive", "longest_putt"]);
    const stale = (existing ?? []).filter((row: { game_type: string }) =>
      mine.has(row.game_type),
    );
    if (stale.length > 0) {
      const { error: deleteError } = await client
        .from("side_games")
        .delete()
        .in("id", stale.map((row: { id: string }) => row.id));
      if (deleteError) throw new Error(deleteError.message);
    }

    for (const row of sideGamesToRows(eventId, extras.sideGames)) {
      const { error } = await client.from("side_games").insert({
        event_id: row.event_id,
        game_type: row.game_type,
        name: row.name,
        hole_value: row.hole_value,
      });
      if (error) throw new Error(error.message);
    }

    revalidatePath("/admin/events");
    revalidatePath("/admin/events/new");
    return { saved: true, eventId, savedAt: new Date().toISOString() };
  } catch (error) {
    console.error(
      `[events] extras save failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}

// ─── Sponsor logo upload ─────────────────────────────────────────────────────

const SPONSOR_UPLOAD_ERROR = "Upload a PNG, JPEG, WebP, or SVG logo under 2 MB.";
const SPONSOR_LIMIT_ERROR = "Up to 8 sponsor logos can be attached to an event.";

/**
 * Uploads one sponsor logo into the club-scoped `sponsor-logos` bucket and
 * records the row. The object path is `<club_id>/<event_id>/<uuid>` — the
 * Storage policies scope writes by that club prefix, so club A can never
 * touch club B's objects. Draft events only.
 */
export async function uploadEventSponsor(
  _prev: WizardActionState,
  formData: FormData,
): Promise<WizardActionState> {
  const auth = await authorizeEventStaff();
  if (!auth) return unauthorizedState();

  const eventId = String(formData.get("eventId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const file = formData.get("file");
  if (eventId === "") {
    return { error: "Save the earlier steps before uploading a sponsor." };
  }
  if (name === "") return { error: "Name the sponsor." };
  if (name.length > 80) return { error: "Use 80 characters or fewer for the sponsor name." };
  if (!(file instanceof File) || file.size === 0) {
    return { error: SPONSOR_UPLOAD_ERROR };
  }
  if (file.size > 2 * 1024 * 1024) return { error: SPONSOR_UPLOAD_ERROR };

  const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
  if (!(ALLOWED as readonly string[]).includes(file.type)) {
    return { error: SPONSOR_UPLOAD_ERROR };
  }

  const client = getServerSupabase();

  try {
    const event = await loadDraftEvent(client, eventId, auth.clubId);
    if (!event) return { error: NOT_FOUND_ERROR };
    if (event.status !== "draft") return { error: NOT_DRAFT_ERROR };

    const { count, error: countError } = await client
      .from("event_sponsors")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) >= 8) return { error: SPONSOR_LIMIT_ERROR };

    // Name collisions on (event_id, name) are upserts: re-uploading a
    // sponsor's new logo replaces the old object instead of erroring.
    const { data: existing } = await client
      .from("event_sponsors")
      .select("id, logo_path")
      .eq("event_id", eventId)
      .eq("name", name)
      .maybeSingle<{ id: string; logo_path: string }>();

    const extension = file.type === "image/svg+xml" ? "svg" : file.type.split("/")[1];
    const objectPath = `${auth.clubId}/${eventId}/${crypto.randomUUID()}.${extension}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await client.storage
      .from(SPONSOR_BUCKET)
      .upload(objectPath, buffer, {
        contentType: file.type,
        upsert: false,
      });
    if (uploadError) throw new Error(uploadError.message);

    if (existing) {
      // Best-effort cleanup of the replaced object; the row is the source
      // of truth and a stranded object harms nothing.
      await client.storage.from(SPONSOR_BUCKET).remove([existing.logo_path]);
      const { error: updateError } = await client
        .from("event_sponsors")
        .update({ logo_path: objectPath })
        .eq("id", existing.id)
        .eq("event_id", eventId);
      if (updateError) throw new Error(updateError.message);
    } else {
      const { error: insertError } = await client
        .from("event_sponsors")
        .insert({ event_id: eventId, name, logo_path: objectPath, position: 0 });
      if (insertError) throw new Error(insertError.message);
    }

    revalidatePath("/admin/events/new");
    return { saved: true, eventId, savedAt: new Date().toISOString() };
  } catch (error) {
    console.error(
      `[events] sponsor upload failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}

/** Removes one sponsor row (and its stored object). Draft events only. */
export async function removeEventSponsor(
  _prev: WizardActionState,
  formData: FormData,
): Promise<WizardActionState> {
  const auth = await authorizeEventStaff();
  if (!auth) return unauthorizedState();

  const eventId = String(formData.get("eventId") ?? "");
  // The remove buttons ride the save form (formAction) with per-sponsor
  // hidden fields — the only remove-* entry is the pressed button's.
  const sponsorEntry = [...formData.keys()].find((key) =>
    key.startsWith("remove-"),
  );
  const sponsorId =
    sponsorEntry === undefined ? "" : sponsorIdFromField(sponsorEntry);
  if (eventId === "" || sponsorId === "") {
    return { error: "Pick the sponsor to remove." };
  }

  const client = getServerSupabase();

  try {
    const event = await loadDraftEvent(client, eventId, auth.clubId);
    if (!event) return { error: NOT_FOUND_ERROR };
    if (event.status !== "draft") return { error: NOT_DRAFT_ERROR };

    const { data: sponsor } = await client
      .from("event_sponsors")
      .select("id, logo_path")
      .eq("id", sponsorId)
      .eq("event_id", eventId)
      .maybeSingle<{ id: string; logo_path: string }>();
    if (!sponsor) return { error: NOT_FOUND_ERROR };

    const { error: deleteError } = await client
      .from("event_sponsors")
      .delete()
      .eq("id", sponsor.id)
      .eq("event_id", eventId);
    if (deleteError) throw new Error(deleteError.message);

    await client.storage.from(SPONSOR_BUCKET).remove([sponsor.logo_path]);

    revalidatePath("/admin/events/new");
    return { saved: true, eventId, savedAt: new Date().toISOString() };
  } catch (error) {
    console.error(
      `[events] sponsor removal failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}

// ─── Publish ─────────────────────────────────────────────────────────────────

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

async function allocateShortCode(
  client: ReturnType<typeof getServerSupabase>,
): Promise<string | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = newShortCode(cryptoByteSource());
    const { data: clash } = await client
      .from("events")
      .select("id")
      .eq("short_code", candidate)
      .maybeSingle<{ id: string }>();
    if (!clash) return candidate;
  }
  return null;
}

/**
 * Publishes the draft: one update transitions the event to `published`
 * (status scheduled + published_at) carrying the fresh short code and the
 * rotated 4-digit PIN hash, then every group member's token is re-minted so
 * the QR scoring links a player photographs on the day are the ones the
 * event actually honors. The clear PIN is returned exactly once — it is
 * not recoverable from the salted hash afterwards.
 */
export async function publishEvent(
  _prev: WizardActionState,
  formData: FormData,
): Promise<WizardActionState & { publish?: PublishResult }> {
  const auth = await authorizeEventStaff();
  if (!auth) return unauthorizedState();

  const parsed = publishStepSchema.safeParse({
    eventId: formData.get("eventId"),
    isPublic: formData.get("isPublicField") === "true",
  });
  if (!parsed.success) {
    return { error: VALIDATION_ERROR, fields: fieldErrors(parsed.error.issues) };
  }
  const { eventId } = parsed.data;
  const client = getServerSupabase();

  try {
    const event = await loadDraftEvent(client, eventId, auth.clubId);
    if (!event) return { error: NOT_FOUND_ERROR };
    if (event.status !== "draft") return { error: NOT_DRAFT_ERROR };

    const { count, error: countError } = await client
      .from("event_players")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) === 0) return { error: NO_PLAYERS_ERROR };

    const shortCode = await allocateShortCode(client);
    if (shortCode === null) return { error: SHORT_CODE_BUSY_ERROR };

    const pin = newScorerPin(cryptoByteSource());
    const pinHash = hashScorerPin(pin);

    // The single atomic transition: draft → published with its credentials.
    const { data: published, error: publishError } = await client
      .from("events")
      .update({
        status: "scheduled",
        short_code: shortCode,
        scorer_pin_hash: pinHash.hash,
        scorer_pin_salt: pinHash.salt,
        is_public: parsed.data.isPublic,
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", eventId)
      .eq("club_id", auth.clubId)
      .eq("status", "draft")
      .select("id, short_code")
      .maybeSingle<{ id: string; short_code: string }>();
    if (publishError) throw new Error(publishError.message);
    if (!published) return { error: NOT_DRAFT_ERROR };

    // Re-mint every group token: publish rotates the credential set the
    // game-day surfaces honor. 32-char crypto-random hex per the column
    // checks — one update per player row, same event filter.
    const { data: members, error: membersError } = await client
      .from("event_players")
      .select("id")
      .eq("event_id", eventId);
    if (membersError) throw new Error(membersError.message);
    for (const member of members ?? []) {
      const token = newGroupToken(cryptoByteSource());
      const { error: tokenError } = await client
        .from("event_players")
        .update({ group_token: token })
        .eq("id", (member as { id: string }).id)
        .eq("event_id", eventId);
      if (tokenError) throw new Error(tokenError.message);
    }

    revalidatePath("/admin/events");

    return {
      saved: true,
      eventId,
      savedAt: new Date().toISOString(),
      publish: {
        shortCode,
        scorerPin: pin,
        publicUrl: publicLeaderboardUrl(shortCode),
        tvUrl: tvUrl(shortCode),
        scorerUrl: scorerEntryUrl(),
      },
    };
  } catch (error) {
    console.error(
      `[events] publish failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}
