import { z } from "zod";
import {
  CARD_OFF_LAST_HOLES_STAGES,
  DEFAULT_MAX_TEAM_SIZE,
  DEFAULT_MIN_TEAM_SIZE,
  FOUR_BALL_DEFAULT_ALLOWANCE,
  NET_COMPETITION_DEFAULT_ALLOWANCE,
  NET_DOUBLE_BOGEY_STROKES_OVER_PAR,
} from "@/lib/scoring";

/**
 * Shared client/server contract for the event creation wizard (M4-T003).
 *
 * The wizard's Basics and Format steps validate against these single
 * schemas — the step forms client-side and the autosave server action
 * server-side — so what staff confirm in the browser is exactly what the
 * database enforces. WHS defaults are derived from @teeboard/scoring's
 * constants, never duplicated here.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const EVENT_NAME_MAX = 160;
export const EVENT_HOLES_COUNTS = [9, 18] as const;
export type EventHolesCount = (typeof EVENT_HOLES_COUNTS)[number];

/** A 9-hole round plays either the front (1–9) or back (10–18) nine. */
export const EVENT_NINE_OPTIONS = ["front", "back"] as const;
export type EventNineOption = (typeof EVENT_NINE_OPTIONS)[number];

export const EVENT_ROUNDS = [1, 2] as const;
export type EventRounds = (typeof EVENT_ROUNDS)[number];

export const EVENT_START_TYPES = ["tee_times", "shotgun"] as const;
export type EventStartType = (typeof EVENT_START_TYPES)[number];

/** The five formats the wizard's Format step offers. */
export const WIZARD_FORMATS = [
  "stroke_play",
  "scramble",
  "best_ball",
  "stableford",
  "shamble",
] as const;
export type WizardFormat = (typeof WIZARD_FORMATS)[number];

export const SCORING_BASES = ["gross", "net", "both"] as const;
export type ScoringBasisKind = (typeof SCORING_BASES)[number];

export const MAX_SCORE_RULES = [
  "none",
  "fixed",
  "double_par",
  "net_double_bogey",
] as const;
export type MaxScoreRuleKind = (typeof MAX_SCORE_RULES)[number];

export const TIEBREAK_METHODS = ["card_off", "none"] as const;
export type TiebreakMethodKind = (typeof TIEBREAK_METHODS)[number];

/** Fixed-cap bounds when `maxScoreRule` is `fixed`. */
export const MAX_SCORE_CAP_MIN = 2;
export const MAX_SCORE_CAP_MAX = 20;

/** Allowance percentage bounds (100 = full strokes). */
export const ALLOWANCE_PCT_MIN = 0;
export const ALLOWANCE_PCT_MAX = 100;

// ─── WHS defaults, derived from the scoring package ──────────────────────────

/**
 * The WHS handicap-allowance default per format, as a percentage (95 for
 * 0.95). Sourced from @teeboard/scoring's Rules of Handicapping 5.5
 * constants so the wizard and the scoring engine can never disagree.
 * Scramble/shamble allowances vary by local custom (there is no WHS
 * prescribed value), so the four-ball default is a reasonable starting
 * point the staff member can adjust.
 */
export const WHS_DEFAULT_ALLOWANCE_PCT: Record<
  WizardFormat,
  number
> = {
  stroke_play: NET_COMPETITION_DEFAULT_ALLOWANCE * 100,
  stableford: NET_COMPETITION_DEFAULT_ALLOWANCE * 100,
  best_ball: FOUR_BALL_DEFAULT_ALLOWANCE * 100,
  scramble: FOUR_BALL_DEFAULT_ALLOWANCE * 100,
  shamble: FOUR_BALL_DEFAULT_ALLOWANCE * 100,
};

/** Default team size per format (1 = individual play). */
export const DEFAULT_TEAM_SIZE: Record<WizardFormat, number> = {
  stroke_play: 1,
  stableford: 1,
  best_ball: DEFAULT_MIN_TEAM_SIZE,
  scramble: DEFAULT_MIN_TEAM_SIZE,
  shamble: DEFAULT_MIN_TEAM_SIZE,
};

/** Default maximum-score rule per format (WHS net double Bogey, RoH 3.3b). */
export const DEFAULT_MAX_SCORE_RULE: Record<WizardFormat, MaxScoreRuleKind> = {
  stroke_play: "net_double_bogey",
  stableford: "none",
  best_ball: "net_double_bogey",
  scramble: "none",
  shamble: "none",
};

/** USGA card-off tiebreak stages, surfaced for the Format step's help text. */
export const CARD_OFF_STAGES = CARD_OFF_LAST_HOLES_STAGES;
/** Net double bogey = par + 2 + strokes received (RoH 3.3b). */
export const NET_DOUBLE_BOGEY_OVER_PAR = NET_DOUBLE_BOGEY_STROKES_OVER_PAR;

/**
 * The Format step's defaults for a chosen format — every value derived
 * from @teeboard/scoring constants (WHS allowances, team-size bounds) so
 * the wizard pre-fills exactly what the scoring engine would assume.
 */
export function formatDefaults(format: WizardFormat): {
  format: WizardFormat;
  teamSize: number;
  scoringBasis: ScoringBasisKind;
  handicapAllowancePct: number;
  maxScoreRule: MaxScoreRuleKind;
  tiebreakMethod: TiebreakMethodKind;
} {
  return {
    format,
    teamSize: DEFAULT_TEAM_SIZE[format],
    scoringBasis: "both",
    handicapAllowancePct: WHS_DEFAULT_ALLOWANCE_PCT[format],
    maxScoreRule: DEFAULT_MAX_SCORE_RULE[format],
    tiebreakMethod: "card_off",
  };
}

// ─── Cells ───────────────────────────────────────────────────────────────────

function text(max: number, message: string) {
  return z.string().trim().min(1, message).max(max, `Use ${max} characters or fewer.`);
}

/**
 * Optional decimal cell: "" / null / undefined mean "not set" → null;
 * otherwise a number with at most one decimal place.
 */
function optionalDecimalCell() {
  return z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((raw): number | null | typeof NaN => {
      if (raw === null || raw === undefined) return null;
      if (typeof raw === "number") return raw;
      const trimmed = raw.trim();
      if (trimmed === "") return null;
      const parsed = Number(trimmed);
      return Number.isNaN(parsed) ? NaN : parsed;
    });
}

// ─── Step 1: Basics ───────────────────────────────────────────────────────────

export const basicsStepSchema = z.object({
  name: text(EVENT_NAME_MAX, "Enter the event's name."),
  /** ISO date (YYYY-MM-DD); the date input's native format. */
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the event's date."),
  courseId: z.string().min(1, "Choose the course the event plays."),
  holesCount: z.coerce
    .number()
    .int()
    .refine(
      (v): v is EventHolesCount => (EVENT_HOLES_COUNTS as readonly number[]).includes(v),
      "Choose 9 or 18 holes.",
    ),
  nineOption: z.enum(EVENT_NINE_OPTIONS, "Choose the front or back nine."),
  rounds: z.coerce
    .number()
    .int()
    .refine(
      (v): v is EventRounds => (EVENT_ROUNDS as readonly number[]).includes(v),
      "Choose 1 or 2 rounds.",
    ),
  startType: z.enum(
    EVENT_START_TYPES,
    "Choose tee times or a shotgun start.",
  ),
});

export type BasicsStep = z.output<typeof basicsStepSchema>;

// ─── Step 2: Format ───────────────────────────────────────────────────────────

export const formatStepSchema = z
  .object({
    format: z.enum(WIZARD_FORMATS, "Choose a scoring format."),
    teamSize: z.coerce
      .number()
      .int()
      .min(1, `Team size is at least 1 (individual play).`)
      .max(
        DEFAULT_MAX_TEAM_SIZE,
        `Team size is at most ${DEFAULT_MAX_TEAM_SIZE} per side.`,
      ),
    scoringBasis: z.enum(SCORING_BASES, "Choose gross, net, or both."),
    handicapAllowancePct: optionalDecimalCell().superRefine((value, ctx) => {
      if (value === null) {
        ctx.addIssue({
          code: "custom",
          message: "Enter the handicap allowance percentage.",
        });
      } else if (Number.isNaN(value)) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a number, e.g. 95.",
        });
      } else if (value < ALLOWANCE_PCT_MIN || value > ALLOWANCE_PCT_MAX) {
        ctx.addIssue({
          code: "custom",
          message: `Allowance is between ${ALLOWANCE_PCT_MIN} and ${ALLOWANCE_PCT_MAX} percent.`,
        });
      } else if (Math.round(value * 10) !== value * 10) {
        ctx.addIssue({
          code: "custom",
          message: "Use at most one decimal place (e.g. 95).",
        });
      }
    }),
    maxScoreRule: z.enum(MAX_SCORE_RULES, "Choose a maximum-score rule."),
    /** Required when (and only when) `maxScoreRule` is `fixed`. */
    maxScoreFixedCap: optionalDecimalCell(),
    tiebreakMethod: z.enum(TIEBREAK_METHODS, "Choose a tiebreak method."),
  })
  .superRefine((step, ctx) => {
    if (step.maxScoreRule === "fixed") {
      const cap = step.maxScoreFixedCap;
      if (cap === null) {
        ctx.addIssue({
          code: "custom",
          path: ["maxScoreFixedCap"],
          message: "Enter the fixed maximum score per hole.",
        });
      } else if (Number.isNaN(cap)) {
        ctx.addIssue({
          code: "custom",
          path: ["maxScoreFixedCap"],
          message: "Enter a number of strokes.",
        });
      } else if (
        !Number.isInteger(cap) ||
        cap < MAX_SCORE_CAP_MIN ||
        cap > MAX_SCORE_CAP_MAX
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["maxScoreFixedCap"],
          message: `The fixed cap is a whole number between ${MAX_SCORE_CAP_MIN} and ${MAX_SCORE_CAP_MAX}.`,
        });
      }
    } else if (step.maxScoreFixedCap !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["maxScoreFixedCap"],
        message: "Clear the fixed cap — it only applies to the fixed rule.",
      });
    }

    // Team play (2+) requires a team format; the individual formats stay 1.
    const individual: readonly WizardFormat[] = ["stroke_play", "stableford"];
    if (individual.includes(step.format) && step.teamSize > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["teamSize"],
        message: "Stroke play and Stableford are individual — keep the team size at 1.",
      });
    }
    if (!individual.includes(step.format) && step.teamSize < DEFAULT_MIN_TEAM_SIZE) {
      ctx.addIssue({
        code: "custom",
        path: ["teamSize"],
        message: `${step.format.replace("_", " ")} needs at least ${DEFAULT_MIN_TEAM_SIZE} players per team.`,
      });
    }
  });

export type FormatStep = z.output<typeof formatStepSchema>;

// ─── Action state ─────────────────────────────────────────────────────────────

export type WizardActionState = {
  readonly error?: string;
  readonly fields?: Record<string, string>;
  /** The persisted event id, set once the first autosave creates the draft. */
  readonly eventId?: string;
  readonly saved?: boolean;
  /** ISO timestamp of the last successful server persist. */
  readonly savedAt?: string;
};

/** Step ids in wizard order; `basics` and `format` are implemented in M4-T003. */
export const WIZARD_STEPS = [
  {
    id: "basics",
    label: "Basics",
    description: "Name, date, course, holes, rounds, and start type.",
    implemented: true,
  },
  {
    id: "format",
    label: "Format",
    description: "Scoring format, teams, allowances, max score, tiebreak.",
    implemented: true,
  },
  {
    id: "players",
    label: "Players",
    description: "Import the field — CSV, club database, or by hand.",
    implemented: false,
  },
  {
    id: "groups",
    label: "Groups & teams",
    description: "Pairings, shotgun holes, and cart numbers.",
    implemented: false,
  },
  {
    id: "extras",
    label: "Extras & publish",
    description: "Flights, side games, payouts, sponsors, and publishing.",
    implemented: false,
  },
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number]["id"];

export const WIZARD_STEP_IDS: readonly WizardStepId[] = WIZARD_STEPS.map(
  (step) => step.id,
);
