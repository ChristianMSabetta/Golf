"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getStaff } from "@/lib/auth/authorization";
import { fieldErrors } from "@/lib/course/field-errors";
import {
  validatePairingPlan,
  groupsStepPayloadSchema,
  type PairingPlan,
} from "./pairing";
import type { WizardActionState } from "./schema";

/**
 * Wizard Groups & teams step server actions (M4-T006). Authorization
 * runs server-side before validation on every action; writes go through
 * the service-role client with the club check enforced in every
 * `.eq("club_id", …)` filter (the service role bypasses RLS, so the
 * tenant guard is the filter itself). Staff roles allowed to manage
 * groups match the events RLS policy set (`owner`, `head_pro`,
 * `event_manager`).
 *
 * The save replaces the event's groups wholesale in a deliberate order —
 * insert every planned group, re-point `event_players.group_id`, then
 * delete the orphaned previous rows — so the persisted shape always
 * matches the editor exactly. Draft events only.
 */

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const NO_CLUB_ERROR =
  "No club is linked to your account yet — ask your club owner to invite you.";
const FORBIDDEN_ERROR =
  "Your role doesn't allow managing events. Ask the club owner.";
const NOT_FOUND_ERROR =
  "This draft event doesn't exist in your club — it may have been deleted.";
const NOT_DRAFT_ERROR = "Only draft events can be edited in the wizard.";
const NO_PLAYERS_ERROR =
  "Add players to the event first — groups need a field.";

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

type DraftEventRow = {
  id: string;
  status: "draft" | "scheduled" | "live" | "completed" | "archived";
  holes_count: number;
  nine_option: "front" | "back";
  start_type: "tee_times" | "shotgun";
};

async function loadDraftEvent(
  client: ReturnType<typeof getServerSupabase>,
  eventId: string,
  clubId: string,
): Promise<DraftEventRow | null> {
  const { data, error } = await client
    .from("events")
    .select("id, status, holes_count, nine_option, start_type")
    .eq("id", eventId)
    .eq("club_id", clubId)
    .maybeSingle<DraftEventRow>();

  if (error) throw new Error(error.message);
  return data ?? null;
}

/**
 * Persists the Groups & teams step onto the draft event: every planned
 * group becomes a `groups` row with its starting hole and cart number,
 * and every member's `event_players.group_id` is re-pointed. The plan is
 * validated (team size, unique holes, hole bounds) server-side against
 * the same pure helpers the client uses.
 *
 * The save deletes the previous groups first — `groups` is unique per
 * `(event_id, name)`, so the new "Group N" rows cannot coexist with the
 * old ones — and the deletion nulls every `event_players.group_id`
 * (`on delete set null`) before the planned members are re-pointed. A
 * failure mid-save therefore leaves the event consistent (everyone
 * unassigned) and the editor's plan untouched client-side, so a retry
 * re-inserts it wholesale. Draft events only.
 */
export async function saveGroupsStep(
  _prev: WizardActionState,
  formData: FormData,
): Promise<WizardActionState> {
  const auth = await authorizeEventStaff();
  if (!auth) return unauthorizedState();

  const parsed = groupsStepPayloadSchema.safeParse(
    jsonField(formData, "payload"),
  );
  if (!parsed.success) {
    return {
      error: "Please fix the highlighted fields.",
      fields: fieldErrors(parsed.error.issues),
    };
  }
  const payload = parsed.data;
  const client = getServerSupabase();

  try {
    const event = await loadDraftEvent(
      client,
      payload.eventId,
      auth.clubId,
    );
    if (!event) return { error: NOT_FOUND_ERROR };
    if (event.status !== "draft") return { error: NOT_DRAFT_ERROR };

    // The step's numbers must agree with the event it saves onto — a
    // stale tab saving an old plan would otherwise break the shotgun.
    if (
      payload.holesCount !== event.holes_count ||
      payload.nineOption !== event.nine_option ||
      payload.startType !== event.start_type
    ) {
      return {
        error:
          "The event's basics changed — reload the page and pair the groups again.",
      };
    }

    // Nobody attached → nothing to pair.
    const { data: attached, error: attachedError } = await client
      .from("event_players")
      .select("player_id")
      .eq("event_id", payload.eventId);
    if (attachedError) throw new Error(attachedError.message);
    if ((attached ?? []).length === 0) return { error: NO_PLAYERS_ERROR };

    const attachedIds = new Set(
      (attached ?? []).map((row: { player_id: string }) => row.player_id),
    );
    const plan: PairingPlan = {
      groups: payload.groups,
      unassigned: payload.unassigned,
    };
    const issues = validatePairingPlan(plan, {
      teamSize: payload.teamSize,
      startType: payload.startType,
      holesCount: payload.holesCount,
      nineOption: payload.nineOption,
    });
    if (issues.length > 0) {
      return { error: issues[0]!.message };
    }

    // Every member must be a real attached player of this event.
    const planned = plan.groups.flatMap((group) => group.playerIds);
    if (planned.some((playerId) => !attachedIds.has(playerId))) {
      return {
        error:
          "A planned group holds someone who isn't in the event roster.",
      };
    }

    // Clear the previous groups: their names would collide with the
    // planned ones (unique per event + name), and the deletion nulls
    // every member's `group_id` (on delete set null) before the plan
    // re-points its own.
    const { error: groupsError } = await client
      .from("groups")
      .delete()
      .eq("event_id", payload.eventId);
    if (groupsError) throw new Error(groupsError.message);

    const insertedIds: string[] = [];
    for (const group of plan.groups) {
      const { data: inserted, error } = await client
        .from("groups")
        .insert({
          event_id: payload.eventId,
          name: group.name,
          starting_hole:
            payload.startType === "shotgun" ? group.startingHole : null,
          cart_number: group.cartNumber,
        })
        .select("id")
        .single<{ id: string }>();
      if (error) throw new Error(error.message);
      insertedIds.push(inserted.id);
    }

    for (const [index, group] of plan.groups.entries()) {
      if (group.playerIds.length === 0) continue;
      const groupId = insertedIds[index]!;
      const { error } = await client
        .from("event_players")
        .update({ group_id: groupId })
        .eq("event_id", payload.eventId)
        .in("player_id", [...group.playerIds]);
      if (error) throw new Error(error.message);
    }

    revalidatePath("/admin/events");
    revalidatePath("/admin/events/new");
    return {
      saved: true,
      eventId: payload.eventId,
      savedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(
      `[events] groups save failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}
