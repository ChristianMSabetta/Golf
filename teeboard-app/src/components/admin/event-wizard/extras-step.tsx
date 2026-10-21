"use client";

import { useActionState, useEffect, useState } from "react";
import { CircleAlert, Coins, ImagePlus, Layers, Plus, Trash2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldError } from "./field-error";
import {
  publishEvent,
  removeEventSponsor,
  saveExtrasStep,
  uploadEventSponsor,
} from "@/lib/events/extras-actions";
import {
  PAYOUT_PRESETS,
  SIDE_GAME_KINDS,
  SIDE_GAME_LABELS,
  SPONSOR_MAX_LOGOS,
  defaultFlights,
  extrasStepSchema,
  flightLabel,
  type SideGameDraft,
} from "@/lib/events/extras";
import type { EventExtras } from "@/lib/events/server";
import type { WizardActionState } from "@/lib/events/schema";
import type { PublishResult } from "@/lib/events/publish";

/**
 * Wizard Extras & publish step (M4-T007): flights, the four side games
 * (with the skins per-hole value), the standard payout presets, up to 8
 * sponsor logos (uploaded to the club-scoped `sponsor-logos` bucket), the
 * welcome message, and public visibility — then the Publish action, which
 * atomically mints the short code, per-group tokens, and the 4-digit
 * scorer PIN server-side and presents the shareable links.
 *
 * Payout/flight *defaults* come from @teeboard/scoring (the 50/30/20 preset
 * constant); no scoring arithmetic lives here.
 */

const STRING_SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function textOrEmpty(value: number | null): string {
  return value === null ? "" : String(value);
}

export function ExtrasStep({
  eventId,
  extras,
  readOnly = false,
}: {
  eventId: string;
  extras: EventExtras;
  readOnly?: boolean;
}) {
  // ─── Flights ──────────────────────────────────────────────────────────────
  const [flights, setFlights] = useState(() =>
    extras.flights.length > 0
      ? extras.flights.map((flight) => ({
          name: flight.name,
          maxHandicapText: textOrEmpty(flight.maxHandicap),
        }))
      : [],
  );

  function addFlight() {
    setFlights((current) => [
      ...current,
      { name: `${flightLabel(current.length)} Flight`, maxHandicapText: "" },
    ]);
  }

  function removeFlight(index: number) {
    setFlights((current) => current.filter((_, i) => i !== index));
  }

  // ─── Side games ────────────────────────────────────────────────────────────
  // Only the ENABLED kinds are step state: a disabled skins (holeValue null)
  // would fail the contract, and the four kinds render from this list alone.
  const [sideGames, setSideGames] = useState<SideGameDraft[]>(() =>
    SIDE_GAME_KINDS.flatMap((kind) => {
      const persisted = extras.sideGames.find((game) => game.kind === kind);
      if (persisted === undefined) return [];
      return [persisted];
    }),
  );

  function toggleSideGame(kind: SideGameDraft["kind"], enabled: boolean) {
    setSideGames((current) => {
      const without = current.filter((game) => game.kind !== kind);
      if (!enabled) return without;
      return [
        ...without,
        {
          kind,
          holeValue: kind === "skins" ? 5 : null,
          holeValueText: kind === "skins" ? "5" : "",
        },
      ];
    });
  }

  // ─── Payouts ───────────────────────────────────────────────────────────────
  // Persisted on the event row by saveExtrasStep, so the choice survives a
  // refresh (an unknown preset id falls back to 50/30/20 server-side).
  const [payoutPreset, setPayoutPreset] = useState<string>(extras.payouts.presetId);
  const [purse, setPurse] = useState(String(extras.payouts.purse));

  // ─── Sponsors ──────────────────────────────────────────────────────────────
  const [sponsorName, setSponsorName] = useState("");
  const sponsors = extras.sponsors;

  const [uploadState, uploadAction, uploadPending] = useActionState<
    WizardActionState,
    FormData
  >(uploadEventSponsor, {});
  const [removeState, removeAction] = useActionState<WizardActionState, FormData>(
    removeEventSponsor,
    {},
  );

  // A successful upload is revalidated server-side (the new row renders on
  // the next pass); clearing the name input here keeps a second upload from
  // silently upserting onto the previous sponsor's name.
  useEffect(() => {
    if (uploadState.saved) setSponsorName("");
  }, [uploadState.saved]);

  // ─── Welcome + visibility ─────────────────────────────────────────────────
  const [welcomeMessage, setWelcomeMessage] = useState(extras.welcomeMessage);
  const [isPublic, setIsPublic] = useState(extras.isPublic);

  // ─── Save ──────────────────────────────────────────────────────────────────
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [saveState, saveAction, savePending] = useActionState<
    WizardActionState,
    FormData
  >(saveExtrasStep, {});

  function payload() {
    return {
      flights: flights.map((flight) => ({
        name: flight.name,
        maxHandicap: flight.maxHandicapText === "" ? null : flight.maxHandicapText,
      })),
      sideGames: sideGames.map((game) => ({
        kind: game.kind,
        holeValue: game.holeValueText === "" ? null : game.holeValueText,
        holeValueText: game.holeValueText,
      })),
      payouts: { presetId: payoutPreset, purse: purse === "" ? 0 : Number(purse) },
      sponsors: sponsors.map((sponsor) => ({
        name: sponsor.name,
        logoPath: sponsor.logoPath,
      })),
      welcomeMessage,
      isPublic,
    };
  }

  function validate(): Record<string, string> {
    const parsed = extrasStepSchema.safeParse(payload());
    if (parsed.success) return {};
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (key && !fields[key]) fields[key] = issue.message;
    }
    return fields;
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    const fields = validate();
    if (Object.keys(fields).length > 0) {
      event.preventDefault();
      setClientErrors(fields);
      return;
    }
    setClientErrors({});
  }

  const saveErrors = saveState.fields ?? {};
  function err(key: string): string | undefined {
    return clientErrors[key] ?? saveErrors[key];
  }

  // ─── Publish ───────────────────────────────────────────────────────────────
  const [publishState, publishAction, publishPending] = useActionState<
    WizardActionState & { publish?: PublishResult },
    FormData
  >(publishEvent, {});
  const publish = publishState.publish ?? null;

  return (
    <div className="flex flex-col gap-6">
      <form action={saveAction} onSubmit={submit} className="flex flex-col gap-6">
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="payload" value={JSON.stringify(payload())} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="size-4" aria-hidden />
              Flights
            </CardTitle>
            <CardDescription>
              Handicap-threshold flights (A below B). Leave the last
              flight&apos;s threshold open to absorb everyone above it.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {flights.map((flight, index) => (
              <div key={`flight-${index}`} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
                <div className="grid gap-2">
                  <Label htmlFor={`flight-name-${index}`}>Flight name</Label>
                  <Input
                    id={`flight-name-${index}`}
                    value={flight.name}
                    onChange={(e) =>
                      setFlights((current) => {
                        const next = [...current];
                        next[index] = { ...next[index]!, name: e.target.value };
                        return next;
                      })
                    }
                    disabled={readOnly}
                    aria-invalid={Boolean(err(`flights.${index}.name`))}
                  />
                  <FieldError message={err(`flights.${index}.name`)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`flight-max-${index}`}>Max handicap</Label>
                  <Input
                    id={`flight-max-${index}`}
                    inputMode="decimal"
                    value={flight.maxHandicapText}
                    placeholder="open"
                    onChange={(e) =>
                      setFlights((current) => {
                        const next = [...current];
                        next[index] = { ...next[index]!, maxHandicapText: e.target.value };
                        return next;
                      })
                    }
                    disabled={readOnly}
                    className="tabular-nums"
                    aria-invalid={Boolean(err(`flights.${index}.maxHandicap`))}
                  />
                  <FieldError message={err(`flights.${index}.maxHandicap`)} />
                </div>
                <div className="grid items-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeFlight(index)}
                    disabled={readOnly}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            {flights.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No flights — the whole field plays one open competition.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={addFlight} disabled={readOnly}>
                <Plus className="size-4" aria-hidden />
                Add flight
              </Button>
              {flights.length === 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setFlights(
                      defaultFlights().map((flight) => ({
                        name: flight.name,
                        maxHandicapText: textOrEmpty(flight.maxHandicap),
                      })),
                    )
                  }
                  disabled={readOnly}
                >
                  Use the standard A/B ladder
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="size-4" aria-hidden />
              Side games
            </CardTitle>
            <CardDescription>
              Skins carry over on tied holes; the measurement games resolve
              from the day&apos;s measurements (@teeboard/scoring).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {SIDE_GAME_KINDS.map((kind) => {
              const game = sideGames.find((entry) => entry.kind === kind);
              const enabled = game !== undefined;
              return (
                <div key={kind} className="grid gap-2 sm:grid-cols-[1fr_9rem]">
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary/5">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => toggleSideGame(kind, e.target.checked)}
                      disabled={readOnly}
                      className="accent-[#0F5132]"
                    />
                    {SIDE_GAME_LABELS[kind]}
                  </label>
                  {kind === "skins" && enabled ? (
                    <div className="grid gap-2">
                      <Label htmlFor="skins-value">Per-hole value</Label>
                      <Input
                        id="skins-value"
                        inputMode="decimal"
                        value={game?.holeValueText ?? ""}
                        onChange={(e) =>
                          setSideGames((current) =>
                            current.map((entry) =>
                              entry.kind === "skins"
                                ? { ...entry, holeValueText: e.target.value }
                                : entry,
                            ),
                          )
                        }
                        disabled={readOnly}
                        className="tabular-nums"
                        aria-invalid={Boolean(
                          err(
                            `sideGames.${sideGames.findIndex((entry) => entry.kind === "skins")}.holeValue`,
                          ),
                        )}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="size-4" aria-hidden />
              Payouts
            </CardTitle>
            <CardDescription>
              The purse splits across positions with correct tie handling
              (@teeboard/scoring): a tie combines the spanned positions and
              splits the total.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <div className="grid gap-2">
              <Label htmlFor="payout-preset">Preset</Label>
              <select
                id="payout-preset"
                value={payoutPreset}
                onChange={(e) => setPayoutPreset(e.target.value)}
                disabled={readOnly}
                className={STRING_SELECT_CLASS}
              >
                {PAYOUT_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <FieldError message={err("payouts.presetId")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="payout-purse">Purse</Label>
              <Input
                id="payout-purse"
                inputMode="numeric"
                value={purse}
                onChange={(e) => setPurse(e.target.value)}
                disabled={readOnly}
                className="tabular-nums"
                aria-invalid={Boolean(err("payouts.purse"))}
              />
              <FieldError message={err("payouts.purse")} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImagePlus className="size-4" aria-hidden />
              Sponsor logos
            </CardTitle>
            <CardDescription>
              Up to {SPONSOR_MAX_LOGOS} logos — PNG, JPEG, WebP, or SVG under
              2&nbsp;MB — stored in the club-scoped Supabase Storage bucket.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {sponsors.length > 0 ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {sponsors.map((sponsor) => (
                  <li
                    key={sponsor.id}
                    className="flex items-center gap-3 rounded-lg border border-input p-2"
                  >
                    {sponsor.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={sponsor.logoUrl}
                        alt={`${sponsor.name} logo`}
                        className="size-10 rounded object-contain"
                      />
                    ) : (
                      <span className="flex size-10 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                        logo
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {sponsor.name}
                    </span>
                    {!readOnly ? (
                      <span className="inline">
                        <input type="hidden" name={`remove-${sponsor.id}`} value={sponsor.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          formAction={removeAction}
                        >
                          <Trash2 className="size-4" aria-hidden />
                          Remove
                        </Button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No sponsors yet — upload a logo to feature them on the leaderboard.
              </p>
            )}
            {removeState.error ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {removeState.error}
              </p>
            ) : null}

            {!readOnly && sponsors.length < SPONSOR_MAX_LOGOS ? (
              <div className="grid gap-2 rounded-lg border border-dashed border-input p-3 sm:grid-cols-[1fr_auto_auto]">
                <div className="grid gap-2">
                  <Label htmlFor="sponsor-name">Sponsor name</Label>
                  <Input
                    id="sponsor-name"
                    name="name"
                    value={sponsorName}
                    onChange={(e) => setSponsorName(e.target.value)}
                    placeholder="Ace Golf Cars"
                    disabled={uploadPending}
                  />
                </div>
                <div className="grid items-end gap-2">
                  <Label htmlFor="sponsor-file">Logo</Label>
                  <input
                    id="sponsor-file"
                    name="file"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    required
                    disabled={uploadPending}
                    className="text-sm"
                  />
                </div>
                <div className="grid items-end">
                  <Button
                    type="submit"
                    size="sm"
                    formAction={uploadAction}
                    disabled={uploadPending}
                  >
                    {uploadPending ? "Uploading…" : "Upload"}
                  </Button>
                </div>
                {uploadState.error ? (
                  <p role="alert" className="text-sm font-medium text-destructive sm:col-span-3">
                    {uploadState.error}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground sm:col-span-3">
                  An empty optional file input posts no file — the upload
                  button, not the save button, performs the upload.
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Welcome & visibility</CardTitle>
            <CardDescription>
              The welcome message heads the player surfaces; visibility gates
              the public leaderboard and TV URLs for strangers.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="welcome-message">Welcome message</Label>
              <textarea
                id="welcome-message"
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
                disabled={readOnly}
                rows={3}
                maxLength={2000}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                placeholder="Welcome to the 2026 Member-Guest — play well!"
              />
              <FieldError message={err("welcomeMessage")} />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                disabled={readOnly}
                className="accent-[#0F5132]"
              />
              Public — anyone with the link can view the leaderboard and TV
            </label>
          </CardContent>
        </Card>

        {saveState.error && !saveState.saved ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            <CircleAlert className="mr-1 inline size-4" aria-hidden />
            {saveState.error}
          </p>
        ) : null}
        {saveState.saved ? (
          <p className="text-sm font-medium text-primary">
            Extras saved — draft autosaves as you edit.
          </p>
        ) : null}

        <Button type="submit" disabled={savePending || readOnly}>
          {savePending ? "Saving…" : "Save extras"}
        </Button>
      </form>

      {/* ─── Publish ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Publish</CardTitle>
          <CardDescription>
            Publishing locks the wizard and mints everything game day needs:
            a unique short code for the public/TV URLs, a fresh 32-character
            token per group for the player QR scoring links, and the 4-digit
            scorer PIN — generated server-side in one atomic transition.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {publish ? (
            <div className="grid gap-3">
              <p className="rounded-lg bg-primary/5 p-3 text-sm text-primary">
                Published. The scorer PIN is{" "}
                <strong className="font-semibold tabular-nums">{publish.scorerPin}</strong>{" "}
                — it is shown once (it is stored only as a salted hash) and
                can be re-shared from the event admin page later.
              </p>
              <ShareableLinks
                shortCode={publish.shortCode}
                publicUrl={publish.publicUrl}
                tvUrl={publish.tvUrl}
                scorerUrl={publish.scorerUrl}
              />
            </div>
          ) : readOnly ? (
            <p className="text-sm text-muted-foreground">
              Your role can view this draft but not publish it.
            </p>
          ) : (
            <div className="grid gap-3">
              <input type="hidden" name="isPublicField" value={String(isPublic)} />
              <Button
                type="submit"
                formAction={publishAction}
                size="lg"
                disabled={publishPending}
              >
                {publishPending ? "Publishing…" : "Publish event"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Players must be attached and at least one group saved before
                publishing — a token is minted per group.
              </p>
            </div>
          )}
          {publishState.error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              <CircleAlert className="mr-1 inline size-4" aria-hidden />
              {publishState.error}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/** The copyable shareable links a published event presents. */
function ShareableLinks({
  shortCode,
  publicUrl,
  tvUrl,
  scorerUrl,
}: {
  shortCode: string;
  publicUrl: string;
  tvUrl: string;
  scorerUrl: string;
}) {
  const rows = [
    { label: "Public leaderboard", href: publicUrl, hint: `Short code ${shortCode}` },
    { label: "TV view", href: tvUrl, hint: "For the clubhouse screen" },
    { label: "Scorer entry", href: scorerUrl, hint: "Scorers enter the 4-digit event PIN" },
  ] as const;

  return (
    <ul className="grid gap-2">
      {rows.map((row) => (
        <li
          key={row.label}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-input px-3 py-2"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{row.label}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">{row.href}</p>
            <p className="text-xs text-muted-foreground">{row.hint}</p>
          </div>
          <Button type="button" variant="outline" size="sm">
            <CopyButton text={row.href} />
          </Button>
        </li>
      ))}
    </ul>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
      }}
      className="text-sm"
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
