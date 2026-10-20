import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
};

type SignInPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const hasReason = Boolean(firstParam(params.reason));
  const forbidden = Boolean(firstParam(params.forbidden));

  return (
    <main className="w-full max-w-md">
      <h1 className="font-heading text-2xl font-semibold text-foreground">
        Staff sign-in
      </h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        {forbidden
          ? "Your account doesn't have access to that page."
          : hasReason
            ? "Please sign in to continue."
            : "Sign in with a magic link or your password."}
      </p>
      <SignInForm />
    </main>
  );
}
