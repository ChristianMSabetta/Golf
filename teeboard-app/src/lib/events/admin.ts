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
  SCORING_BASES,
  WIZARD_FORMATS,
} from "./schema";

/**
 * Pure event-admin logic (M4-T008): the Settings-step Zod contract, the
 * CHANGE confirmation guard for format edits on live (published) events, and
 * the tab registry. No I/O, no server imports — unit-testable without mocks,
 * identical client/server.
 *
 * Scoring math stays in @/lib/scoring; nothing here recomputes an allowance
 * or a payout. The WHS defaults surfaced on format change derive from
 * formatDefaults() exactly like the wizard's Format step.
 */

/** The tab ids of the event admin page, in rail order. */
export const EVENT_ADMIN_TABS = [
  { id: "overview", label: "Overview" },
  { id: "players", label: "Players" },
  { id: "groups", label: "Groups" },
  { id: "settings", label: "Settings" },
] as const;

export type EventAdminTabId = (typeof EVENT_ADMIN_TABS)[number]["id"];

export const EVENT_ADMIN_TAB_IDS: readonly EventAdminTabId[] =
  EVENT_ADMIN_TABS.map((tab) => tab.id);

/** Resolves a `?tab=` param onto a known tab (unknown → Overview). */
export function tabFromParams(raw: string | undefined): EventAdminTabId {
  return (EVENT_ADMIN_TAB_IDS as readonly string[]).includes(raw ?? "")
    ? (raw as EventAdminTabId)
    : "overview";
}

// ─── Status helpers ─────────────────────────────────────────────────────────

export type EventStatus =
  | "draft"
  | "scheduled"
  | "live"
  | "completed"
  | "archived";

export const STATUS_LABELS: Record<EventStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  live: "Live",
  completed: "Completed",
  archived: "Archived",
};

/**
 * An event is "live" (published) once it has left the draft state — the
 * settings surface treats every non-draft status as published, because the
 * short code, scorer PIN, and group tokens are all in the world already.
 */
export function isPublishedStatus(status: EventStatus): boolean {
  return status !== "draft";
}

/** MM/DD/YYYY for an ISO date — matches the events list format. */
export function formatEventDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${month}/${day}/${year}`;
}

// ─── The CHANGE confirmation ─────────────────────────────────────────────────

/**
 * The exact string a staff member must type to change the scoring format of
 * a live (published) event. Enforced server-side in saveEventSettings —
 * the client gate is a convenience, never the safeguard itself.
 */
export const FORMAT_CHANGE_CONFIRMATION = "CHANGE";

/**
 * Whether a format change on an event with this status requires the typed
 * CHANGE confirmation. Drafts are free to change — nothing has been
 * published against them yet.
 */
export function formatChangeNeedsConfirmation(status: EventStatus): boolean {
  return isPublishedStatus(status);
}

/** The confirmation check itself: exact, case-sensitive. */
export function isFormatChangeConfirmed(confirm: string): boolean {
  return confirm.trim() === FORMAT_CHANGE_CONFIRMATION;
}

// ─── Settings payload ────────────────────────────────────────────────────────

function text(max: number, message: string) {
  return z.string().trim().min(1, message).max(max, `Use ${max} characters or fewer.`);
}

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

/**
 * The Settings tab's editable configuration. This is the wizard's Basics +
 * Format contract reshaped for the admin page: the fields staff reasonably
 * change mid-event, with the format block (scoring format through
 * tiebreak) guarded by the CHANGE confirmation when the event is live.
 */
export const eventSettingsSchema = z
  .object({
    name: text(EVENT_NAME_MAX, "Enter the event's name."),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the event's date."),
    holesCount: z.coerce
      .number()
      .int()
      .refine(
        (v): v is (typeof EVENT_HOLES_COUNTS)[number] =>
          (EVENT_HOLES_COUNTS as readonly number[]).includes(v),
        "Choose 9 or 18 holes.",
      ),
    nineOption: z.enum(EVENT_NINE_OPTIONS, "Choose the front or back nine."),
    rounds: z.coerce
      .number()
      .int()
      .refine(
        (v): v is (typeof EVENT_ROUNDS)[number] =>
          (EVENT_ROUNDS as readonly number[]).includes(v),
        "Choose 1 or 2 rounds.",
      ),
    startType: z.enum(
      EVENT_START_TYPES,
      "Choose tee times or a shotgun start.",
    ),
    format: z.enum(WIZARD_FORMATS, "Choose a scoring format."),
    teamSize: z.coerce
      .number()
      .int()
      .min(1, "Team size is at least 1 (individual play).")
      .max(4, "Team size is at most 4 per side."),
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
    maxScoreRule: z.enum(
      ["none", "fixed", "double_par", "net_double_bogey"] as const,
      "Choose a maximum-score rule.",
    ),
    maxScoreFixedCap: optionalDecimalCell(),
    tiebreakMethod: z.enum(
      ["card_off", "none"] as const,
      "Choose a tiebreak method.",
    ),
    welcomeMessage: z
      .string()
      .trim()
      .max(2000, "Use 2000 characters or fewer."),
    isPublic: z.boolean(),
  })
  .superRefine((settings, ctx) => {
    if (settings.maxScoreRule === "fixed") {
      const cap = settings.maxScoreFixedCap;
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
    } else if (settings.maxScoreFixedCap !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["maxScoreFixedCap"],
        message: "Clear the fixed cap — it only applies to the fixed rule.",
      });
    }

    const individual: readonly string[] = ["stroke_play", "stableford"];
    if (individual.includes(settings.format) && settings.teamSize > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["teamSize"],
        message:
          "Stroke play and Stableford are individual — keep the team size at 1.",
      });
    }
    if (!individual.includes(settings.format) && settings.teamSize < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["teamSize"],
        message: `${settings.format.replace("_", " ")} needs at least 2 players per team.`,
      });
    }
  });

export type EventSettings = z.output<typeof eventSettingsSchema>;
