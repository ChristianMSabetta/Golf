import "server-only";
import { getServerSupabase } from "@/lib/supabase/server";
import { newGroupToken } from "@/lib/events/publish";
import { brand } from "@/lib/brand";
import {
  invitationExpiry,
  invitationAcceptPath,
  invitationUsable,
  type InvitationStatus,
  type InvitableRole,
} from "./schema";

/**
 * `staff_invitations` data access (M4-T010). Reads AND writes run through
 * the service-role client: an invitee following a link is not club staff
 * yet, so the RLS policies would refuse the token lookup exactly when the
 * accept flow needs it — the invitation token itself is the credential,
 * and every caller (the settings page, the actions, the accept route) has
 * already resolved its club server-side. Writes carry the club check in
 * every `.eq("club_id", …)` filter, the same trusted-server pattern as
 * first-run provisioning.
 */

export type StaffRole =
  | "owner"
  | "head_pro"
  | "event_manager"
  | "superadmin";

export type StaffMemberRow = {
  id: string;
  full_name: string;
  email: string;
  role: StaffRole;
  is_superadmin: boolean;
};

export type StaffMemberView = {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly role: StaffRole;
  readonly isSuperadmin: boolean;
};

export type InvitationRow = {
  id: string;
  club_id: string;
  email: string;
  role: InvitableRole;
  token: string;
  status: InvitationStatus;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

const STAFF_COLUMNS = "id, full_name, email, role, is_superadmin";
const INVITATION_COLUMNS =
  "id, club_id, email, role, token, status, expires_at, accepted_at, created_at";

function toStaffMember(row: StaffMemberRow): StaffMemberView {
  return Object.freeze({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    isSuperadmin: row.is_superadmin,
  });
}

/** The club's linked staff (owner first, then by creation). */
export async function listStaff(
  clubId: string,
): Promise<readonly StaffMemberView[]> {
  const client = getServerSupabase();
  const { data, error } = await client
    .from("profiles")
    .select(STAFF_COLUMNS)
    .eq("club_id", clubId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load staff: ${error.message}`);
  }
  return (data ?? []).map(toStaffMember);
}

/** The club's non-revoked invitations, newest first. */
export async function listInvitations(
  clubId: string,
): Promise<readonly InvitationRow[]> {
  const client = getServerSupabase();
  const { data, error } = await client
    .from("staff_invitations")
    .select(INVITATION_COLUMNS)
    .eq("club_id", clubId)
    .neq("status", "revoked")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load invitations: ${error.message}`);
  }
  return Object.freeze(data ?? []);
}

export type SeatCountsInput = {
  readonly linked: number;
  readonly pending: number;
};

/**
 * Counts the club's occupied staff seats: linked profiles plus usable
 * pending invitations. Expired and revoked invitations stop counting the
 * moment they become unusable, so their seats free up immediately.
 */
export async function countStaffSeats(
  clubId: string,
  now: Date = new Date(),
): Promise<SeatCountsInput> {
  const [staff, invitations] = await Promise.all([
    listStaff(clubId),
    listInvitations(clubId),
  ]);

  const pending = invitations.filter(
    (invitation) =>
      invitation.status === "pending" &&
      invitationUsable(
        { status: invitation.status, expiresAt: invitation.expires_at },
        now,
      ).usable,
  ).length;

  return { linked: staff.length, pending };
}

export type CreateInvitationInput = {
  readonly clubId: string;
  readonly email: string;
  readonly role: InvitableRole;
  readonly invitedByProfileId: string;
  readonly clubSlug: string;
};

export type CreateInvitationResult = {
  readonly invitation: InvitationRow;
  readonly acceptUrl: string;
};

function absoluteAcceptUrl(clubSlug: string, token: string): string {
  return `https://${brand.domain}${invitationAcceptPath(clubSlug, token)}`;
}

/**
 * Creates (or re-issues) a staff invitation. The `(club_id, email)` unique
 * constraint allows exactly one invitation per email per club, so the
 * upsert re-invites in place: a fresh 32-char crypto-random token (the same
 * generator the group tokens use, backed by `node:crypto`), a fresh 7-day
 * window, and the status reset to pending. The token column updates with
 * the upsert, so a revoked-then-reinvited member can never receive the old
 * token back.
 */
export async function createInvitation(
  input: CreateInvitationInput,
  now: Date = new Date(),
): Promise<CreateInvitationResult> {
  const client = getServerSupabase();
  const token = newGroupToken(cryptoByteSource());
  const expiresAt = invitationExpiry(now).toISOString();

  const { data, error } = await client
    .from("staff_invitations")
    .upsert(
      {
        club_id: input.clubId,
        email: input.email,
        role: input.role,
        token,
        invited_by: input.invitedByProfileId,
        status: "pending",
        expires_at: expiresAt,
        accepted_at: null,
        created_at: now.toISOString(),
      },
      { onConflict: "club_id,email" },
    )
    .select(INVITATION_COLUMNS)
    .single<InvitationRow>();

  if (error) {
    throw new Error(`Failed to create invitation: ${error.message}`);
  }

  return {
    invitation: data,
    acceptUrl: absoluteAcceptUrl(input.clubSlug, data.token),
  };
}

/** Revokes a pending invitation (idempotent for already-revoked rows). */
export async function revokeInvitation(
  clubId: string,
  invitationId: string,
): Promise<boolean> {
  const client = getServerSupabase();
  const { data, error } = await client
    .from("staff_invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .eq("club_id", clubId)
    .in("status", ["pending", "expired"])
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new Error(`Failed to revoke invitation: ${error.message}`);
  }
  return data !== null;
}

export type AcceptInvitationInput = {
  readonly clubSlug: string;
  readonly token: string;
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
};

export type AcceptInvitationResult =
  | { readonly ok: true; readonly clubId: string; readonly role: InvitableRole }
  | {
      readonly ok: false;
      readonly reason: "not_found" | "email_mismatch" | "unusable";
    };

/**
 * Accepts an invitation for a signed-in auth user. The expiry/revocation
 * check runs **server-side** here — an expired link is rejected even if it
 * renders — and the accept is idempotent: re-clicking a used link after
 * signing in returns the already-accepted result instead of an error.
 *
 * The club is resolved from the invitation row (never the client): the
 * token is the credential.
 */
export async function acceptInvitation(
  input: AcceptInvitationInput,
  now: Date = new Date(),
): Promise<AcceptInvitationResult> {
  const client = getServerSupabase();

  const { data: invitation, error } = await client
    .from("staff_invitations")
    .select(INVITATION_COLUMNS)
    .eq("token", input.token)
    .maybeSingle<InvitationRow>();

  if (error) {
    throw new Error(`Failed to load invitation: ${error.message}`);
  }
  if (!invitation) return { ok: false, reason: "not_found" };

  const { data: club } = await client
    .from("clubs")
    .select("id, slug")
    .eq("id", invitation.club_id)
    .maybeSingle<{ id: string; slug: string }>();

  if (!club || club.slug !== input.clubSlug) {
    return { ok: false, reason: "not_found" };
  }

  const usable = invitationUsable(
    { status: invitation.status, expiresAt: invitation.expires_at },
    now,
  );
  if (invitation.status === "accepted") {
    // Idempotent accept: the row already links the email to the club.
    return { ok: true, clubId: invitation.club_id, role: invitation.role };
  }
  if (!usable.usable) {
    // Mark expired rows so the seat frees up immediately.
    if (usable.reason === "expired") {
      await client
        .from("staff_invitations")
        .update({ status: "expired" })
        .eq("id", invitation.id);
    }
    return { ok: false, reason: "unusable" };
  }

  if (invitation.email.toLowerCase() !== input.email.toLowerCase()) {
    return { ok: false, reason: "email_mismatch" };
  }

  const { data: profile } = await client
    .from("profiles")
    .select("id")
    .eq("user_id", input.userId)
    .maybeSingle<{ id: string }>();

  if (profile) {
    const { error: linkError } = await client
      .from("profiles")
      .update({
        club_id: invitation.club_id,
        role: invitation.role,
        full_name: input.fullName,
        email: input.email,
      })
      .eq("id", profile.id);
    if (linkError) {
      throw new Error(`Failed to link staff profile: ${linkError.message}`);
    }
  } else {
    const { error: insertError } = await client
      .from("profiles")
      .insert({
        user_id: input.userId,
        club_id: invitation.club_id,
        full_name: input.fullName,
        email: input.email,
        role: invitation.role,
      });
    if (insertError) {
      throw new Error(`Failed to create staff profile: ${insertError.message}`);
    }
  }

  const { error: acceptError } = await client
    .from("staff_invitations")
    .update({
      status: "accepted",
      accepted_at: now.toISOString(),
    })
    .eq("id", invitation.id);
  if (acceptError) {
    throw new Error(`Failed to mark invitation accepted: ${acceptError.message}`);
  }

  return { ok: true, clubId: invitation.club_id, role: invitation.role };
}

/** A byte source backed by `node:crypto` — the only randomness source. */
function cryptoByteSource(): () => number {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  let index = 0;
  return () => {
    if (index >= bytes.length) {
      const fresh = new Uint8Array(64);
      crypto.getRandomValues(fresh);
      return fresh[index++ % fresh.length] ?? 0;
    }
    return bytes[index++] ?? 0;
  };
}
