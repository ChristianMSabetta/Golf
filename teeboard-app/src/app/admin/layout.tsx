import type { ReactNode } from "react";
import { requireStaff } from "@/lib/auth/authorization";
import { getStaffClub } from "@/lib/club/server";
import { getActiveImpersonation } from "@/lib/superadmin/server";
import { AdminNav, type AdminNavItem } from "@/components/admin/admin-nav";
import { AdminTopBar } from "@/components/admin/admin-topbar";
import { ImpersonationBanner } from "@/components/admin/superadmin/impersonation-banner";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Admin app shell. Every admin route renders through this layout, and the
 * layout authenticates server-side first: an unauthenticated visitor is
 * redirected to /sign-in before any admin content streams.
 *
 * While a superadmin impersonates club staff (M4-T010), the banner shows
 * the target identity on every admin page — the impersonation cookie is
 * re-validated server-side on each request.
 */
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const staff = await requireStaff();
  const context = await getStaffClub();

  const items: AdminNavItem[] = [
    { href: "/admin", label: "Dashboard", icon: "dashboard" },
  ];

  if (context || staff.isSuperadmin) {
    items.push({
      href: "/admin/courses",
      label: "Courses",
      icon: "courses",
    });
    items.push({
      href: "/admin/events",
      label: "Events",
      icon: "events",
    });
    items.push({
      href: "/admin/players",
      label: "Players",
      icon: "players",
    });
  }

  if (context) {
    items.push({
      href: "/admin/settings",
      label: "Club settings",
      icon: "settings",
    });
  }

  if (staff.isSuperadmin) {
    items.push({
      href: "/admin/superadmin",
      label: "Super admin",
      icon: "settings",
    });
  }

  const impersonation = await getActiveImpersonation();
  let targetIdentity: { fullName: string; email: string } | null = null;
  if (impersonation) {
    const { data: target } = await getServerSupabase()
      .from("profiles")
      .select("full_name, email")
      .eq("id", impersonation.targetProfileId)
      .maybeSingle<{ full_name: string; email: string }>();
    targetIdentity = target
      ? { fullName: target.full_name, email: target.email }
      : null;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <AdminTopBar clubBrand={context?.club.brand ?? null} email={staff.email} />
      {impersonation && targetIdentity ? (
        <ImpersonationBanner
          targetFullName={targetIdentity.fullName}
          targetEmail={targetIdentity.email}
        />
      ) : null}
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col sm:flex-row">
        <aside className="shrink-0 border-b border-border bg-sidebar sm:w-56 sm:border-r sm:border-b-0">
          <AdminNav items={items} />
        </aside>
        <main className="min-w-0 flex-1 px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
