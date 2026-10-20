import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth/authorization";
import { getStaffClub } from "@/lib/club/server";
import { ClubProfileForm } from "@/components/admin/club-profile-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Club settings",
};

// Session-dependent: never prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * Club profile settings. Server-side protected: unauthenticated visitors are
 * redirected to /sign-in by requireStaff. Only owners and head pros may
 * edit the club profile (event managers get a read-only summary), and the
 * update server action re-checks the same role gate so a tampered form
 * submission still cannot write.
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
            ? "Super admin tools arrive in a later phase."
            : "No club is linked to your account yet — ask your club owner to invite you."}
        </p>
      </div>
    );
  }

  const { staff: clubStaff, club } = context;
  const canEdit =
    clubStaff.isSuperadmin ||
    clubStaff.role === "owner" ||
    clubStaff.role === "head_pro";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Club settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Branding and timezone for {club.name}. These settings flow to your
          leaderboards, scorecards, and emails.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Club profile</CardTitle>
        </CardHeader>
        <CardContent>
          {canEdit ? (
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
    </div>
  );
}
