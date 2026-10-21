"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/auth/authorization";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  assignFoundingPlan,
  extendClubTrial,
  startImpersonation,
  stopImpersonation,
} from "./server";

/**
 * Super-admin server actions (M4-T010): impersonate/stop, extend trial,
 * assign Founding plan. Every action re-checks `is_superadmin`
 * server-side before touching anything (the flag comes from the database
 * profile row, never a client claim), and every privileged mutation is
 * audit-logged inside the server module.
 */

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const FORBIDDEN_ERROR = "Super admin access is required for this action.";
const NOT_FOUND_ERROR = "That club does not exist.";

/** A minimal action state shared by the club-level superadmin actions. */
export type SuperadminActionState = {
  readonly error?: string;
  readonly saved?: boolean;
  readonly message?: string;
};

async function requireSuperadminActor() {
  const staff = await getStaff();
  if (!staff) return null;
  if (!staff.isSuperadmin) return null;
  return staff;
}

/**
 * Starts impersonating a staff member. The audit row is written before the
 * cookie is set (inside startImpersonation), so no impersonated request can
 * ever run without its impersonation being logged.
 */
export async function impersonateStaffMember(
  _prev: SuperadminActionState,
  formData: FormData,
): Promise<SuperadminActionState> {
  if (!(await requireSuperadminActor())) {
    return { error: FORBIDDEN_ERROR };
  }

  const targetProfileId = String(formData.get("targetProfileId") ?? "");
  if (targetProfileId === "") return { error: GENERIC_ERROR };

  try {
    await startImpersonation(targetProfileId);
  } catch (error) {
    console.error(
      `[superadmin] impersonation failed: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/admin", "layout");
  redirect("/admin");
}

/** Stops the active impersonation and returns to the superadmin surface. */
export async function stopImpersonating(): Promise<void> {
  // The cookie (not `getStaff`, which resolves to the impersonated target
  // while active) identifies the actor; stopImpersonation re-validates the
  // actor's `is_superadmin` flag from the database before writing the audit
  // row.
  await stopImpersonation();
  revalidatePath("/admin", "layout");
  redirect("/admin/superadmin");
}

/** Extends a club's trial (superadmin only, audit-logged). */
export async function extendTrial(
  _prev: SuperadminActionState,
  formData: FormData,
): Promise<SuperadminActionState> {
  if (!(await requireSuperadminActor())) {
    return { error: FORBIDDEN_ERROR };
  }

  const clubId = String(formData.get("clubId") ?? "");
  const daysRaw = String(formData.get("days") ?? "30");
  const days = Number(daysRaw);

  if (clubId === "" || !Number.isFinite(days) || days <= 0) {
    return { error: "Enter a positive number of trial days." };
  }

  try {
    await extendClubTrial(clubId, days);
  } catch (error) {
    console.error(`[superadmin] trial extension failed: ${String(error)}`);
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/admin/superadmin");
  return {
    saved: true,
    message: `Trial extended by ${days} days.`,
  };
}

/** Assigns the Founding plan to a club (superadmin only, audit-logged). */
export async function grantFoundingPlan(
  _prev: SuperadminActionState,
  formData: FormData,
): Promise<SuperadminActionState> {
  if (!(await requireSuperadminActor())) {
    return { error: FORBIDDEN_ERROR };
  }

  const clubId = String(formData.get("clubId") ?? "");
  if (clubId === "") return { error: GENERIC_ERROR };

  const client = getServerSupabase();
  const { data: club } = await client
    .from("clubs")
    .select("id, plan, billing_status")
    .eq("id", clubId)
    .maybeSingle<{
      id: string;
      plan: "free" | "pilot" | "pro";
      billing_status: string;
    }>();

  if (!club) return { error: NOT_FOUND_ERROR };

  if (club.plan === "pro" && club.billing_status === "active") {
    return {
      saved: true,
      message: "This club is already on the Founding plan.",
    };
  }

  try {
    await assignFoundingPlan(clubId);
  } catch (error) {
    console.error(`[superadmin] Founding assignment failed: ${String(error)}`);
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/admin/superadmin");
  return {
    saved: true,
    message: "Founding plan assigned — staff seats are now unlimited.",
  };
}
