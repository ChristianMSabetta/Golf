"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  requestMagicLink,
  signInWithPassword,
  type AuthActionState,
} from "@/lib/auth/actions";
import { MAGIC_LINK_SENT_MESSAGE } from "@/lib/auth/schema";

const EMPTY_FORM = { email: "", password: "" };

export function SignInForm() {
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [form, setForm] = useState(EMPTY_FORM);

  const [passwordState, passwordAction, passwordPending] = useActionState(
    signInWithPassword,
    {} satisfies AuthActionState,
  );
  const [magicState, magicAction, magicPending] = useActionState(
    requestMagicLink,
    {} satisfies AuthActionState,
  );

  const state = mode === "password" ? passwordState : magicState;
  const pending = mode === "password" ? passwordPending : magicPending;

  const errors = state.fields ?? {};
  const magicSent = mode === "magic" && !magicState.error && !pending && magicState.sent === true;

  function updateField(field: keyof typeof EMPTY_FORM, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex rounded-lg border border-border bg-muted/40 p-1 text-sm">
        <button
          type="button"
          aria-pressed={mode === "password"}
          onClick={() => setMode("password")}
          className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
            mode === "password"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Password
        </button>
        <button
          type="button"
          aria-pressed={mode === "magic"}
          onClick={() => setMode("magic")}
          className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
            mode === "magic"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Magic link
        </button>
      </div>

      {magicSent && mode === "magic" ? (
        <p
          role="status"
          className="rounded-lg border border-brand/30 bg-card px-4 py-3 text-sm text-foreground"
        >
          {MAGIC_LINK_SENT_MESSAGE}
        </p>
      ) : null}

      <form
        action={mode === "password" ? passwordAction : magicAction}
        noValidate
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="sign-in-email">Email address</Label>
          <Input
            id="sign-in-email"
            name="email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            aria-invalid={Boolean(errors.email)}
          />
          {errors.email ? (
            <p className="text-sm text-destructive">{errors.email}</p>
          ) : null}
        </div>

        {mode === "password" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="sign-in-password">Password</Label>
            <Input
              id="sign-in-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(event) => updateField("password", event.target.value)}
              aria-invalid={Boolean(errors.password)}
            />
            {errors.password ? (
              <p className="text-sm text-destructive">{errors.password}</p>
            ) : null}
          </div>
        ) : null}

        {state.error ? (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={pending}>
          {pending
            ? "Working…"
            : mode === "password"
              ? "Sign in"
              : "Send magic link"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link
          href="/sign-up"
          className="font-medium text-brand underline-offset-4 hover:underline"
        >
          Create your club
        </Link>
      </p>
    </div>
  );
}
