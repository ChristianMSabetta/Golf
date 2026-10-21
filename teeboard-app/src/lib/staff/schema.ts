import { z } from "zod";

/**
 * Pure staff-management contract (M4-T010). Shared by the settings page
 * forms and the server actions so the client mirrors exactly what the
 * server enforces. No I/O, no server imports — unit-testable without mocks.
 */

/**
 * The roles an owner can hand out through an invitation. `owner` transfers
 * are out of scope (one owner per club is enforced by the partial unique
 * index on profiles), and `superadmin` is never client-writable — so the
 * invitation role enum is exactly the two non-owner staff roles.
 */
export const INVITABLE_ROLES = ["head_pro", "event_manager"] as const;

export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const ROLE_LABELS: Record<InvitableRole | "owner" | "superadmin", string> = {
  owner: "Owner",
  head_pro: "Head pro",
  event_manager: "Event manager",
  superadmin: "Super admin",
};

/** Staff invitations expire after exactly 7 days (server-enforced). */
export const INVITATION_EXPIRY_DAYS = 7;

/** The Club plan's staff seat limit, counting the owner. */
export const CLUB_PLAN_STAFF_LIMIT = 3;

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

/** The payload accepted by the invite server action. */
export const inviteStaffSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter the staff member's email address.")
    .max(254, "Email addresses are 254 characters or fewer.")
    .email("Enter a valid email address."),
  role: z.enum(INVITABLE_ROLES, "Choose a role for this invitation."),
});

export type InviteStaffInput = z.input<typeof inviteStaffSchema>;
export type InviteStaff = z.output<typeof inviteStaffSchema>;

export type StaffActionState = {
  readonly error?: string;
  readonly fields?: Record<string, string>;
  readonly saved?: boolean;
  readonly message?: string;
};

export type ZodIssue = {
  path: (string | number | symbol)[];
  message: string;
};

export function fieldErrors(
  issues: readonly ZodIssue[],
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !fields[key]) {
      fields[key] = issue.message;
    }
  }
  return fields;
}

// ─── Plan seat arithmetic (pure) ──────────────────────────────────────────────

export type SeatCounts = {
  /** Linked staff profiles (the owner counts as one seat). */
  readonly linked: number;
  /** Pending, un-expired invitations that will each claim a seat on accept. */
  readonly pending: number;
};

export type PlanName = "free" | "pilot" | "pro";

/**
 * The Founding plan marker. The Phase 1 `clubs.plan` check constraint admits
 * only `free | pilot | pro`, and the schema is frozen for this milestone, so
 * Founding is stored as `plan = 'pro'` with `billing_status = 'active'` —
 * the Founding assignment itself is audit-logged (the audit row is the
 * record of intent, exactly like the impersonation rows).
 */
export const FOUNDING_PLAN_MARKER: PlanName = "pro";

export type SeatDecision =
  | { readonly ok: true; readonly remaining: number }
  | {
      readonly ok: false;
      readonly reason: "plan_limit";
      readonly limit: number;
      readonly current: number;
    };

/**
 * Decides whether one more staff seat may be granted. The Club plan allows
 * exactly `CLUB_PLAN_STAFF_LIMIT` seats (owner included); a Founding club
 * (stored as `plan = 'pro'`) is unlimited. A pending invitation counts
 * against the limit the moment it is created — otherwise a club could
 * invite a dozen staff and have every link accepted past the cap.
 */
export function checkSeatAvailability(
  plan: PlanName,
  counts: SeatCounts,
): SeatDecision {
  if (plan === FOUNDING_PLAN_MARKER) {
    return { ok: true, remaining: Number.POSITIVE_INFINITY };
  }

  const limit = CLUB_PLAN_STAFF_LIMIT;
  const current = counts.linked + counts.pending;
  if (current >= limit) {
    return { ok: false, reason: "plan_limit", limit, current };
  }
  return { ok: true, remaining: limit - current };
}

export const PLAN_LIMIT_ERROR = `Your plan includes ${CLUB_PLAN_STAFF_LIMIT} staff seats (owner included). Remove a staff member or revoke a pending invitation to invite more.`;

// ─── Expiry arithmetic (pure) ────────────────────────────────────────────────

export type ExpiryDecision =
  | {
      readonly usable: true;
    }
  | {
      readonly usable: false;
      readonly reason: "revoked" | "accepted" | "expired";
    };

/**
 * Whether an invitation row may still be accepted. `now` is injectable so
 * tests don't depend on the wall clock; the check runs server-side again at
 * accept time (the DB row is the source of truth, never the link).
 */
export function invitationUsable(
  invitation: {
    readonly status: InvitationStatus;
    readonly expiresAt: string | Date;
  },
  now: Date,
): ExpiryDecision {
  if (invitation.status === "revoked") return { usable: false, reason: "revoked" };
  if (invitation.status === "accepted") return { usable: false, reason: "accepted" };

  const expires =
    typeof invitation.expiresAt === "string"
      ? new Date(invitation.expiresAt)
      : invitation.expiresAt;
  if (Number.isNaN(expires.getTime())) return { usable: false, reason: "expired" };

  // The window is half-open [created, expires): at exactly expiresAt the
  // link is dead, so a 7-day-old invitation fails its own expiry check.
  return expires.getTime() > now.getTime()
    ? { usable: true }
    : { usable: false, reason: "expired" };
}

/** The `expires_at` timestamp for a freshly created invitation. */
export function invitationExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * The invitation accept path. `clubSlug` scopes the link so a token from one
 * club can never be replayed against another — plus the token is unique
 * per row, so the accept route resolves both.
 */
export function invitationAcceptPath(clubSlug: string, token: string): string {
  return `/staff/accept?club=${encodeURIComponent(clubSlug)}&token=${encodeURIComponent(token)}`;
}
