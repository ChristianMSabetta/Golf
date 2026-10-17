"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  waitlistSignupSchema,
  WAITLIST_ROLES,
  WAITLIST_SUCCESS_MESSAGE,
} from "@/lib/waitlist/schema";
import { US_STATES } from "@/lib/us-states";

const ROLE_LABELS: Record<(typeof WAITLIST_ROLES)[number], string> = {
  head_professional: "Head Professional",
  golf_professional: "Golf Professional",
  course_manager: "Course Manager",
  course_owner: "Course Owner",
  other: "Other",
};

type FormState = {
  email: string;
  name: string;
  courseName: string;
  state: string;
  role: string;
};

const EMPTY_FORM: FormState = {
  email: "",
  name: "",
  courseName: "",
  state: "",
  role: "",
};

type WaitlistFormProps = {
  utmSource?: string;
};

export function WaitlistForm({ utmSource }: WaitlistFormProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});

    const parsed = waitlistSignupSchema.safeParse({
      email: form.email,
      name: form.name,
      courseName: form.courseName,
      state: form.state,
      role: form.role,
      utmSource: utmSource || undefined,
    });

    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !fieldErrors[key]) {
          fieldErrors[key] = issue.message;
        }
      }
      setErrors(fieldErrors);
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = (await response.json()) as {
        fields?: Record<string, string>;
      };

      if (!response.ok) {
        setErrors(data.fields ?? {});
        setSubmitting(false);
        return;
      }

      setForm(EMPTY_FORM);
      setSucceeded(true);
    } catch {
      setErrors({
        form: "Something went wrong. Please try again in a moment.",
      });
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  if (succeeded) {
    return (
      <div
        role="status"
        className="mx-auto w-full max-w-xl rounded-xl border border-brand/20 bg-card px-6 py-10 text-center"
      >
        <p className="font-heading text-2xl font-semibold text-brand">
          {WAITLIST_SUCCESS_MESSAGE}
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="mx-auto w-full max-w-xl rounded-xl border border-border bg-card px-6 py-8"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="waitlist-email">Email address</Label>
          <Input
            id="waitlist-email"
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
          <Label htmlFor="waitlist-name">Name</Label>
          <Input
            id="waitlist-name"
            name="name"
            autoComplete="name"
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            aria-invalid={Boolean(errors.name)}
          />
          {errors.name ? (
            <p className="text-sm text-destructive">{errors.name}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="waitlist-course-name">Course name</Label>
          <Input
            id="waitlist-course-name"
            name="courseName"
            value={form.courseName}
            onChange={(event) => updateField("courseName", event.target.value)}
            aria-invalid={Boolean(errors.courseName)}
          />
          {errors.courseName ? (
            <p className="text-sm text-destructive">{errors.courseName}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="waitlist-state">State</Label>
          <Select
            name="state"
            value={form.state}
            onValueChange={(value) => updateField("state", value)}
          >
            <SelectTrigger
              id="waitlist-state"
              aria-invalid={Boolean(errors.state)}
              className="h-8 w-full"
            >
              <SelectValue placeholder="Select a state" />
            </SelectTrigger>
            <SelectContent>
              {US_STATES.map((state) => (
                <SelectItem key={state.code} value={state.code}>
                  {state.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.state ? (
            <p className="text-sm text-destructive">{errors.state}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="waitlist-role">Role</Label>
          <Select
            name="role"
            value={form.role}
            onValueChange={(value) => updateField("role", value)}
          >
            <SelectTrigger
              id="waitlist-role"
              aria-invalid={Boolean(errors.role)}
              className="h-8 w-full"
            >
              <SelectValue placeholder="Select your role" />
            </SelectTrigger>
            <SelectContent>
              {WAITLIST_ROLES.map((role) => (
                <SelectItem key={role} value={role}>
                  {ROLE_LABELS[role]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.role ? (
            <p className="text-sm text-destructive">{errors.role}</p>
          ) : null}
        </div>

        {errors.form ? (
          <p className="text-sm text-destructive" role="alert">
            {errors.form}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? "Submitting…" : "Join the waitlist"}
        </Button>
      </div>
    </form>
  );
}
