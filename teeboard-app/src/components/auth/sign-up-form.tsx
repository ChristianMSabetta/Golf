"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpOwner, type AuthActionState } from "@/lib/auth/actions";

const EMPTY_FORM = {
  email: "",
  password: "",
  fullName: "",
  clubName: "",
  timezone: "America/New_York",
};

const TIMEZONE_OPTIONS = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;

export function SignUpForm() {
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);

  const [state, action, pending] = useActionState(
    signUpOwner,
    {} satisfies AuthActionState,
  );

  const errors = state.fields ?? {};

  function updateField(
    field: keyof typeof EMPTY_FORM,
    value: string,
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="sign-up-full-name">Full name</Label>
        <Input
          id="sign-up-full-name"
          name="fullName"
          autoComplete="name"
          value={form.fullName}
          onChange={(event) => updateField("fullName", event.target.value)}
          aria-invalid={Boolean(errors.fullName)}
        />
        {errors.fullName ? (
          <p className="text-sm text-destructive">{errors.fullName}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="sign-up-club-name">Club name</Label>
        <Input
          id="sign-up-club-name"
          name="clubName"
          value={form.clubName}
          onChange={(event) => updateField("clubName", event.target.value)}
          aria-invalid={Boolean(errors.clubName)}
        />
        {errors.clubName ? (
          <p className="text-sm text-destructive">{errors.clubName}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="sign-up-email">Email address</Label>
        <Input
          id="sign-up-email"
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

      <div className="flex flex-col gap-2">
        <Label htmlFor="sign-up-password">Password</Label>
        <Input
          id="sign-up-password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={(event) => updateField("password", event.target.value)}
          aria-invalid={Boolean(errors.password)}
        />
        {errors.password ? (
          <p className="text-sm text-destructive">{errors.password}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="sign-up-timezone">Timezone</Label>
        <select
          id="sign-up-timezone"
          name="timezone"
          value={form.timezone}
          onChange={(event) => updateField("timezone", event.target.value)}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {TIMEZONE_OPTIONS.map((zone) => (
            <option key={zone} value={zone} className="bg-card">
              {zone}
            </option>
          ))}
        </select>
        {errors.timezone ? (
          <p className="text-sm text-destructive">{errors.timezone}</p>
        ) : null}
      </div>

      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Creating your club…" : "Create club"}
      </Button>
    </form>
  );
}
