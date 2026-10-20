"use client";

import { useFormStatus } from "react-dom";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      disabled={pending}
      className="gap-2 text-sidebar-foreground/80 hover:text-sidebar-foreground"
    >
      <LogOut className="size-4" aria-hidden />
      Sign out
    </Button>
  );
}

/**
 * Signs the staff member out via the server action (the session cookies are
 * cleared server-side and the action redirects to /sign-in).
 */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <SubmitButton />
    </form>
  );
}
