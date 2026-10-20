import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = {
  title: "Create your club",
};

export default function SignUpPage() {
  return (
    <main className="w-full max-w-md">
      <h1 className="font-heading text-2xl font-semibold text-foreground">
        Create your club
      </h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        Sign up as the club owner — you&apos;ll manage events, players, and
        live leaderboards.
      </p>
      <SignUpForm />
    </main>
  );
}
