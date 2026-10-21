import "server-only";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getStaff, type AuthenticatedStaff } from "@/lib/auth/authorization";
import { FOUNDING_PLAN_MARKER } from "@/lib/staff/schema";

/**
 * Super-admin data access (M4-T010): staff impersonation, trial extension,
 * Founding plan assignment, and the audit-log appender — every privileged
 * operation writes a row to `superadmin_audit_log`. All checks read the
 * `is_superadmin` flag from the database profile row (never a client
 * claim), and the all-clubs view is queried in the page itself
 * (src/app/admin/superadmin/page.tsx).
 */

export const IMPERSONATION_COOKIE = "teeboard_impersonation";

/** Thrown by every superadmin helper when the caller is not a superadmin. */
export class NotSuperadminError extends Error {
  constructor() {
    super("Super admin access is required for this operation.");
    this.name = "NotSuperadminError";
  }
}

async function requireSuperadminStaff(): Promise<AuthenticatedStaff> {
  const staff = await getStaff();
  if (!staff || !staff.isSuperadmin) {
    throw new NotSuperadminError();
  }
  return staff;
}

/** Writes one append-only audit row for the acting superadmin. */
export async function logSuperadminAction(input: {
  readonly actorProfileId: string;
  readonly action: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly metadata?: Record<string, unknown>;
}): Promise<void> {
  const client = getServerSupabase();

  const { error } = await client.from("superadmin_audit_log").insert({
    actor_profile_id: input.actorProfileId,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId,
    metadata: input.metadata ?? {},
  });

  if (error) {
    throw new Error(`Failed to write superadmin audit row: ${error.message}`);
  }
}

// ─── Impersonation ───────────────────────────────────────────────────────────

export type ImpersonationSession = {
  readonly actorProfileId: string;
  readonly targetProfileId: string;
};

function impersonationCookieValue(session: ImpersonationSession): string {
  return JSON.stringify([
    session.actorProfileId,
    session.targetProfileId,
  ] as const);
}

function parseImpersonationCookie(
  raw: string | undefined,
): { actorProfileId: string; targetProfileId: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [actor, target] = parsed as [unknown, unknown];
    if (typeof actor !== "string" || typeof target !== "string") return null;
    if (!actor || !target) return null;
    return { actorProfileId: actor, targetProfileId: target };
  } catch {
    return null;
  }
}

/**
 * Starts impersonating a club's staff member: records the impersonation in
 * `superadmin_audit_log` FIRST (an audit row must exist before any
 * impersonated request runs), then sets the impersonation cookie. The
 * cookie stores only actor + target profile ids — every subsequent request
 * re-resolves both rows server-side, so a stale or forged cookie resolves
 * nothing.
 */
export async function startImpersonation(
  targetProfileId: string,
): Promise<ImpersonationSession> {
  const staff = await requireSuperadminStaff();
  const client = getServerSupabase();

  const { data: target, error } = await client
    .from("profiles")
    .select("id, full_name, club_id")
    .eq("id", targetProfileId)
    .maybeSingle<{ id: string; full_name: string; club_id: string | null }>();

  if (error || !target) {
    throw new Error("That staff member does not exist.");
  }

  await logSuperadminAction({
    actorProfileId: staff.profileId,
    action: "impersonate",
    targetType: "profiles",
    targetId: target.id,
    metadata: {
      actorEmail: staff.email,
      targetFullName: target.full_name,
      targetClubId: target.club_id,
    },
  });

  const session: ImpersonationSession = {
    actorProfileId: staff.profileId,
    targetProfileId: target.id,
  };

  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATION_COOKIE, impersonationCookieValue(session), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });

  return session;
}

/**
 * Stops the active impersonation: clears the cookie and audits the end of
 * the session. The actor is resolved from the cookie (NOT from `getStaff`,
 * which resolves to the impersonated target while the session is active —
 * the actor would appear to be a non-superadmin and the audit row would be
 * skipped). A stop without an active session is a no-op (idempotent).
 */
export async function stopImpersonation(): Promise<void> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(IMPERSONATION_COOKIE)?.value;
  const parsed = parseImpersonationCookie(raw);

  cookieStore.delete(IMPERSONATION_COOKIE);

  if (!parsed) return;

  const client = getServerSupabase();
  const { data: actor } = await client
    .from("profiles")
    .select("id, email, is_superadmin")
    .eq("id", parsed.actorProfileId)
    .maybeSingle<{ id: string; email: string; is_superadmin: boolean }>();

  if (!actor || !actor.is_superadmin) return;

  await logSuperadminAction({
    actorProfileId: actor.id,
    action: "impersonate_end",
    targetType: "profiles",
    targetId: parsed.targetProfileId,
    metadata: { actorEmail: actor.email },
  });
}

/**
 * Resolves the active impersonation for a signed-in superadmin, or null.
 * The actor must still be a superadmin (a demoted actor's stale cookie is
 * ignored) and both profile rows must exist.
 */
export async function getActiveImpersonation(): Promise<ImpersonationSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(IMPERSONATION_COOKIE)?.value;
  const parsed = parseImpersonationCookie(raw);
  if (!parsed) return null;

  const client = getServerSupabase();

  const { data: actor } = await client
    .from("profiles")
    .select("id, email, is_superadmin")
    .eq("id", parsed.actorProfileId)
    .maybeSingle<{ id: string; email: string; is_superadmin: boolean }>();

  if (!actor || !actor.is_superadmin) return null;

  const { data: target } = await client
    .from("profiles")
    .select("id, full_name, club_id")
    .eq("id", parsed.targetProfileId)
    .maybeSingle<{ id: string; full_name: string; club_id: string | null }>();

  if (!target) return null;

  return Object.freeze({
    actorProfileId: actor.id,
    targetProfileId: target.id,
  });
}

// ─── Trial extension & Founding plan ──────────────────────────────────────────

/** Extends a club's trial by re-arming the pilot plan window (audit-logged). */
export async function extendClubTrial(
  clubId: string,
  days: number,
): Promise<void> {
  const staff = await requireSuperadminStaff();
  const client = getServerSupabase();

  const { data: updated, error } = await client
    .from("clubs")
    .update({
      plan: "pilot",
      updated_at: new Date().toISOString(),
    })
    .eq("id", clubId)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new Error(`Failed to extend trial: ${error.message}`);
  }
  if (!updated) {
    throw new Error("That club does not exist.");
  }

  await logSuperadminAction({
    actorProfileId: staff.profileId,
    action: "extend_trial",
    targetType: "clubs",
    targetId: clubId,
    metadata: { actorEmail: staff.email, days },
  });
}

/**
 * Assigns the Founding plan to a club. The Phase 1 `clubs.plan` check
 * constraint admits only `free | pilot | pro` and the schema is frozen for
 * this milestone, so Founding is stored as `plan = 'pro'` with
 * `billing_status = 'active'`; the audit row records the Founding intent.
 */
export async function assignFoundingPlan(clubId: string): Promise<void> {
  const staff = await requireSuperadminStaff();
  const client = getServerSupabase();

  const { data: updated, error } = await client
    .from("clubs")
    .update({
      plan: FOUNDING_PLAN_MARKER,
      billing_status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", clubId)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new Error(`Failed to assign Founding plan: ${error.message}`);
  }
  if (!updated) {
    throw new Error("That club does not exist.");
  }

  await logSuperadminAction({
    actorProfileId: staff.profileId,
    action: "assign_founding_plan",
    targetType: "clubs",
    targetId: clubId,
    metadata: { actorEmail: staff.email },
  });
}
