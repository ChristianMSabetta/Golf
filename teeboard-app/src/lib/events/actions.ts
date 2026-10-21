"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getStaff } from "@/lib/auth/authorization";
import { hashScorerPin } from "@/lib/scorer/pin-hash";
import {
  basicsStepSchema,
  formatStepSchema,
  type WizardActionState,
} from "./schema";
import { fieldErrors } from "@/lib/course/field-errors";

/**
 * Event wizard server actions (M4-T003). Authorization runs server-side
 * before validation on every action; writes go through the service-role
 * client with the club check enforced in every `.eq("club_id", …)` filter
 * (the service role bypasses RLS, so the tenant guard is the filter
 * itself). Staff roles allowed to manage events match the events RLS
 * policy set (`owner`, `head_pro`, `event_manager`).
 *
 * Draft lifecycle: the first valid Basics save creates the `events` row
 * with status `draft`; every later save updates it. Drafts carry a
 * crypto-random unpublished PIN hash to satisfy the NOT NULL columns — it
 * is never revealed and is rotated atomically at publish time (M4-T007).
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
const COURSE_MISSING_ERROR =
  "Choose one of your club's courses for this event.";

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
 * The scorer PIN columns are NOT NULL from Phase 1, but a PIN is only
 * chosen at publish (M4-T007). Drafts carry an unpublished crypto-random
 * value — never a reused constant, never exposed — rotated at publish.
 */
function unpublishedPin(): { hash: string; salt: string } {
  return hashScorerPin(randomBytes(16).toString("hex"));
}

type DraftEventRow = {
  id: string;
  status: "draft" | "scheduled" | "live" | "completed" | "archived";
};

/** Loads the club's draft event row (service role + explicit club filter). */
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

// ─── Basics step ──────────────────────────────────────────────────────────────

/**
 * Creates or updates a draft event from the Basics step. The course is
 * verified to belong to the club before any write.
 */
export async function saveBasicsStep(
  _prev: WizardActionState,
  formData: FormData,
): Promise<WizardActionState> {
  const auth = await authorizeEventStaff();
  if (!auth) return unauthorizedState();

  const payload = jsonField(formData, "payload");
  const parsed = basicsStepSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      error: VALIDATION_ERROR,
      fields: fieldErrors(parsed.error.issues),
    };
  }
  const basics = parsed.data;
  const client = getServerSupabase();

  try {
    const { data: course, error: courseError } = await client
      .from("courses")
      .select("id")
      .eq("id", basics.courseId)
      .eq("club_id", auth.clubId)
      .maybeSingle<{ id: string }>();

    if (courseError) throw new Error(courseError.message);
    if (!course) return { error: COURSE_MISSING_ERROR };

    const eventRow = {
      name: basics.name,
      start_date: basics.startDate,
      course_id: basics.courseId,
      holes_count: basics.holesCount,
      nine_option: basics.nineOption,
      rounds: basics.rounds,
      start_type: basics.startType,
      updated_at: new Date().toISOString(),
    };

    const existingId = typeof formData.get("eventId") === "string"
      ? String(formData.get("eventId"))
      : "";

    let eventId = existingId;
    if (existingId !== "") {
      const existing = await loadDraftEvent(client, existingId, auth.clubId);
      if (!existing) return { error: NOT_FOUND_ERROR };
      if (existing.status !== "draft") return { error: NOT_DRAFT_ERROR };

      const { error: updateError } = await client
        .from("events")
        .update(eventRow)
        .eq("id", existingId)
        .eq("club_id", auth.clubId);
      if (updateError) throw new Error(updateError.message);
    } else {
      const pin = unpublishedPin();
      const { data: inserted, error: insertError } = await client
        .from("events")
        .insert({
          ...eventRow,
          club_id: auth.clubId,
          status: "draft",
          scorer_pin_hash: pin.hash,
          scorer_pin_salt: pin.salt,
        })
        .select("id")
        .single<{ id: string }>();
      if (insertError) throw new Error(insertError.message);
      eventId = inserted.id;
    }

    revalidatePath("/admin/events");
    return {
      saved: true,
      eventId,
      savedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(
      `[events] basics save failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}

// ─── Format step ──────────────────────────────────────────────────────────────

/**
 * Persists the Format step onto the event's primary `event_formats` row:
 * the wizard keeps exactly one primary format; a changed format is a
 * delete + insert so the `(event_id, format)` unique constraint can never
 * clash.
 */
export async function saveFormatStep(
  _prev: WizardActionState,
  formData: FormData,
): Promise<WizardActionState> {
  const auth = await authorizeEventStaff();
  if (!auth) return unauthorizedState();

  const eventId = String(formData.get("eventId") ?? "");
  if (eventId === "") {
    return { error: "Save the Basics step before the format." };
  }

  const payload = jsonField(formData, "payload");
  const parsed = formatStepSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      error: VALIDATION_ERROR,
      fields: fieldErrors(parsed.error.issues),
    };
  }
  const format = parsed.data;
  const client = getServerSupabase();

  try {
    const event = await loadDraftEvent(client, eventId, auth.clubId);
    if (!event) return { error: NOT_FOUND_ERROR };
    if (event.status !== "draft") return { error: NOT_DRAFT_ERROR };

    const { data: existing, error: existingError } = await client
      .from("event_formats")
      .select("id, format, is_primary")
      .eq("event_id", eventId)
      .eq("is_primary", true)
      .maybeSingle<{ id: string; format: string; is_primary: boolean }>();

    if (existingError) throw new Error(existingError.message);

    const row = {
      format: format.format,
      is_primary: true,
      team_size: format.teamSize,
      scoring_basis: format.scoringBasis,
      handicap_allowance_pct: format.handicapAllowancePct,
      max_score_rule: format.maxScoreRule,
      max_score_fixed_cap:
        format.maxScoreRule === "fixed" ? format.maxScoreFixedCap : null,
      tiebreak_method: format.tiebreakMethod,
    };

    if (existing) {
      const { error: deleteError } = await client
        .from("event_formats")
        .delete()
        .eq("id", existing.id)
        .eq("is_primary", true);
      if (deleteError) throw new Error(deleteError.message);
    }

    const { error: insertError } = await client
      .from("event_formats")
      .insert({ ...row, event_id: eventId });
    if (insertError) throw new Error(insertError.message);

    revalidatePath("/admin/events");
    return {
      saved: true,
      eventId,
      savedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(
      `[events] format save failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}
