import type { AiEventPrefill } from "@/lib/ai/schema";
import { formatDefaults } from "./schema";
import type { BasicsStep, FormatStep } from "./schema";
import type { WizardDraftData } from "./wizard";

/**
 * Pure AI-prefill → wizard-state mapping (M4-T004). The validated
 * `AiEventPrefill` merges with the persisted draft per field, precedence
 * prefill → draft → WHS defaults. When the prefill switches the format,
 * the format-derived fields (team size, allowance, max score, tiebreak)
 * fall back to the NEW format's defaults instead of the saved values — a
 * saved pair from best ball would otherwise leave Stableford invalid.
 * No I/O — the step components and the test suite share this.
 */

export type BasicsFieldState = {
  readonly name: string;
  readonly startDate: string;
  readonly courseId: string;
  readonly holesCount: number;
  readonly nineOption: BasicsStep["nineOption"];
  readonly rounds: number;
  readonly startType: BasicsStep["startType"];
};

/**
 * Resolves the Basics step's initial state. `todayIso` is injectable so
 * tests don't depend on the clock; `fallbackCourseId` is the club's first
 * course (the AI never sees course ids — it can't suggest one).
 */
export function prefillAwareBasics(
  draft: WizardDraftData | null,
  prefill: AiEventPrefill | null,
  todayIso: string,
  fallbackCourseId: string,
): BasicsFieldState {
  return {
    name: prefill?.name ?? draft?.name ?? "",
    startDate: prefill?.startDate ?? draft?.startDate ?? todayIso,
    courseId: draft?.courseId ?? fallbackCourseId,
    holesCount: prefill?.holesCount ?? draft?.holesCount ?? 18,
    nineOption: prefill?.nineOption ?? draft?.nineOption ?? "front",
    rounds: prefill?.rounds ?? draft?.rounds ?? 1,
    startType: prefill?.startType ?? draft?.startType ?? "tee_times",
  };
}

/**
 * Resolves the Format step's initial state. `scoringBasis` is not
 * format-derived, so a saved preference survives a format switch;
 * everything format-derived follows the chosen format's WHS defaults
 * unless the prefill states the field explicitly.
 */
export function prefillAwareFormat(
  draft: WizardDraftData | null,
  prefill: AiEventPrefill | null,
): FormatStep {
  const saved = draft?.formatData ?? null;
  const chosen = prefill?.format ?? saved?.format ?? "stroke_play";
  const defaults = formatDefaults(chosen);
  const sameFormat = saved !== null && saved.format === chosen;

  return {
    format: chosen,
    teamSize: prefill?.teamSize ?? (sameFormat ? saved.teamSize : defaults.teamSize),
    scoringBasis: prefill?.scoringBasis ?? saved?.scoringBasis ?? defaults.scoringBasis,
    handicapAllowancePct:
      prefill?.handicapAllowancePct ??
      (sameFormat ? saved.handicapAllowancePct : defaults.handicapAllowancePct),
    maxScoreRule:
      prefill?.maxScoreRule ?? (sameFormat ? saved.maxScoreRule : defaults.maxScoreRule),
    maxScoreFixedCap:
      prefill?.maxScoreFixedCap ??
      (sameFormat ? saved.maxScoreFixedCap : null),
    tiebreakMethod:
      prefill?.tiebreakMethod ??
      (sameFormat ? saved.tiebreakMethod : defaults.tiebreakMethod),
  };
}
