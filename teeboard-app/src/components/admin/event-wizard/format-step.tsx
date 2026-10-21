"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AutofillBadge } from "./autofill-badge";
import { FieldError } from "./field-error";
import { saveFormatStep } from "@/lib/events/actions";
import {
  CARD_OFF_STAGES,
  MAX_SCORE_RULES,
  NET_DOUBLE_BOGEY_OVER_PAR,
  SCORING_BASES,
  TIEBREAK_METHODS,
  WIZARD_FORMATS,
  formatDefaults,
  formatStepSchema,
  type WizardActionState,
  type WizardFormat,
} from "@/lib/events/schema";
import type { FormatStep, WizardDraftData } from "@/lib/events/wizard";
import { prefillAwareFormat } from "@/lib/events/prefill";
import type { AiEventPrefill } from "@/lib/ai/schema";

/**
 * Wizard Format step (M4-T003): the five scoring formats, team size,
 * gross/net/both scoring, handicap allowance percentage, maximum-score
 * rule, and tiebreak method. Defaults derive from the WHS allowances in
 * @teeboard/scoring via formatDefaults(); valid values autosave debounced.
 *
 * M4-T004: the AI pre-fill injects `prefill`; prefilled fields carry the
 * 'Auto-filled' badge until the user touches them (`touched` reports
 * per-field edits to the wizard). A prefilled format switches the WHS
 * defaults to that format so untouched fields stay valid.
 */

const AUTOSAVE_DEBOUNCE_MS = 1500;
const STRING_SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const FORMAT_LABELS: Record<WizardFormat, string> = {
  stroke_play: "Stroke play",
  scramble: "Scramble",
  best_ball: "Best ball",
  stableford: "Stableford",
  shamble: "Shamble",
};

export function FormatStep({
  draft,
  eventId,
  onSaved,
  readOnly = false,
  prefill = null,
  touched = () => {},
  aiTouchedFields = new Set(),
}: {
  draft: WizardDraftData | null;
  eventId: string;
  onSaved: (savedAt: string) => void;
  readOnly?: boolean;
  prefill?: AiEventPrefill | null;
  touched?: (field: string) => void;
  aiTouchedFields?: ReadonlySet<string>;
}) {
  const [format, setFormat] = useState<WizardFormat>(
    prefillAwareFormat(draft, prefill).format,
  );
  const [teamSize, setTeamSize] = useState<number>(
    prefillAwareFormat(draft, prefill).teamSize,
  );
  const resolved = prefillAwareFormat(draft, prefill);
  const [scoringBasis, setScoringBasis] = useState(resolved.scoringBasis);
  const [allowancePct, setAllowancePct] = useState(
    resolved.handicapAllowancePct === null
      ? ""
      : String(resolved.handicapAllowancePct),
  );
  const [maxScoreRule, setMaxScoreRule] = useState(resolved.maxScoreRule);
  const [fixedCap, setFixedCap] = useState(
    resolved.maxScoreFixedCap === null ? "" : String(resolved.maxScoreFixedCap),
  );
  const [tiebreakMethod, setTiebreakMethod] = useState(resolved.tiebreakMethod);

  // Re-resolve every field whenever a fresh AI pre-fill arrives.
  useEffect(() => {
    if (prefill === null) return;
    const fresh = prefillAwareFormat(draft, prefill);
    setFormat(fresh.format);
    setTeamSize(fresh.teamSize);
    setScoringBasis(fresh.scoringBasis);
    setAllowancePct(
      fresh.handicapAllowancePct === null
        ? ""
        : String(fresh.handicapAllowancePct),
    );
    setMaxScoreRule(fresh.maxScoreRule);
    setFixedCap(
      fresh.maxScoreFixedCap === null ? "" : String(fresh.maxScoreFixedCap),
    );
    setTiebreakMethod(fresh.tiebreakMethod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [state, formAction, pending] = useActionState<
    WizardActionState,
    FormData
  >(saveFormatStep, {});

  const formRef = useRef<HTMLFormElement>(null);

  function payload() {
    return {
      format,
      teamSize,
      scoringBasis,
      handicapAllowancePct: allowancePct,
      maxScoreRule,
      maxScoreFixedCap: fixedCap,
      tiebreakMethod,
    };
  }

  function validate(): Record<string, string> {
    const parsed = formatStepSchema.safeParse(payload());
    if (parsed.success) return {};
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (!fields[key]) fields[key] = issue.message;
    }
    return fields;
  }

  // Debounced autosave: valid values persist automatically; invalid ones
  // wait for the explicit button (which surfaces the field errors). The
  // first render is skipped — an unchanged draft is never re-persisted
  // just because the form remounted.
  const firstRenderRef = useRef(true);
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    if (readOnly) return;
    const timer = setTimeout(() => {
      if (Object.keys(validate()).length > 0) return;
      formRef.current?.requestSubmit();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    format,
    teamSize,
    scoringBasis,
    allowancePct,
    maxScoreRule,
    fixedCap,
    tiebreakMethod,
    readOnly,
  ]);

  useEffect(() => {
    if (state.saved && state.savedAt) onSaved(state.savedAt);
  }, [state.saved, state.savedAt, onSaved]);

  const errors = state.fields ?? {};

  function err(key: string): string | undefined {
    return clientErrors[key] ?? errors[key];
  }

  /** 'Auto-filled' until the user edits the field (per-field badges). */
  function badge(field: string): boolean {
    const value = prefill?.[field as keyof AiEventPrefill];
    return value !== undefined && !aiTouchedFields.has(field);
  }

  /** Switching formats resets every format-derived field to the WHS defaults. */
  function changeFormat(next: WizardFormat) {
    setFormat(next);
    const defaults = formatDefaults(next);
    setTeamSize(defaults.teamSize);
    setScoringBasis(defaults.scoringBasis);
    setAllowancePct(String(defaults.handicapAllowancePct));
    setMaxScoreRule(defaults.maxScoreRule);
    setTiebreakMethod(defaults.tiebreakMethod);
    setFixedCap("");
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

  const defaults = formatDefaults(format);

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="payload" value={JSON.stringify(payload())} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="size-4" aria-hidden />
            Format
          </CardTitle>
          <CardDescription>
            How the event is scored. Defaults follow the WHS allowances
            (@teeboard/scoring): 95% individual, 85% four-ball, net double
            bogey maximums where WHS applies them.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Scoring format</Label>
              <AutofillBadge show={badge("format")} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {WIZARD_FORMATS.map((option) => (
                <label
                  key={option}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary/5"
                >
                  <input
                    type="radio"
                    name="wizard-format"
                    value={option}
                    checked={format === option}
                    onChange={() => {
                      changeFormat(option);
                      touched("format");
                    }}
                    disabled={readOnly}
                    className="accent-[#0F5132]"
                  />
                  {FORMAT_LABELS[option]}
                </label>
              ))}
            </div>
            <FieldError message={err("format")} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="event-team-size">Team size</Label>
                <AutofillBadge show={badge("teamSize")} />
              </div>
              <select
                id="event-team-size"
                value={teamSize}
                onChange={(e) => {
                  setTeamSize(Number(e.target.value));
                  touched("teamSize");
                }}
                disabled={readOnly}
                className={STRING_SELECT_CLASS}
              >
                {[1, 2, 3, 4].map((size) => (
                  <option key={size} value={size}>
                    {size} {size === 1 ? "player" : "players"}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {defaults.teamSize === 1
                  ? "Individual play."
                  : `${defaults.teamSize} per team is the default for this format.`}
              </p>
              <FieldError message={err("teamSize")} />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="event-basis">Scoring</Label>
                <AutofillBadge show={badge("scoringBasis")} />
              </div>
              <select
                id="event-basis"
                value={scoringBasis}
                onChange={(e) => {
                  setScoringBasis(
                    e.target.value as (typeof SCORING_BASES)[number],
                  );
                  touched("scoringBasis");
                }}
                disabled={readOnly}
                className={STRING_SELECT_CLASS}
              >
                {SCORING_BASES.map((basis) => (
                  <option key={basis} value={basis}>
                    {basis === "gross"
                      ? "Gross only"
                      : basis === "net"
                        ? "Net only"
                        : "Gross & net"}
                  </option>
                ))}
              </select>
              <FieldError message={err("scoringBasis")} />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="event-allowance">Handicap allowance (%)</Label>
                <AutofillBadge
                  show={badge("handicapAllowancePct")}
                />
              </div>
              <Input
                id="event-allowance"
                inputMode="decimal"
                value={allowancePct}
                onChange={(e) => {
                  setAllowancePct(e.target.value);
                  touched("handicapAllowancePct");
                }}
                placeholder={String(defaults.handicapAllowancePct)}
                aria-invalid={Boolean(err("handicapAllowancePct"))}
                disabled={readOnly}
                className="tabular-nums"
              />
              <p className="text-xs text-muted-foreground">
                WHS default for this format: {defaults.handicapAllowancePct}%
              </p>
              <FieldError message={err("handicapAllowancePct")} />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="event-max-rule">Maximum score</Label>
                <AutofillBadge show={badge("maxScoreRule")} />
              </div>
              <select
                id="event-max-rule"
                value={maxScoreRule}
                onChange={(e) => {
                  setMaxScoreRule(
                    e.target.value as (typeof MAX_SCORE_RULES)[number],
                  );
                  touched("maxScoreRule");
                }}
                disabled={readOnly}
                className={STRING_SELECT_CLASS}
              >
                <option value="none">No maximum</option>
                <option value="fixed">Fixed cap per hole</option>
                <option value="double_par">Double par</option>
                <option value="net_double_bogey">Net double bogey (WHS)</option>
              </select>
              <p className="text-xs text-muted-foreground">
                {maxScoreRule === "net_double_bogey"
                  ? `Par + ${NET_DOUBLE_BOGEY_OVER_PAR} + strokes received (Rules of Handicapping 3.3b).`
                  : "Committee-set maximum per Rules of Handicapping 3.3b."}
              </p>
              <FieldError message={err("maxScoreRule")} />
            </div>

            {maxScoreRule === "fixed" ? (
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="event-fixed-cap">Fixed cap (strokes)</Label>
                  <AutofillBadge
                    show={badge("maxScoreFixedCap")}
                  />
                </div>
                <Input
                  id="event-fixed-cap"
                  inputMode="numeric"
                  value={fixedCap}
                  onChange={(e) => {
                    setFixedCap(e.target.value);
                    touched("maxScoreFixedCap");
                  }}
                  placeholder="8"
                  aria-invalid={Boolean(err("maxScoreFixedCap"))}
                  disabled={readOnly}
                  className="tabular-nums"
                />
                <FieldError message={err("maxScoreFixedCap")} />
              </div>
            ) : null}

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="event-tiebreak">Tiebreak</Label>
                <AutofillBadge show={badge("tiebreakMethod")} />
              </div>
              <select
                id="event-tiebreak"
                value={tiebreakMethod}
                onChange={(e) => {
                  setTiebreakMethod(
                    e.target.value as (typeof TIEBREAK_METHODS)[number],
                  );
                  touched("tiebreakMethod");
                }}
                disabled={readOnly}
                className={STRING_SELECT_CLASS}
              >
                <option value="card_off">USGA card-off</option>
                <option value="none">Countback disabled</option>
              </select>
              <p className="text-xs text-muted-foreground">
                {tiebreakMethod === "card_off"
                  ? `Last ${CARD_OFF_STAGES.join(", then ")} holes, then hole-by-hole backwards.`
                  : "Ties stay tied."}
              </p>
              <FieldError message={err("tiebreakMethod")} />
            </div>
          </div>

          {state.error && !state.saved ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {state.error}
            </p>
          ) : null}
          {state.saved ? (
            <p className="text-sm font-medium text-primary">
              Format saved — draft autosaves as you edit.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending || readOnly}>
              {pending ? "Saving…" : "Save format"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
