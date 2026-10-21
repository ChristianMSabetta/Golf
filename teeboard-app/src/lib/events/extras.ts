import { z } from "zod";
import { handicapCellSchema } from "@/lib/players/schema";
import { PAYOUT_PRESET_50_30_20 } from "@/lib/scoring";

/**
 * Pure Extras & publish step logic (M4-T007): the Zod contract for flights,
 * side games, payouts, sponsors, the welcome message, and public visibility,
 * plus the default computations — all derived from @teeboard/scoring — and
 * the publish-time credential builders. No I/O, no server imports —
 * unit-testable without mocks, identical client/server.
 *
 * Scoring math stays in @teeboard/scoring; nothing here recomputes a
 * payout, a flight assignment, or a skin. The share presets are data.
 */

// ─── Flights ─────────────────────────────────────────────────────────────────

export const FLIGHT_NAME_MAX = 60;

export const flightSchema = z.object({
  name: z.string().trim().min(1, "Name the flight.").max(FLIGHT_NAME_MAX, `Use ${FLIGHT_NAME_MAX} characters or fewer.`),
  /**
   * Inclusive maximum handicap index of the flight; null marks the open
   * top flight that absorbs everyone above the last threshold — the exact
   * shape @teeboard/scoring's `assignFlights` consumes.
   */
  maxHandicap: handicapCellSchema,
});

export type FlightDraft = z.output<typeof flightSchema>;

// ─── Side games ──────────────────────────────────────────────────────────────

/** The four side games the Extras step offers, mapped to their DB kinds. */
export const SIDE_GAME_KINDS = ["skins", "closest_to_pin", "long_drive", "longest_putt"] as const;
export type SideGameKind = (typeof SIDE_GAME_KINDS)[number];

export const SIDE_GAME_LABELS: Record<SideGameKind, string> = {
  skins: "Skins",
  closest_to_pin: "Closest to the pin",
  long_drive: "Long drive",
  longest_putt: "Longest putt",
};

export const SKINS_VALUE_MAX = 100_000;

const moneyCell = z
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
      ctx.addIssue({ code: "custom", message: "Enter a number, e.g. 5." });
    } else if (value < 0 || value > SKINS_VALUE_MAX) {
      ctx.addIssue({
        code: "custom",
        message: `Skins value is between 0 and ${SKINS_VALUE_MAX}.`,
      });
    } else if (Math.round(value * 100) !== value * 100) {
      ctx.addIssue({ code: "custom", message: "Use at most two decimals (e.g. 5.50)." });
    }
  });

export const sideGameSchema = z.object({
  kind: z.enum(SIDE_GAME_KINDS),
  holeValue: moneyCell,
  holeValueText: z.string(),
});

export type SideGameDraft = z.output<typeof sideGameSchema>;

/**
 * The step's side-game state: one toggle per kind (the four games are a
 * fixed set), with skins carrying the per-hole value. Validation demands a
 * value on enabled skins and none anywhere else.
 */
export const sideGamesStepSchema = z
  .array(sideGameSchema)
  .superRefine((games, ctx) => {
    const seen = new Set<SideGameKind>();
    for (const [index, game] of games.entries()) {
      if (seen.has(game.kind)) {
        ctx.addIssue({ code: "custom", path: [index, "kind"], message: "Each side game is chosen once." });
        continue;
      }
      seen.add(game.kind);
      if (game.kind === "skins") {
        if (game.holeValue === null || Number.isNaN(game.holeValue)) {
          ctx.addIssue({ code: "custom", path: [index, "holeValue"], message: "Enter the per-hole skins value." });
        }
      } else if (game.holeValue !== null) {
        ctx.addIssue({
          code: "custom",
          path: [index, "holeValue"],
          message: `${SIDE_GAME_LABELS[game.kind]} has no per-hole value — clear it.`,
        });
      }
    }
  });

export type SideGamesStep = z.output<typeof sideGamesStepSchema>;

// ─── Payouts ─────────────────────────────────────────────────────────────────

/** The standard presets, as share tuples — data only, the math lives in @teeboard/scoring. */
export const PAYOUT_PRESETS = [
  { id: "50_30_20", label: "50 / 30 / 20", shares: PAYOUT_PRESET_50_30_20 },
  { id: "50_30_20_2", label: "50 / 30 / 20 (2 spots)", shares: [0.5, 0.3, 0.2] },
  { id: "60_30_10", label: "60 / 30 / 10", shares: [0.6, 0.3, 0.1] },
  { id: "40_30_20_10", label: "40 / 30 / 20 / 10", shares: [0.4, 0.3, 0.2, 0.1] },
] as const;

export type PayoutPresetId = (typeof PAYOUT_PRESETS)[number]["id"];

export const PAYOUT_PRESET_IDS = PAYOUT_PRESETS.map((preset) => preset.id) as readonly PayoutPresetId[];

export const PAYOUT_PURSE_MAX = 1_000_000;

export const payoutStepSchema = z.object({
  presetId: z.enum(PAYOUT_PRESET_IDS, "Choose a payout preset."),
  purse: z.coerce
    .number()
    .int("The purse is whole currency units.")
    .min(0, "The purse is 0 or more.")
    .max(PAYOUT_PURSE_MAX, `The purse is at most ${PAYOUT_PURSE_MAX}.`),
});

export type PayoutStep = z.output<typeof payoutStepSchema>;

// ─── Sponsors ────────────────────────────────────────────────────────────────

/** The club-scoped Supabase Storage bucket sponsor logos live in (public-read). */
export const SPONSOR_BUCKET = "sponsor-logos";

export const SPONSOR_NAME_MAX = 80;
export const SPONSOR_MAX_LOGOS = 8;
export const SPONSOR_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const SPONSOR_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;

export const sponsorRowSchema = z.object({
  name: z.string().trim().min(1, "Name the sponsor.").max(SPONSOR_NAME_MAX, `Use ${SPONSOR_NAME_MAX} characters or fewer.`),
  /** Storage object path under the club-scoped `sponsor-logos` bucket. */
  logoPath: z.string().min(1),
});

export type SponsorDraft = z.output<typeof sponsorRowSchema>;

// ─── The full Extras step contract ───────────────────────────────────────────

export const WELCOME_MESSAGE_MAX = 2000;

export const extrasStepSchema = z
  .object({
    flights: z.array(flightSchema).max(8, "Use at most 8 flights."),
    sideGames: sideGamesStepSchema,
    payouts: payoutStepSchema,
    sponsors: z.array(sponsorRowSchema).max(SPONSOR_MAX_LOGOS, `Upload at most ${SPONSOR_MAX_LOGOS} sponsor logos.`),
    welcomeMessage: z
      .string()
      .trim()
      .max(WELCOME_MESSAGE_MAX, `Use ${WELCOME_MESSAGE_MAX} characters or fewer.`),
    isPublic: z.boolean(),
  })
  .superRefine((step, ctx) => {
    // Flight thresholds are strictly descending and the last flight must be
    // the open top (maxHandicap null) — @teeboard/scoring's assignFlights
    // sorts by threshold, and an open-top-last shape is what it assigns
    // everyone into.
    const enabled = step.flights;
    if (enabled.length > 0) {
      let previous: number | null = null;
      for (const [index, flight] of enabled.slice(0, -1).entries()) {
        const max = flight.maxHandicap;
        if (max === null) {
          ctx.addIssue({
            code: "custom",
            path: ["flights", index, "maxHandicap"],
            message: "Only the last flight may leave the handicap threshold open.",
          });
          continue;
        }
        if (previous !== null && max <= previous) {
          ctx.addIssue({
            code: "custom",
            path: ["flights", index, "maxHandicap"],
            message: "Flight thresholds rise from flight to flight (A below B).",
          });
        }
        previous = max;
      }
      const last = enabled[enabled.length - 1]!;
      if (last.maxHandicap === null && enabled.length === 1) {
        ctx.addIssue({
          code: "custom",
          path: ["flights", enabled.length - 1, "maxHandicap"],
          message: "A single flight is everyone — set a threshold or add flights.",
        });
      }
    }
    if (step.sponsors.length > SPONSOR_MAX_LOGOS) {
      ctx.addIssue({
        code: "custom",
        path: ["sponsors"],
        message: `Upload at most ${SPONSOR_MAX_LOGOS} sponsor logos.`,
      });
    }
  });

export type ExtrasStep = z.output<typeof extrasStepSchema>;

// ─── Defaults ────────────────────────────────────────────────────────────────

/** The WHS-style flight ladder the step suggests (2 flights, open top). */
export function defaultFlights(): FlightDraft[] {
  return [
    { name: "A Flight", maxHandicap: 10 },
    { name: "B Flight", maxHandicap: null },
  ];
}

/** The next flight label in ladder order: A, B, C … Z, then A1, B1 … */
export function flightLabel(count: number): string {
  const letter = String.fromCharCode(65 + (count % 26));
  const cycle = Math.floor(count / 26);
  return cycle === 0 ? letter : `${letter}${cycle}`;
}

// ─── Stored payout columns → step state ──────────────────────────────────────

/**
 * Maps the stored payout columns onto the step state: an unknown preset id
 * (a future/renamed preset) falls back to the standard 50/30/20, and the
 * purse is clamped into the schema's range so a legacy row can never render
 * the step invalid.
 */
export function payoutStepFromStored(
  presetId: string | null,
  purse: number | null,
): PayoutStep {
  const id: PayoutPresetId = (PAYOUT_PRESET_IDS as readonly string[]).includes(
    presetId ?? "",
  )
    ? (presetId as PayoutPresetId)
    : "50_30_20";
  const clamped = Math.min(Math.max(Math.round(purse ?? 0), 0), PAYOUT_PURSE_MAX);
  return { presetId: id, purse: clamped };
}

// ─── Row ↔ state mappers ─────────────────────────────────────────────────────

/** A `side_games` row as the server loads it. */
export type SideGameRow = {
  readonly id: string;
  readonly gameType: string;
  readonly name: string;
  readonly holeValue: number | string | null;
};

/** An `event_flights` row as the server loads it. */
export type EventFlightRow = {
  readonly id: string;
  readonly name: string;
  readonly maxHandicap: number | string | null;
  readonly position: number;
};

/** An `event_sponsors` row as the server loads it. */
export type EventSponsorRow = {
  readonly id: string;
  readonly name: string;
  readonly logoPath: string;
  readonly position: number;
};

function toNumber(raw: number | string | null): number | null {
  if (raw === null) return null;
  return typeof raw === "string" ? Number(raw) : raw;
}

function matchesSideGameKind(value: string): value is SideGameKind {
  return (SIDE_GAME_KINDS as readonly string[]).includes(value);
}

/**
 * Rebuilds the step's side-game state from the persisted rows: only the
 * four kinds the step offers come back (legacy rows from other writers are
 * ignored, not destroyed), and skins keeps its per-hole value.
 */
export function sideGamesFromRows(rows: readonly SideGameRow[]): SideGameDraft[] {
  const drafts: SideGameDraft[] = [];
  for (const row of rows) {
    if (!matchesSideGameKind(row.gameType)) continue;
    const value = row.gameType === "skins" ? toNumber(row.holeValue) : null;
    drafts.push({
      kind: row.gameType,
      holeValue: value,
      holeValueText: value === null ? "" : String(value),
    });
  }
  return drafts;
}

/** Maps the step's side-game state back onto `side_games` rows for persist. */
export function sideGamesToRows(
  eventId: string,
  games: readonly SideGameDraft[],
): readonly {
  readonly event_id: string;
  readonly game_type: SideGameKind;
  readonly name: string;
  readonly hole_value: number | null;
}[] {
  return games.map((game) => ({
    event_id: eventId,
    game_type: game.kind,
    name: SIDE_GAME_LABELS[game.kind],
    hole_value: game.kind === "skins" ? game.holeValue : null,
  }));
}

/** Rebuilds the step's flight state from the persisted rows (position order). */
export function flightsFromRows(rows: readonly EventFlightRow[]): FlightDraft[] {
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((row) => ({ name: row.name, maxHandicap: toNumber(row.maxHandicap) }));
}

/** Rebuilds the step's sponsor list from the persisted rows (position order). */
export function sponsorsFromRows(rows: readonly EventSponsorRow[]): SponsorDraft[] {
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((row) => ({ name: row.name, logoPath: row.logoPath }));
}
