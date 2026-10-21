"use client";

import { useActionState, useState } from "react";
import { CircleAlert, Settings2, ShieldAlert } from "lucide-react";
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
import { FieldError } from "@/components/admin/event-wizard/field-error";
import { saveEventSettings } from "@/lib/events/admin-actions";
import {
  EVENT_HOLES_COUNTS,
  EVENT_NINE_OPTIONS,
  EVENT_ROUNDS,
  EVENT_START_TYPES,
  MAX_SCORE_CAP_MAX,
  MAX_SCORE_CAP_MIN,
  SCORING_BASES,
  WIZARD_FORMATS,
  formatDefaults,
} from "@/lib/events/schema";
import {
  FORMAT_CHANGE_CONFIRMATION,
  eventSettingsSchema,
  formatChangeNeedsConfirmation,
  type EventStatus,
} from "@/lib/events/admin";

/**
 * Event admin Settings tab (M4-T008): the editable event configuration -
 * basics (name, date, holes, rounds, start type), the format block (scoring
 * format through tiebreak), and the welcome message + visibility. Validated
 * by the shared `eventSettingsSchema` on both client and server.
 *
 * The mid-event safeguard: on a live (published) event, changing the scoring
 * format reveals a confirmation panel where the staff member must type
 * CHANGE before the save enables - and the server action re-checks the same
 * guard, so a tampered client cannot apply the change.
 */

const STRING_SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const FORMAT_LABELS: Record<(typeof WIZARD_FORMATS)[number], string> = {
  stroke_play: "Stroke play",
  scramble: "Scramble",
  best_ball: "Best ball",
  stableford: "Stableford",
  shamble: "Shamble",
};

function formatHi(hi: number | null): string {
  return hi === null ? "" : String(hi);
}

export function SettingsTab({
  event,
  format,
  readOnly = false,
}: {
  event: {
    readonly id: string;
    readonly name: string;
    readonly startDate: string;
    readonly status: EventStatus;
    readonly holesCount: number;
    readonly nineOption: "front" | "back";
    readonly rounds: number;
    readonly startType: "tee_times" | "shotgun";
    readonly welcomeMessage: string;
    readonly isPublic: boolean;
  };
  format: {
    readonly format: string;
    readonly teamSize: number;
    readonly scoringBasis: string;
    readonly handicapAllowancePct: number | null;
    readonly maxScoreRule: string;
    readonly maxScoreFixedCap: number | null;
    readonly tiebreakMethod: string;
  } | null;
  readOnly?: boolean;
}) {
  const isLive = formatChangeNeedsConfirmation(event.status);

  const [name, setName] = useState(event.name);
  const [startDate, setStartDate] = useState(event.startDate);
  const [holesCount, setHolesCount] = useState<number>(event.holesCount);
  const [nineOption, setNineOption] = useState<"front" | "back">(event.nineOption);
  const [rounds, setRounds] = useState<number>(event.rounds);
  const [startType, setStartType] = useState<"tee_times" | "shotgun">(event.startType);
  const [welcomeMessage, setWelcomeMessage] = useState(event.welcomeMessage);
  const [isPublic, setIsPublic] = useState(event.isPublic);

  const initialFormat =
    format !== null && (WIZARD_FORMATS as readonly string[]).includes(format.format)
      ? (format.format as (typeof WIZARD_FORMATS)[number])
      : "stroke_play";
  const [formatChoice, setFormatChoice] = useState<(typeof WIZARD_FORMATS)[number]>(initialFormat);
  const [teamSize, setTeamSize] = useState<number>(format?.teamSize ?? 1);
  const [scoringBasis, setScoringBasis] = useState<string>(format?.scoringBasis ?? "both");
  const [allowancePct, setAllowancePct] = useState(
    format?.handicapAllowancePct === null || format?.handicapAllowancePct === undefined
      ? ""
      : String(format.handicapAllowancePct),
  );
  const [maxScoreRule, setMaxScoreRule] = useState<string>(format?.maxScoreRule ?? "none");
  const [fixedCap, setFixedCap] = useState(formatHi(format?.maxScoreFixedCap ?? null));
  const [tiebreakMethod, setTiebreakMethod] = useState<string>(
    format?.tiebreakMethod ?? "card_off",
  );
  const [confirmFormat, setConfirmFormat] = useState("");

  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [state, formAction, pending] = useActionState<
    Awaited<ReturnType<typeof saveEventSettings>>,
    FormData
  >(saveEventSettings, {});

  function payload() {
    return {
      name,
      startDate,
      holesCount,
      nineOption,
      rounds,
      startType,
      format: formatChoice,
      teamSize,
      scoringBasis,
      handicapAllowancePct: allowancePct,
      maxScoreRule,
      maxScoreFixedCap: fixedCap,
      tiebreakMethod,
      welcomeMessage,
      isPublic,
    };
  }

  function validate(): Record<string, string> {
    const parsed = eventSettingsSchema.safeParse(payload());
    if (parsed.success) return {};
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (key && !fields[key]) fields[key] = issue.message;
    }
    return fields;
  }

  function submit(formEvent: React.FormEvent<HTMLFormElement>) {
    const fields = validate();
    if (Object.keys(fields).length > 0) {
      formEvent.preventDefault();
      setClientErrors(fields);
      return;
    }
    setClientErrors({});
  }

  function changeFormat(next: (typeof WIZARD_FORMATS)[number]) {
    setFormatChoice(next);
    setConfirmFormat("");
    const defaults = formatDefaults(next);
    setTeamSize(defaults.teamSize);
    setScoringBasis(defaults.scoringBasis);
    setAllowancePct(String(defaults.handicapAllowancePct));
    setMaxScoreRule(defaults.maxScoreRule);
    setTiebreakMethod(defaults.tiebreakMethod);
    setFixedCap("");
  }

  const saveErrors = state.fields ?? {};
  function err(key: string): string | undefined {
    return clientErrors[key] ?? saveErrors[key];
  }

  const formatChanged = formatChoice !== initialFormat;
  const showConfirm = isLive && formatChanged;

  return (
    <form action={formAction} onSubmit={submit} noValidate className="flex flex-col gap-6">
      <input type="hidden" name="eventId" value={event.id} />
      <input type="hidden" name="payload" value={JSON.stringify(payload())} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="size-4" aria-hidden />
            Basics
          </CardTitle>
          <CardDescription>
            The event&apos;s day, structure, and course routing.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="settings-name">Name</Label>
            <Input
              id="settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={readOnly}
              aria-invalid={Boolean(err("name"))}
            />
            <FieldError message={err("name")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="settings-date">Date</Label>
            <Input
              id="settings-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={readOnly}
              aria-invalid={Boolean(err("startDate"))}
            />
            <FieldError message={err("startDate")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="settings-holes">Holes</Label>
            <select
              id="settings-holes"
              value={holesCount}
              onChange={(e) => setHolesCount(Number(e.target.value))}
              disabled={readOnly}
              className={STRING_SELECT_CLASS}
            >
              {EVENT_HOLES_COUNTS.map((count) => (
                <option key={count} value={count}>
                  {count} holes
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="settings-nine">Nine</Label>
            <select
              id="settings-nine"
              value={nineOption}
              onChange={(e) => setNineOption(e.target.value as "front" | "back")}
              disabled={readOnly || holesCount !== 9}
              className={STRING_SELECT_CLASS}
            >
              {EVENT_NINE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === "front" ? "Front (1-9)" : "Back (10-18)"}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="settings-rounds">Rounds</Label>
            <select
              id="settings-rounds"
              value={rounds}
              onChange={(e) => setRounds(Number(e.target.value))}
              disabled={readOnly}
              className={STRING_SELECT_CLASS}
            >
              {EVENT_ROUNDS.map((count) => (
                <option key={count} value={count}>
                  {count} round{count === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="settings-start">Start</Label>
            <select
              id="settings-start"
              value={startType}
              onChange={(e) => setStartType(e.target.value as "tee_times" | "shotgun")}
              disabled={readOnly}
              className={STRING_SELECT_CLASS}
            >
              {EVENT_START_TYPES.map((option) => (
                <option key={option} value={option}>
                  {option === "shotgun" ? "Shotgun" : "Tee times"}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Format</CardTitle>
          <CardDescription>
            How the event is scored. Defaults follow the WHS allowances
            (@teeboard/scoring).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Label>Scoring format</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {WIZARD_FORMATS.map((option) => (
                <label
                  key={option}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary/5"
                >
                  <input
                    type="radio"
                    name="settings-format"
                    value={option}
                    checked={formatChoice === option}
                    onChange={() => changeFormat(option)}
                    disabled={readOnly}
                    className="accent-[#0F5132]"
                  />
                  {FORMAT_LABELS[option]}
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="settings-team-size">Team size</Label>
              <select
                id="settings-team-size"
                value={teamSize}
                onChange={(e) => setTeamSize(Number(e.target.value))}
                disabled={readOnly}
                className={STRING_SELECT_CLASS}
              >
                {[1, 2, 3, 4].map((size) => (
                  <option key={size} value={size}>
                    {size} {size === 1 ? "player" : "players"}
                  </option>
                ))}
              </select>
              <FieldError message={err("teamSize")} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="settings-basis">Scoring</Label>
              <select
                id="settings-basis"
                value={scoringBasis}
                onChange={(e) => setScoringBasis(e.target.value)}
                disabled={readOnly}
                className={STRING_SELECT_CLASS}
              >
                {SCORING_BASES.map((basis) => (
                  <option key={basis} value={basis}>
                    {basis === "gross" ? "Gross only" : basis === "net" ? "Net only" : "Gross & net"}
                  </option>
                ))}
              </select>
              <FieldError message={err("scoringBasis")} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="settings-allowance">Handicap allowance (%)</Label>
              <Input
                id="settings-allowance"
                inputMode="decimal"
                value={allowancePct}
                onChange={(e) => setAllowancePct(e.target.value)}
                disabled={readOnly}
                className="tabular-nums"
                aria-invalid={Boolean(err("handicapAllowancePct"))}
              />
              <p className="text-xs text-muted-foreground">
                WHS default for this format:{" "}
                {formatDefaults(formatChoice).handicapAllowancePct}%
              </p>
              <FieldError message={err("handicapAllowancePct")} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="settings-max-rule">Maximum score</Label>
              <select
                id="settings-max-rule"
                value={maxScoreRule}
                onChange={(e) => setMaxScoreRule(e.target.value)}
                disabled={readOnly}
                className={STRING_SELECT_CLASS}
              >
                <option value="none">No maximum</option>
                <option value="fixed">Fixed cap per hole</option>
                <option value="double_par">Double par</option>
                <option value="net_double_bogey">Net double bogey (WHS)</option>
              </select>
              <FieldError message={err("maxScoreRule")} />
            </div>

            {maxScoreRule === "fixed" ? (
              <div className="grid gap-2">
                <Label htmlFor="settings-fixed-cap">
                  Fixed cap ({MAX_SCORE_CAP_MIN}-{MAX_SCORE_CAP_MAX} strokes)
                </Label>
                <Input
                  id="settings-fixed-cap"
                  inputMode="numeric"
                  value={fixedCap}
                  onChange={(e) => setFixedCap(e.target.value)}
                  disabled={readOnly}
                  className="tabular-nums"
                  aria-invalid={Boolean(err("maxScoreFixedCap"))}
                />
                <FieldError message={err("maxScoreFixedCap")} />
              </div>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="settings-tiebreak">Tiebreak</Label>
              <select
                id="settings-tiebreak"
                value={tiebreakMethod}
                onChange={(e) => setTiebreakMethod(e.target.value)}
                disabled={readOnly}
                className={STRING_SELECT_CLASS}
              >
                <option value="card_off">USGA card-off</option>
                <option value="none">Countback disabled</option>
              </select>
              <FieldError message={err("tiebreakMethod")} />
            </div>
          </div>

          {showConfirm ? (
            <div className="grid gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                <ShieldAlert className="size-4" aria-hidden />
                This event is live - changing the scoring format mid-event
                reshuffles the standings.
              </p>
              <p className="text-xs text-muted-foreground">
                Type <strong className="font-semibold">{FORMAT_CHANGE_CONFIRMATION}</strong>{" "}
                to confirm the format change. The server re-checks this - a
                skipped field cannot apply the change.
              </p>
              <Input
                name="confirmFormat"
                value={confirmFormat}
                onChange={(e) => setConfirmFormat(e.target.value)}
                disabled={readOnly}
                placeholder={FORMAT_CHANGE_CONFIRMATION}
                aria-label="Type CHANGE to confirm the format change"
                className="max-w-40 font-mono"
                aria-invalid={Boolean(err("confirmFormat"))}
              />
              <FieldError message={err("confirmFormat")} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Welcome & visibility</CardTitle>
          <CardDescription>
            The message heads the player surfaces; visibility gates the public
            leaderboard and TV URLs for strangers.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="settings-welcome">Welcome message</Label>
            <textarea
              id="settings-welcome"
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              disabled={readOnly}
              rows={3}
              maxLength={2000}
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              placeholder="Welcome to the 2026 Member-Guest - play well!"
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
            Public - anyone with the link can view the leaderboard and TV
          </label>
        </CardContent>
      </Card>

      {state.error && !state.saved ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          <CircleAlert className="mr-1 inline size-4" aria-hidden />
          {state.error}
        </p>
      ) : null}
      {state.saved ? (
        <p className="text-sm font-medium text-primary">
          Settings saved - live surfaces pick up the change on refresh.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          disabled={
            pending ||
            readOnly ||
            (showConfirm && confirmFormat.trim() !== FORMAT_CHANGE_CONFIRMATION)
          }
        >
          {pending ? "Saving…" : "Save settings"}
        </Button>
        {showConfirm ? (
          <p className="text-xs text-muted-foreground">
            The save button unlocks once you type {FORMAT_CHANGE_CONFIRMATION}.
          </p>
        ) : null}
      </div>
    </form>
  );
}
