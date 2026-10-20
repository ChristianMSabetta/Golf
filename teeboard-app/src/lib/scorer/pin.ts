import "server-only";
import { getServerSupabase } from "@/lib/supabase/server";
import { verifyScorerPinHash } from "@/lib/scorer/pin-hash";
import type { ScorerPinVerify } from "@/lib/auth/schema";

export type ScorerPinFailure =
  | { ok: false; reason: "invalid_pin"; remainingAttempts: number }
  | { ok: false; reason: "locked_out"; lockedUntil: string }
  | { ok: false; reason: "event_closed" | "not_found" };

export type ScorerPinResult =
  | { ok: true; eventId: string }
  | ScorerPinFailure;

export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCKOUT_SECONDS = 600;

/**
 * Verifies a scorer PIN against the event's salted hash server-side.
 *
 * This is a reusable authorization primitive, not a scorer-facing surface
 * (the /e/[shortCode]/score page arrives in Phase 4). It is the only
 * credential path a scorer has — scorers never get a Supabase Auth account.
 *
 * Lockout state is stored in the pin_attempts table and enforced here with
 * the service-role client (staff RLS on pin_attempts is read/update only —
 * inserts are service-role-only, so clients can never fabricate or reset
 * attempt counters): 5 failed attempts lock the (event, identifier) pair
 * for 10 minutes.
 */
export async function verifyScorerPin(
  input: ScorerPinVerify,
): Promise<ScorerPinResult> {
  const client = getServerSupabase();

  const { data: event, error: eventError } = await client
    .from("events")
    .select("id, status, scorer_pin_hash, scorer_pin_salt")
    .eq("id", input.eventId)
    .maybeSingle<{
      id: string;
      status: "draft" | "scheduled" | "live" | "completed" | "archived";
      scorer_pin_hash: string;
      scorer_pin_salt: string;
    }>();

  if (eventError) {
    throw new Error(`Failed to load event for PIN verification: ${eventError.message}`);
  }

  if (!event) {
    return { ok: false, reason: "not_found" };
  }

  const identifier = input.identifier ?? "anonymous";

  // ─── lockout check first: locked pairs fail fast ───────────────────────
  const { data: attempt, error: attemptError } = await client
    .from("pin_attempts")
    .select("attempt_count, locked_at")
    .eq("event_id", input.eventId)
    .eq("identifier", identifier)
    .maybeSingle<{ attempt_count: number; locked_at: string | null }>();

  if (attemptError) {
    throw new Error(`Failed to load PIN attempt state: ${attemptError.message}`);
  }

  if (attempt?.locked_at) {
    const lockedUntil = new Date(
      new Date(attempt.locked_at).getTime() + PIN_LOCKOUT_SECONDS * 1000,
    );
    if (lockedUntil > new Date()) {
      return {
        ok: false,
        reason: "locked_out",
        lockedUntil: lockedUntil.toISOString(),
      };
    }
  }

  if (event.status === "completed" || event.status === "archived") {
    return { ok: false, reason: "event_closed" };
  }

  // ─── constant-time PIN verification ──────────────────────────────────
  const pinOk = verifyScorerPinHash(
    input.pin,
    event.scorer_pin_salt,
    event.scorer_pin_hash,
  );

  if (!pinOk) {
    const nextCount = Math.min((attempt?.attempt_count ?? 0) + 1, PIN_MAX_ATTEMPTS);
    const lock = nextCount >= PIN_MAX_ATTEMPTS;

    const { error: writeError } = await client.from("pin_attempts").upsert(
      {
        event_id: input.eventId,
        identifier,
        attempt_count: nextCount,
        locked_at: lock ? new Date().toISOString() : null,
        last_attempt_at: new Date().toISOString(),
      },
      { onConflict: "event_id,identifier" },
    );

    if (writeError) {
      throw new Error(`Failed to record PIN attempt: ${writeError.message}`);
    }

    if (lock) {
      return {
        ok: false,
        reason: "locked_out",
        lockedUntil: new Date(
          Date.now() + PIN_LOCKOUT_SECONDS * 1000,
        ).toISOString(),
      };
    }

    return {
      ok: false,
      reason: "invalid_pin",
      remainingAttempts: PIN_MAX_ATTEMPTS - nextCount,
    };
  }

  // ─── success resets the counter ─────────────────────────────────────
  if (attempt) {
    const { error: resetError } = await client
      .from("pin_attempts")
      .update({
        attempt_count: 0,
        locked_at: null,
        last_attempt_at: new Date().toISOString(),
      })
      .eq("event_id", input.eventId)
      .eq("identifier", identifier);

    if (resetError) {
      throw new Error(`Failed to reset PIN attempt state: ${resetError.message}`);
    }
  }

  return { ok: true, eventId: event.id };
}
