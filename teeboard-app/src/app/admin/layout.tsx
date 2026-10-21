import type { ReactNode } from "react";
import { requireStaff } from "@/lib/auth/authorization";
import { getStaffClub } from "@/lib/club/server";
import { AdminNav, type AdminNavItem } from "@/components/admin/admin-nav";
import { AdminTopBar } from "@/components/admin/admin-topbar";

/**
 * Admin app shell. Every admin route renders through this layout, and the
 * layout authenticates server-side first: an unauthenticated visitor is
 * redirected to /sign-in before any admin content streams.
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

  if (context) {
    items.push({
      href: "/admin/courses",
      label: "Courses",
      icon: "courses",
    });
    items.push({
      href: "/admin/settings",
      label: "Club settings",
      icon: "settings",
    });
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <AdminTopBar clubBrand={context?.club.brand ?? null} email={staff.email} />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col sm:flex-row">
        <aside className="shrink-0 border-b border-border bg-sidebar sm:w-56 sm:border-r sm:border-b-0">
          <AdminNav items={items} />
        </aside>
        <main className="min-w-0 flex-1 px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
