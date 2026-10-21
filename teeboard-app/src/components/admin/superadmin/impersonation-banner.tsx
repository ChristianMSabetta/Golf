"use client";

import { EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { stopImpersonating } from "@/lib/superadmin/actions";

/**
 * The impersonation banner (M4-T010): renders while a superadmin is
 * impersonating club staff. Stop clears the cookie server-side (and audits
 * the impersonation end) — the banner is a sign-out from the target's view,
 * never a role change on either account.
 */
export function ImpersonationBanner({
  targetFullName,
  targetEmail,
}: {
  targetFullName: string;
  targetEmail: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-gold/40 bg-brand-gold/10 px-4 py-2 text-sm sm:px-6">
      <p className="flex items-center gap-2 text-foreground">
        <EyeOff className="size-4 text-brand-gold" aria-hidden />
        Impersonating{" "}
        <span className="font-medium">{targetFullName}</span>
        <span className="text-muted-foreground">({targetEmail})</span>
        <span className="text-xs text-muted-foreground">
          — every action is audit-logged.
        </span>
      </p>
      <form action={stopImpersonating}>
        <Button type="submit" variant="outline" size="sm">
          Stop impersonating
        </Button>
      </form>
    </div>
  );
}
