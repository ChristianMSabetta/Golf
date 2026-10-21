import { z } from "zod";
import {
  ALLOWANCE_PCT_MAX,
  ALLOWANCE_PCT_MIN,
  EVENT_HOLES_COUNTS,
  EVENT_NAME_MAX,
  EVENT_NINE_OPTIONS,
  EVENT_ROUNDS,
  EVENT_START_TYPES,
  MAX_SCORE_CAP_MAX,
  MAX_SCORE_CAP_MIN,
  MAX_SCORE_RULES,
  SCORING_BASES,
  TIEBREAK_METHODS,
  WIZARD_FORMATS,
} from "@/lib/events/schema";

/**
 * Shared client/server contract for the one-sentence AI event setup
 * (M4-T004). The request shape is validated before any Claude call; the
 * response shape is what the adapter must produce for the wizard to
 * accept it as pre-fill data. The enums deliberately reuse the wizard's
 * step schemas so an AI suggestion can never describe an event the
 * wizard — or the Phase 1 schema — couldn't represent.
 */

// ─── Request ────────────────────────────────────────────────────────────────

export const AI_PARSE_INPUT_MAX = 600;

export const aiParseRequestSchema = z.object({
  /** Free-text event description, e.g. a one-liner from a member. */
  text: z
    .string()
    .trim()
    .min(1, "Describe the event in a sentence or two.")
    .max(
      AI_PARSE_INPUT_MAX,
      `Use ${AI_PARSE_INPUT_MAX} characters or fewer.`,
    ),
});

export type AiParseRequest = z.output<typeof aiParseRequestSchema>;

// ─── Response (Claude → wizard pre-fill) ─────────────────────────────────────

/**
 * Every field is optional: the AI only suggests what the sentence states.
 * Unmentioned fields stay exactly as the wizard left them (empty or at
 * their WHS defaults) — the AI never invents values to fill the grid.
 * Unknown keys are rejected so a drifting model output can never smuggle
 * extra data into the wizard.
 */
export const aiEventPrefillSchema = z.strictObject({
  name: z.string().trim().min(1).max(EVENT_NAME_MAX).optional(),
  /** ISO date (YYYY-MM-DD) resolved from relative wording like "next Saturday". */
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the event's date.")
    .optional(),
  holesCount: z
    .number()
    .int()
    .refine(
      (v): v is (typeof EVENT_HOLES_COUNTS)[number] =>
        (EVENT_HOLES_COUNTS as readonly number[]).includes(v),
      "Choose 9 or 18 holes.",
    )
    .optional(),
  nineOption: z.enum(EVENT_NINE_OPTIONS).optional(),
  rounds: z
    .number()
    .int()
    .refine(
      (v): v is (typeof EVENT_ROUNDS)[number] =>
        (EVENT_ROUNDS as readonly number[]).includes(v),
      "Choose 1 or 2 rounds.",
    )
    .optional(),
  startType: z.enum(EVENT_START_TYPES).optional(),
  format: z.enum(WIZARD_FORMATS).optional(),
  teamSize: z
    .number()
    .int()
    .min(1, `Team size is at least 1 (individual play).`)
    .max(4, `Team size is at most 4 per side.`)
    .optional(),
  scoringBasis: z.enum(SCORING_BASES).optional(),
  handicapAllowancePct: z
    .number()
    .refine(
      (v) => v >= ALLOWANCE_PCT_MIN && v <= ALLOWANCE_PCT_MAX,
      `Allowance is between ${ALLOWANCE_PCT_MIN} and ${ALLOWANCE_PCT_MAX} percent.`,
    )
    .optional(),
  maxScoreRule: z.enum(MAX_SCORE_RULES).optional(),
  maxScoreFixedCap: z
    .number()
    .int()
    .refine(
      (v) => v >= MAX_SCORE_CAP_MIN && v <= MAX_SCORE_CAP_MAX,
      `The fixed cap is a whole number between ${MAX_SCORE_CAP_MIN} and ${MAX_SCORE_CAP_MAX}.`,
    )
    .optional(),
  tiebreakMethod: z.enum(TIEBREAK_METHODS).optional(),
});

export type AiEventPrefill = z.output<typeof aiEventPrefillSchema>;

// ─── Client-facing response ──────────────────────────────────────────────────

/**
 * What the endpoint answers the wizard. On any failure — invalid AI
 * output, timeout, provider error — `prefill` is null and the message
 * says so, so the wizard is left exactly as it was.
 */
export const AI_PARSE_FAILURE_MESSAGE = "Couldn't read that";

export const aiParseResponseSchema = z.union([
  z.strictObject({
    prefill: aiEventPrefillSchema,
    message: z.string().optional(),
  }),
  z.strictObject({
    prefill: z.null(),
    message: z.string(),
  }),
]);

export type AiParseResponse = z.output<typeof aiParseResponseSchema>;
