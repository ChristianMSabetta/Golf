import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/auth/authorization";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ClubActions } from "@/components/admin/superadmin/club-actions";

export const metadata: Metadata = {
  title: "Super admin",
};

// Session-dependent: never prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * Super-admin surface (M4-T010): every club with its plan, billing status,
 * and staff — plus impersonation, trial extension, and Founding plan
 * assignment. Gated on `profiles.is_superadmin` server-side (never a
 * client claim); non-superadmins never render this page, and every server
 * action re-checks the flag again before touching anything.
 *
 * While impersonating, the superadmin sees the target's admin app instead —
 * this page is only reachable in the superadmin's own session.
 */
export default async function SuperadminPage() {
  const staff = await getStaff();
  if (!staff) {
    redirect("/sign-in");
  }
  if (!staff.isSuperadmin) {
    redirect("/admin");
  }

  const client = getServerSupabase();

  const { data: clubs, error } = await client
    .from("clubs")
    .select("id, name, slug, plan, billing_status, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load clubs: ${error.message}`);
  }

  const clubStaff = await Promise.all(
    (clubs ?? []).map(async (club) => {
      const { data: profiles } = await client
        .from("profiles")
        .select("id, full_name, email, role")
        .eq("club_id", club.id)
        .order("created_at", { ascending: true });

      return {
        clubId: club.id,
        clubName: club.name,
        plan: club.plan,
        billingStatus: club.billing_status,
        staff: Object.freeze(
          (profiles ?? []).map((profile) =>
            Object.freeze({
              id: profile.id,
              fullName: profile.full_name,
              email: profile.email,
              role: profile.role,
            }),
          ),
        ),
      };
    }),
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Super admin
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All clubs, plans, and staff. Every impersonation, trial extension,
          and Founding plan assignment is written to the audit log.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Clubs ({clubStaff.length})</CardTitle>
          <CardDescription>
            Impersonate a club&apos;s staff, extend a trial, or assign the
            Founding plan. The Club plan allows 3 staff seats (owner
            included); Founding clubs have no seat limit.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {clubStaff.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No clubs exist yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {clubStaff.map((club) => (
                <li
                  key={club.clubId}
                  className="rounded-lg border border-border"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                    <p className="font-medium text-foreground">
                      {club.clubName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      /{club.clubId.slice(0, 8)}…
                    </p>
                  </div>
                  <div className="p-4">
                    <ClubActions club={club} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
