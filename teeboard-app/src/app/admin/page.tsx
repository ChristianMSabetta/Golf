import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { requireStaff } from "@/lib/auth/authorization";
import { signOut } from "@/lib/auth/actions";

export const metadata: Metadata = {
  title: "Dashboard",
};

// Session-dependent: never prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * Server-side protected admin entry point: unauthenticated visitors are
 * redirected to sign-in by requireStaff; the full admin skeleton
 * (navigation, club settings) arrives with M2-T004.
 */
export default async function AdminPage() {
  const staff = await requireStaff();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Welcome back, {staff.fullName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as {staff.email} · {staff.isSuperadmin ? "Super admin" : staff.role}
          </p>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </div>
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Your club dashboard is being prepared. Event management, players, and
        live leaderboards arrive next.
      </div>
    </main>
  );
}
