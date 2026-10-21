import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth/authorization";
import { getStaffClub } from "@/lib/club/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { ClubProfileForm } from "@/components/admin/club-profile-form";
import { StaffManager } from "@/components/admin/staff/staff-manager";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { checkSeatAvailability, type PlanName } from "@/lib/staff/schema";
import { listInvitations, listStaff } from "@/lib/staff/server";

export const metadata: Metadata = {
  title: "Club settings",
};

// Session-dependent: never prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * Club settings (M4-T010): the club profile (name, logo, primary color,
 * timezone — the single source of club branding consumed by the admin app
 * today and leaderboards/PDFs in later phases) plus staff management
 * (invitations with roles, the Club plan seat limit, revocation).
 *
 * Server-side protected: unauthenticated visitors are redirected by
 * requireStaff; only owners and head pros may edit the profile or manage
 * staff, and the server actions re-check the same gates on every write.
 */
export default async function ClubSettingsPage() {
  const staff = await requireStaff();

  const context = await getStaffClub();
  if (!context) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Club settings
        </h1>
        <p className="text-sm text-muted-foreground">
          {staff.isSuperadmin
            ? "Super admin tools live under Super admin in the sidebar."
            : "No club is linked to your account yet — ask your club owner to invite you."}
        </p>
      </div>
    );
  }

  const { staff: clubStaff, club } = context;
  const canManage =
    clubStaff.isSuperadmin ||
    clubStaff.role === "owner" ||
    clubStaff.role === "head_pro";

  // Staff + invitations load through the service-role client after the
  // club-scoped profile check above; the counts feed the seat meter that
  // mirrors the same server-side limit check the invite action enforces.
  const [staffMembers, invitations, clubResult] = await Promise.all([
    listStaff(club.id),
    listInvitations(club.id),
    getServerSupabase()
      .from("clubs")
      .select("plan")
      .eq("id", club.id)
      .maybeSingle<{ plan: PlanName }>(),
  ]);

  if (clubResult.error) {
    throw new Error(
      `Failed to load club plan: ${clubResult.error.message}`,
    );
  }

  const plan = clubResult.data?.plan ?? "free";
  const seats = {
    linked: staffMembers.length,
    pending: invitations.filter(
      (invitation) => invitation.status === "pending",
    ).length,
  };
  const decision = checkSeatAvailability(plan, seats);
  const seatLimit =
    decision.ok && Number.isFinite(decision.remaining)
      ? seats.linked + seats.pending + decision.remaining
      : null;
  const seatsUsed = seats.linked + seats.pending;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Club settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Branding, timezone, and staff for {club.name}. These settings flow
          to your leaderboards, scorecards, and emails.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Club profile</CardTitle>
          <CardDescription>
            Name, logo, primary color, and timezone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canManage ? (
            <ClubProfileForm
              club={{
                name: club.name,
                logoUrl: club.logoUrl ?? "",
                primaryColor: club.primaryColor ?? "",
                timezone: club.brand.timezone,
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Only the club owner and head pro can edit club settings. Ask
              them if something needs to change.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Staff</CardTitle>
          <CardDescription>
            Invite staff by email with a role. Invitation links expire after
            7 days and can be revoked any time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StaffManager
            staff={staffMembers.map((member) => ({
              id: member.id,
              fullName: member.fullName,
              email: member.email,
              role: member.role,
            }))}
            invitations={invitations
              .filter((invitation) => invitation.status !== "revoked")
              .map((invitation) => ({
                id: invitation.id,
                email: invitation.email,
                role: invitation.role,
                status: invitation.status,
                expiresAt: invitation.expires_at,
              }))}
            seatLimit={seatLimit}
            seatsUsed={seatsUsed}
            canInvite={canManage}
          />
        </CardContent>
      </Card>
    </div>
  );
}
