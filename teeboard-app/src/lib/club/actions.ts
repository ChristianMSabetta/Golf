"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getStaff } from "@/lib/auth/authorization";
import { clubProfileSchema } from "@/lib/club/schema";

export type ClubProfileActionState = {
  readonly error?: string;
  readonly fields?: Record<string, string>;
  readonly saved?: boolean;
};

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const VALIDATION_ERROR = "Please fix the highlighted fields.";
const NO_CLUB_ERROR =
  "No club is linked to your account yet — ask your club owner to invite you.";
const FORBIDDEN_ERROR =
  "Your role doesn't allow editing club settings. Ask the club owner.";

type ZodIssue = {
  path: (string | number | symbol)[];
  message: string;
};

function fieldErrors(issues: readonly ZodIssue[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !fields[key]) {
      fields[key] = issue.message;
    }
  }
  return fields;
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Persists club profile edits. Authorization is fully server-side and runs
 * before validation: unauthenticated callers, staff without a club, other
 * clubs' staff, and non-owner/head-pro roles are all blocked. The write
 * itself runs through the service-role client because clubs is read-only
 * under RLS — the tenant root is only ever written by trusted server code.
 */
export async function updateClubProfile(
  _prev: ClubProfileActionState,
  formData: FormData,
): Promise<ClubProfileActionState> {
  const staff = await getStaff();
  if (!staff) {
    return { fields: {}, error: "Please sign in to continue." };
  }

  // A superadmin without a club assignment has nothing to edit; a superadmin
  // WITH a club assignment may edit it like an owner.
  if (staff.clubId === null) {
    return { fields: {}, error: NO_CLUB_ERROR };
  }

  if (
    !staff.isSuperadmin &&
    staff.role !== "owner" &&
    staff.role !== "head_pro"
  ) {
    return { fields: {}, error: FORBIDDEN_ERROR };
  }

  const parsed = clubProfileSchema.safeParse({
    name: formData.get("name"),
    logoUrl: formData.get("logoUrl") ?? "",
    primaryColor: formData.get("primaryColor") ?? "",
    timezone: formData.get("timezone"),
  });

  if (!parsed.success) {
    return { error: VALIDATION_ERROR, fields: fieldErrors(parsed.error.issues) };
  }

  const client = getServerSupabase();

  const { error } = await client
    .from("clubs")
    .update({
      name: parsed.data.name,
      logo_url: emptyToNull(parsed.data.logoUrl),
      primary_color: emptyToNull(parsed.data.primaryColor),
      timezone: parsed.data.timezone,
      updated_at: new Date().toISOString(),
    })
    .eq("id", staff.clubId);

  if (error) {
    console.error(
      `[club] profile update failed for club ${staff.clubId}: ${error.message}`,
    );
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/admin", "layout");

  return { saved: true };
}
