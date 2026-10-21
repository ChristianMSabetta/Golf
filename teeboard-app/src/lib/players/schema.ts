import { z } from "zod";

/**
 * Shared client/server contract for the club player database (M4-T002):
 * table rows with event aggregates, inline handicap-index edits, the CSV
 * import/export format, and the search/filter query parameters. The table
 * and the import server action validate against these single schemas, so
 * what staff confirm client-side is exactly what the server enforces.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * WHS handicap-index bounds, mirroring the players table check constraint
 * (`handicap_index between -5 and 54`).
 */
export const HANDICAP_INDEX_MIN = -5;
export const HANDICAP_INDEX_MAX = 54;

export const PLAYER_SORT_FIELDS = [
  "full_name",
  "email",
  "handicap_index",
  "event_count",
  "last_event_date",
] as const;
export type PlayerSortField = (typeof PLAYER_SORT_FIELDS)[number];

export const PLAYER_GENDERS = ["mens", "womens"] as const;
export type PlayerGender = (typeof PLAYER_GENDERS)[number];

/** CSV headers exported (and accepted on import) for the player list. */
export const PLAYER_CSV_COLUMNS = [
  "full_name",
  "email",
  "phone",
  "gender",
  "handicap_index",
  "whs_number",
] as const;

// ─── Table row schema ─────────────────────────────────────────────────────────

export const playerRowSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  gender: z.enum(PLAYER_GENDERS).nullable(),
  handicapIndex: z.number().nullable(),
  whsNumber: z.string().nullable(),
  eventCount: z.number(),
  lastEventDate: z.string().nullable(),
});
export type PlayerRow = z.output<typeof playerRowSchema>;

// ─── Inline handicap edit ──────────────────────────────────────────────────────

/**
 * Handicap index cell: blank ("", null, undefined) means "no handicap yet"
 * and is stored as null; anything else parses as a number with one decimal
 * place at most, inside the WHS bounds. Shared by the inline table edit
 * and the CSV import.
 */
export const handicapCellSchema = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((raw): number | null | typeof NaN => {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "number") return raw;
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? NaN : parsed;
  })
  .superRefine((value, ctx) => {
    if (value === null) return;
    if (Number.isNaN(value)) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a number, e.g. 12.4.",
      });
    } else if (value < HANDICAP_INDEX_MIN || value > HANDICAP_INDEX_MAX) {
      ctx.addIssue({
        code: "custom",
        message: `Handicap index must be between ${HANDICAP_INDEX_MIN} and ${HANDICAP_INDEX_MAX}.`,
      });
    } else if (Math.round(value * 10) !== value * 10) {
      ctx.addIssue({
        code: "custom",
        message: "Use at most one decimal place (e.g. 12.4).",
      });
    }
  });

export const handicapEditSchema = z.object({
  playerId: z.string(),
  handicapIndex: handicapCellSchema,
});
export type HandicapEdit = z.output<typeof handicapEditSchema>;

// ─── Search / sort query ──────────────────────────────────────────────────────

export const playerListParamsSchema = z.object({
  search: z.string().trim().default(""),
  sort: z.enum(PLAYER_SORT_FIELDS).default("full_name"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});
export type PlayerListParams = z.output<typeof playerListParamsSchema>;

// ─── CSV import / export ───────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+()\-.\s0-9]{5,25}$/;
const WHS_RE = /^[A-Za-z0-9-]{3,20}$/;

/**
 * One CSV import row. All fields arrive as strings (or blank), are
 * normalized here, and validated by this schema before any database write.
 * `rowNumber` is the source line (1-based, counting the header) so import
 * errors can be flagged per row.
 */
export const csvRowSchema = z.object({
  rowNumber: z.number().int().min(1),
  fullName: z.string().trim().min(1, "Enter the player's name."),
  email: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || EMAIL_RE.test(v),
      "Enter a valid email address.",
    )
    .transform((v) => (v === "" ? null : v.toLowerCase())),
  phone: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || PHONE_RE.test(v),
      "Enter a valid phone number (or leave it blank).",
    )
    .transform((v) => (v === "" ? null : v)),
  gender: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || PLAYER_GENDERS.includes(v.toLowerCase() as PlayerGender),
      "Enter mens or womens (or leave it blank).",
    )
    .transform((v) => (v === "" ? null : (v.toLowerCase() as PlayerGender))),
  handicapIndex: handicapCellSchema,
  whsNumber: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || WHS_RE.test(v),
      "WHS numbers are 3–20 letters, digits, or dashes.",
    )
    .transform((v) => (v === "" ? null : v)),
});
export type CsvRow = z.output<typeof csvRowSchema>;

// ─── Duplicates & merge ───────────────────────────────────────────────────────

export type DuplicateGroup = {
  readonly key: string;
  readonly fullName: string;
  readonly email: string | null;
  readonly players: readonly PlayerRow[];
};

export type PlayersActionState = {
  readonly error?: string;
  readonly saved?: boolean;
  readonly message?: string;
};

export const PLAYER_SAVED_MESSAGE = "Saved.";
export const PLAYER_MERGE_SAVED_MESSAGE = "Players merged.";
