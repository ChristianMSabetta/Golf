import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/authorization";
import { getStaffClub } from "@/lib/club/server";
import { brand } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings } from "lucide-react";

export const metadata: Metadata = {
  title: "Dashboard",
};

// Session-dependent: never prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * Post-sign-in dashboard for club owners and staff. Everything renders from
 * the staff member's database profile and club row (server-side); no client
 * role claim is trusted anywhere on this page.
 */
export default async function AdminDashboardPage() {
  const staff = await requireStaff();
  const context = await getStaffClub();

  const roleLabel = staff.isSuperadmin ? "Super admin" : staff.role.replace(/_/g, " ");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Dashboard
        </p>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Welcome back, {staff.fullName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Signed in as {staff.email} · {roleLabel}
        </p>
      </div>

      {context ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{context.club.name}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
              <div>
                <p className="font-medium text-foreground">Timezone</p>
                <p className="numeric">{context.club.brand.timezone}</p>
              </div>
              <div>
                <p className="font-medium text-foreground">Contact email</p>
                <p>{context.club.contactEmail ?? "Not set"}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Get started</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm text-muted-foreground">
              <p className="leading-relaxed">
                Set up your club profile so leaderboards, scorecards, and
                emails carry your branding.
              </p>
              <div>
                <Button asChild size="lg" className="gap-2">
                  <Link href="/admin/settings">
                    <Settings className="size-4" aria-hidden />
                    Open club settings
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No club linked yet</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {staff.isSuperadmin
              ? "Super admin tools arrive in a later phase."
              : "Your account isn't linked to a club yet. Ask your club owner to send you a staff invitation."}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        {brand.name} support · {brand.domain}
      </p>
    </div>
  );
}
