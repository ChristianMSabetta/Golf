"use client";

import { useActionState, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  updateClubProfile,
  type ClubProfileActionState,
} from "@/lib/club/actions";
import {
  CLUB_PROFILE_SAVED_MESSAGE,
  type ClubProfile,
} from "@/lib/club/schema";
import {
  CLUB_TIMEZONES,
  DEFAULT_PRIMARY_COLOR,
  PRIMARY_COLOR_OPTIONS,
} from "@/lib/brand";

/**
 * Club profile form. Validation is the shared Zod contract
 * (clubProfileSchema) — the same schema runs in the server action, so the
 * client mirrors exactly what the server will enforce.
 */
export function ClubProfileForm({ club }: { club: ClubProfile }) {
  const [form, setForm] = useState<ClubProfile>(club);
  const [state, action, pending] = useActionState<
    ClubProfileActionState,
    FormData
  >(updateClubProfile, {});

  const errors = state.fields ?? {};
  const colorValue = form.primaryColor || DEFAULT_PRIMARY_COLOR;

  function updateField<K extends keyof ClubProfile>(
    field: K,
    value: ClubProfile[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <form action={action} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="club-name">Club name</Label>
        <Input
          id="club-name"
          name="name"
          value={form.name}
          onChange={(event) => updateField("name", event.target.value)}
          aria-invalid={Boolean(errors.name)}
        />
        {errors.name ? (
          <p className="text-sm text-destructive">{errors.name}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="club-logo-url">Logo URL</Label>
        <Input
          id="club-logo-url"
          name="logoUrl"
          inputMode="url"
          placeholder="https://… or /logo.svg (leave empty for the default)"
          value={form.logoUrl}
          onChange={(event) => updateField("logoUrl", event.target.value)}
          aria-invalid={Boolean(errors.logoUrl)}
        />
        {errors.logoUrl ? (
          <p className="text-sm text-destructive">{errors.logoUrl}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="club-primary-color">Primary color</Label>
        <div className="flex flex-wrap items-center gap-2">
          {PRIMARY_COLOR_OPTIONS.map((option) => {
            const selected = form.primaryColor === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                aria-label={option.label}
                title={option.label}
                onClick={() => updateField("primaryColor", option.value)}
                className="flex size-8 items-center justify-center rounded-full border border-border transition-colors hover:scale-105"
                style={{ backgroundColor: option.value }}
              >
                {selected ? (
                  <Check className="size-4 text-cream" aria-hidden />
                ) : null}
              </button>
            );
          })}
          <input
            type="color"
            id="club-primary-color"
            name="primaryColor"
            value={colorValue}
            onChange={(event) =>
              updateField("primaryColor", event.target.value)
            }
            className="h-8 w-14 cursor-pointer rounded-lg border border-input bg-transparent p-1"
            aria-label="Custom primary color"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => updateField("primaryColor", "")}
          >
            Use product default
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          #RRGGBB hex — used by leaderboards, scorecards, and emails. Pick a
          swatch, a custom color, or the product default.
        </p>
        {errors.primaryColor ? (
          <p className="text-sm text-destructive">{errors.primaryColor}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="club-timezone">Timezone</Label>
        <select
          id="club-timezone"
          name="timezone"
          value={form.timezone}
          onChange={(event) =>
            updateField(
              "timezone",
              event.target.value as ClubProfile["timezone"],
            )
          }
          aria-invalid={Boolean(errors.timezone)}
          className="h-8 w-full max-w-xs rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {CLUB_TIMEZONES.map((zone) => (
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
      {state.saved && !state.error ? (
        <p className="text-sm text-foreground" role="status">
          {CLUB_PROFILE_SAVED_MESSAGE}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save club profile"}
        </Button>
      </div>
    </form>
  );
}
