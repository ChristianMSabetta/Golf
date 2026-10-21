import type { z } from "zod";
import {
  EVENT_HOLES_COUNTS,
  WIZARD_STEPS,
  basicsStepSchema,
  formatStepSchema,
  type FormatStep,
  type WizardStepId,
} from "./schema";

/**
 * Pure wizard-step logic (M4-T003): the 5-step registry, validation gating,
 * completion marking, and the database-row ↔ draft mappers. No I/O, no
 * server imports — unit-testable without mocks, identical client/server.
 */

export type WizardStepStatus = "locked" | "available" | "complete";

export type WizardStepView = {
  readonly id: WizardStepId;
  readonly index: number;
  readonly label: string;
  readonly description: string;
  readonly implemented: boolean;
  readonly status: WizardStepStatus;
};

/** The persisted wizard draft as the UI renders it. */
export type WizardDraftData = {
  readonly eventId: string;
  readonly name: string;
  readonly startDate: string;
  readonly courseId: string;
  readonly holesCount: (typeof EVENT_HOLES_COUNTS)[number];
  readonly nineOption: "front" | "back";
  readonly rounds: 1 | 2;
  readonly startType: "tee_times" | "shotgun";
  readonly formatData: FormatStep | null;
};

/**
 * Maximum step index a draft may navigate to: 0 (Basics only) until Basics
 * validates, 1 (Format) once it does, and 2 (Players) once Format
 * validates too. Steps 3–4 stay gated behind the later milestone tasks.
 */
export function furthestStep(basics: unknown, format: unknown): number {
  if (validateBasics(basics) === null) return 0;
  if (validateFormat(format) === null) return 1;
  return 2;
}

/** Per-step Zod validation → typed result or null. */
export function validateBasics(
  input: unknown,
): z.output<typeof basicsStepSchema> | null {
  const parsed = basicsStepSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function validateFormat(
  input: unknown,
): z.output<typeof formatStepSchema> | null {
  const parsed = formatStepSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/** Step registry rendered by the wizard rail. */
export function wizardSteps(
  furthest: number,
  completed: readonly WizardStepId[],
): WizardStepView[] {
  const done = new Set(completed);
  return WIZARD_STEPS.map((step, index) => {
    const status: WizardStepStatus = done.has(step.id)
      ? "complete"
      : index <= furthest
        ? "available"
        : "locked";
    return {
      id: step.id,
      index,
      label: step.label,
      description: step.description,
      implemented: step.implemented,
      status,
    };
  });
}

/** Whether navigation to `step` is allowed for this draft. */
export function canNavigate(
  step: WizardStepId,
  furthest: number,
  visited: readonly WizardStepId[],
): boolean {
  const index = WIZARD_STEPS.findIndex((entry) => entry.id === step);
  if (index < 0) return false;
  if (index <= furthest) return true;
  return visited.includes(step);
}

/** Marks a step complete once its data validates (visited ⇒ tracked). */
export function completedSteps(
  basics: unknown,
  format: unknown,
): WizardStepId[] {
  const completed: WizardStepId[] = [];
  if (validateBasics(basics) !== null) completed.push("basics");
  if (validateFormat(format) !== null) completed.push("format");
  return completed;
}

// ─── Database-row mappers (pure; server.ts owns the reads) ───────────────────

export type EventWizardRow = {
  readonly id: string;
  readonly name: string;
  readonly start_date: string;
  readonly course_id: string;
  readonly holes_count: number;
  readonly nine_option: string;
  readonly rounds: number;
  readonly start_type: string;
};

export type EventFormatRow = {
  readonly format: string;
  readonly is_primary: boolean;
  readonly team_size: number;
  readonly scoring_basis: string;
  readonly handicap_allowance_pct: number | string | null;
  readonly max_score_rule: string;
  readonly max_score_fixed_cap: number | null;
  readonly tiebreak_method: string;
};

/**
 * Maps the `events` row plus its primary `event_formats` row (already
 * fetched by the server) onto the wizard draft shape. Unknown enum-ish
 * values fall back to the wizard defaults rather than crashing the UI.
 */
export function toWizardDraft(
  event: EventWizardRow,
  primaryFormat: EventFormatRow | null,
): WizardDraftData {
  const formatData: FormatStep | null =
    primaryFormat !== null && isWizardFormat(primaryFormat.format)
      ? {
          format: primaryFormat.format,
          teamSize: primaryFormat.team_size,
          scoringBasis: isScoringBasis(primaryFormat.scoring_basis)
            ? primaryFormat.scoring_basis
            : "both",
          handicapAllowancePct:
            primaryFormat.handicap_allowance_pct === null
              ? null
              : Number(primaryFormat.handicap_allowance_pct),
          maxScoreRule: isMaxScoreRule(primaryFormat.max_score_rule)
            ? primaryFormat.max_score_rule
            : "none",
          maxScoreFixedCap: primaryFormat.max_score_fixed_cap,
          tiebreakMethod: isTiebreakMethod(primaryFormat.tiebreak_method)
            ? primaryFormat.tiebreak_method
            : "card_off",
        }
      : null;

  return Object.freeze({
    eventId: event.id,
    name: event.name,
    startDate: event.start_date,
    courseId: event.course_id,
    holesCount: (EVENT_HOLES_COUNTS as readonly number[]).includes(
      event.holes_count,
    )
      ? (event.holes_count as WizardDraftData["holesCount"])
      : 18,
    nineOption: event.nine_option === "back" ? "back" : "front",
    rounds: event.rounds === 2 ? 2 : 1,
    startType: event.start_type === "shotgun" ? "shotgun" : "tee_times",
    formatData,
  });
}

function isWizardFormat(value: string): value is FormatStep["format"] {
  return (
    formatStepSchema.shape.format.safeParse(value).success
  );
}

function isScoringBasis(value: string): value is FormatStep["scoringBasis"] {
  return formatStepSchema.shape.scoringBasis.safeParse(value).success;
}

function isMaxScoreRule(value: string): value is FormatStep["maxScoreRule"] {
  return formatStepSchema.shape.maxScoreRule.safeParse(value).success;
}

function isTiebreakMethod(
  value: string,
): value is FormatStep["tiebreakMethod"] {
  return formatStepSchema.shape.tiebreakMethod.safeParse(value).success;
}

export type { BasicsStep, FormatStep } from "./schema";
