import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { StaffRole } from "@/lib/supabase/server";
import { getStaffAuthContext } from "@/lib/supabase/server";

export type AuthorizationError = {
  readonly status: 401 | 403;
  readonly reason: string;
};

export type AuthenticatedStaff = {
  readonly userId: string;
  readonly profileId: string;
  readonly clubId: string | null;
  readonly fullName: string;
  readonly email: string;
  readonly role: StaffRole;
  readonly isSuperadmin: boolean;
};

const UNAUTHENTICATED_REASON = "Sign in to continue.";

/**
 * Resolves the signed-in staff member for the current request, or null when
 * nobody is signed in. This is the single server-side source of truth for
 * the five-role model:
 *
 * - owner / head_pro / event_manager — Supabase Auth users with a profiles row
 * - superadmin — the profiles.is_superadmin flag, never a client claim
 * - scorer — PIN-only, no Supabase Auth user (src/lib/scorer/pin.ts)
 * - player — group-token-only, no account at all (submit_score RPC)
 *
 * Cached per request: the admin layout, pages, and server actions all call
 * this during one render, and the profile row is fetched exactly once.
 */
export const getStaff = cache(
  async (): Promise<AuthenticatedStaff | null> => {
    const { user, profile } = await getStaffAuthContext();
    if (!user || !profile) return null;

    return Object.freeze({
      userId: user.id,
      profileId: profile.id,
      clubId: profile.club_id,
      fullName: profile.full_name,
      email: profile.email,
      role: profile.role,
      isSuperadmin: profile.is_superadmin,
    });
  },
);

export async function requireStaff(): Promise<AuthenticatedStaff> {
  const staff = await getStaff();
  if (!staff) {
    redirect(`/sign-in?reason=${encodeURIComponent(UNAUTHENTICATED_REASON)}`);
  }
  return staff;
}

/**
 * Role gate for the admin surface. `roles` lists the staff roles allowed to
 * proceed; superadmins always pass. The role is read from the database
 * profile row server-side, never from the client.
 */
export async function requireStaffRole(
  roles: readonly StaffRole[],
): Promise<AuthenticatedStaff> {
  const staff = await getStaff();
  if (!staff) {
    redirect(`/sign-in?reason=${encodeURIComponent(UNAUTHENTICATED_REASON)}`);
  }

  const allowed =
    staff.isSuperadmin ||
    (staff.clubId !== null && roles.includes(staff.role));

  if (!allowed) {
    redirect("/sign-in?forbidden=1");
  }

  return staff;
}

/**
 * API-flavored variant of the role gate: instead of redirecting it returns a
 * typed error so route handlers can respond with 401/403. Checks the club
 * scope too, so a staff member can never act on another club's rows.
 */
export async function authorizeStaffForClub(
  clubId: string,
  roles?: readonly StaffRole[],
): Promise<
  { ok: true; staff: AuthenticatedStaff } | { ok: false; error: AuthorizationError }
> {
  const staff = await getStaff();
  if (!staff) {
    return {
      ok: false,
      error: { status: 401, reason: UNAUTHENTICATED_REASON },
    };
  }

  if (!staff.isSuperadmin) {
    if (staff.clubId !== clubId) {
      return {
        ok: false,
        error: {
          status: 403,
          reason: "You do not have access to this club.",
        },
      };
    }
    if (roles && !roles.includes(staff.role)) {
      return {
        ok: false,
        error: {
          status: 403,
          reason: "Your role does not allow this action.",
        },
      };
    }
  }

  return { ok: true, staff };
}

export async function requireSuperadmin(): Promise<AuthenticatedStaff> {
  const staff = await getStaff();
  if (!staff) {
    redirect(`/sign-in?reason=${encodeURIComponent(UNAUTHENTICATED_REASON)}`);
  }
  if (!staff.isSuperadmin) {
    redirect("/sign-in?forbidden=1");
  }
  return staff;
}
