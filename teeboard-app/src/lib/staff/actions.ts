"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getStaff } from "@/lib/auth/authorization";
import {
  PLAN_LIMIT_ERROR,
  checkSeatAvailability,
  fieldErrors,
  inviteStaffSchema,
  type StaffActionState,
} from "./schema";
import {
  countStaffSeats,
  createInvitation,
  revokeInvitation,
} from "./server";
import { sendEmail } from "@/lib/email/resend-adapter";
import { brand } from "@/lib/brand";

/**
 * Staff-management server actions (M4-T010): invite and revoke. Authorization
 * runs server-side before validation; only the owner and head pro may manage
 * staff (event managers get a read-only staff list). Writes go through the
 * service-role client with the club check enforced in every `.eq("club_id", …)`
 * filter — the same trusted-server pattern as the events actions.
 *
 * The Club plan's 3-seat limit is enforced here (server-side), not in the UI:
 * a tampered form can never add a 4th staff member.
 */

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const VALIDATION_ERROR = "Please fix the highlighted fields.";
const NO_CLUB_ERROR =
  "No club is linked to your account yet — ask your club owner to invite you.";
const FORBIDDEN_ERROR =
  "Your role doesn't allow managing staff. Ask the club owner.";

const INVITE_ALLOWED_ROLES = ["owner", "head_pro"] as const;

type AuthedOwner = {
  readonly clubId: string;
  readonly clubSlug: string;
  readonly profileId: string;
  readonly inviterName: string;
};

async function authorizeClubOwner(): Promise<AuthedOwner | null> {
  const staff = await getStaff();
  if (!staff || staff.clubId === null) return null;
  if (
    !staff.isSuperadmin &&
    !INVITE_ALLOWED_ROLES.includes(staff.role as (typeof INVITE_ALLOWED_ROLES)[number])
  ) {
    return null;
  }

  const client = getServerSupabase();
  const { data: club, error } = await client
    .from("clubs")
    .select("id, slug")
    .eq("id", staff.clubId)
    .maybeSingle<{ id: string; slug: string }>();

  if (error || !club) return null;
  return {
    clubId: club.id,
    clubSlug: club.slug,
    profileId: staff.profileId,
    inviterName: staff.fullName,
  };
}

async function unauthorizedState(): Promise<StaffActionState> {
  const staff = await getStaff();
  if (!staff) return { error: "Please sign in to continue." };
  if (staff.clubId === null) return { error: NO_CLUB_ERROR };
  return { error: FORBIDDEN_ERROR };
}

function invitationEmail(
  clubName: string,
  inviterName: string,
  acceptUrl: string,
): string {
  return [
    `You've been invited to join ${clubName} on ${brand.name}.`,
    "",
    `${inviterName} invited you as club staff. Follow this link within 7 days to accept:`,
    acceptUrl,
    "",
    `The link expires after 7 days and can be revoked by the club at any time.`,
    "",
    `— ${brand.name}`,
  ].join("\n");
}

/**
 * Creates a staff invitation. Enforces the Club plan seat limit
 * server-side (linked staff + usable pending invitations against the plan
 * cap) before writing, then emails the accept link through Resend — the
 * send is best-effort (logged on failure, never blocks the invitation).
 */
export async function inviteStaffMember(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const auth = await authorizeClubOwner();
  if (!auth) return unauthorizedState();

  const parsed = inviteStaffSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { error: VALIDATION_ERROR, fields: fieldErrors(parsed.error.issues) };
  }

  const client = getServerSupabase();

  const { data: club, error: clubError } = await client
    .from("clubs")
    .select("name, plan")
    .eq("id", auth.clubId)
    .maybeSingle<{ name: string; plan: "free" | "pilot" | "pro" }>();

  if (clubError || !club) return { error: GENERIC_ERROR };

  const seats = await countStaffSeats(auth.clubId);
  const decision = checkSeatAvailability(club.plan, seats);
  if (!decision.ok) {
    return { fields: {}, error: PLAN_LIMIT_ERROR };
  }

  // A linked staff member with this email needs no invitation.
  const email = parsed.data.email.toLowerCase();
  const { data: linked } = await client
    .from("profiles")
    .select("id")
    .eq("club_id", auth.clubId)
    .ilike("email", email)
    .maybeSingle<{ id: string }>();

  if (linked) {
    return {
      fields: { email: "That email is already on your staff." },
      error: VALIDATION_ERROR,
    };
  }

  try {
    const result = await createInvitation({
      clubId: auth.clubId,
      email: parsed.data.email,
      role: parsed.data.role,
      invitedByProfileId: auth.profileId,
      clubSlug: auth.clubSlug,
    });

    try {
      await sendEmail({
        to: parsed.data.email,
        subject: `You're invited to join ${club.name} on ${brand.name}`,
        text: invitationEmail(club.name, auth.inviterName, result.acceptUrl),
      });
    } catch (emailError) {
      console.error(
        `[staff] invitation email failed for club ${auth.clubId}: ${
          emailError instanceof Error ? emailError.message : String(emailError)
        }`,
      );
    }

    revalidatePath("/admin/settings");

    return {
      saved: true,
      message:
        "Invitation sent — the link expires in 7 days and can be revoked any time.",
    };
  } catch (error) {
    console.error(
      `[staff] invitation failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}

/**
 * Revokes a pending invitation server-side. Revoked links are dead on
 * their next accept attempt (acceptInvitation re-checks status).
 */
export async function revokeStaffInvitation(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const auth = await authorizeClubOwner();
  if (!auth) return unauthorizedState();

  const invitationId = String(formData.get("invitationId") ?? "");
  if (invitationId === "") return { error: GENERIC_ERROR };

  try {
    const revoked = await revokeInvitation(auth.clubId, invitationId);
    revalidatePath("/admin/settings");
    return revoked
      ? { saved: true, message: "Invitation revoked." }
      : { saved: true, message: "That invitation was already used or revoked." };
  } catch (error) {
    console.error(
      `[staff] revoke failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}
