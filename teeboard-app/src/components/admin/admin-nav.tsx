"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flag, LayoutDashboard, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

export type AdminNavItem = {
  readonly href: string;
  readonly label: string;
  readonly icon: "dashboard" | "courses" | "settings";
};

const ICONS = {
  dashboard: LayoutDashboard,
  courses: Flag,
  settings: Settings,
} as const;

/**
 * Admin sidebar navigation. `items` is computed server-side (in the layout)
 * from the signed-in staff member's role; the client component only renders
 * the active state from the current pathname.
 */
export function AdminNav({ items }: { items: readonly AdminNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin sections"
      className="flex flex-row gap-1 overflow-x-auto px-3 py-3 sm:flex-col sm:gap-1 sm:py-4"
    >
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active =
          item.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
