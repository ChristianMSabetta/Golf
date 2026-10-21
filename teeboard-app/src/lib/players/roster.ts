import { parseCsvText, parsePlayersCsv } from "./csv";
import { handicapCellSchema, type PlayerRow } from "./schema";

/**
 * Pure roster logic for the wizard's Players step (M4-T005): turning a
 * CSV/Excel export, the club player database, and one-at-a-time manual
 * entries into a single deduplicated, per-row-validated preview the staff
 * member confirms before anything touches the database — plus the row
 * shapes the server action commits and the dedupe/report helpers it uses.
 * No I/O, no server imports — importable anywhere, unit-testable without
 * mocks, identical client/server.
 */

// ─── Roster row contract ─────────────────────────────────────────────────────

/** The three Players-step input paths. */
export const ROSTER_SOURCES = ["csv", "club", "manual"] as const;
export type RosterSource = (typeof ROSTER_SOURCES)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+()\-.\s0-9]{5,25}$/;
const WHS_RE = /^[A-Za-z0-9-]{3,20}$/;

/**
 * One player in the staged event roster. All fields come normalized: email
 * lowercased or null, handicap as a number inside the WHS bounds (−5…54, one
 * decimal) or null, gender mens/womens or null. `source` says which input
 * path contributed the row; `playerId` is set only when the club database
 * already knows the player (picker rows attach directly, CSV/manual rows
 * upsert into the club database on commit).
 */
export type RosterRow = {
  readonly source: RosterSource;
  readonly playerId: string | null;
  readonly fullName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly gender: "mens" | "womens" | null;
  readonly handicapIndex: number | null;
  readonly whsNumber: string | null;
};

/** One actionable validation problem on a staged row. */
export type RosterIssue = {
  readonly field: "fullName" | "email" | "phone" | "gender" | "handicapIndex" | "whsNumber";
  readonly message: string;
};

export type RosterEntry = {
  /** Stable preview identity: the roster key (plus source line for CSV). */
  readonly key: string;
  readonly source: RosterSource;
  readonly row: RosterRow;
  readonly issues: readonly RosterIssue[];
};

// ─── Identity key ─────────────────────────────────────────────────────────────

/**
 * The roster identity: trimmed name + lowercased email — the same key the
 * M4-T002 duplicate detector uses, so a player imported here matches their
 * existing club row instead of duplicating it.
 */
export function rosterKey(name: string, email: string | null): string {
  return `${name.trim().toLowerCase()}|${(email ?? "").trim().toLowerCase()}`;
}

/** The roster key of a validated row. */
export function rosterRowKey(row: Pick<RosterRow, "fullName" | "email">): string {
  return rosterKey(row.fullName, row.email);
}

// ─── Group tokens ────────────────────────────────────────────────────────────

/** The event_players.group_token contract: 32 lowercase hex characters. */
export const GROUP_TOKEN_LENGTH = 32;

/**
 * Cryptographically random 32-char hex token, matching the group_token
 * check constraint — generated per player only at the server boundary
 * (commit), never client-side, and never from Math.random.
 */
export function newGroupToken(): string {
  const bytes = new Uint8Array(GROUP_TOKEN_LENGTH / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Validation ──────────────────────────────────────────────────────────────

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Validates one raw candidate row (every field stringy; blank ⇒ null) into
 * either a normalized `RosterRow` or its per-field issues in a stable
 * order. Reuses the shared `handicapCellSchema` (WHS bounds, one decimal)
 * so this step and the club table can never disagree on what a handicap is.
 */
export function validateRosterCandidate(
  source: RosterSource,
  candidate: {
    fullName?: string | null;
    email?: string | null;
    phone?: string | null;
    gender?: string | null;
    handicapIndex?: string | number | null;
    whsNumber?: string | null;
  },
): { ok: true; row: RosterRow } | { ok: false; issues: RosterIssue[] } {
  const issues: RosterIssue[] = [];

  const fullName = (candidate.fullName ?? "").trim();
  if (fullName === "") {
    issues.push({ field: "fullName", message: "Enter the player's name." });
  }

  const emailRaw = (candidate.email ?? "").trim();
  let email: string | null = null;
  if (emailRaw !== "") {
    if (EMAIL_RE.test(emailRaw)) {
      email = emailRaw.toLowerCase();
    } else {
      issues.push({
        field: "email",
        message: "Enter a valid email address (or clear it).",
      });
    }
  }

  const phoneRaw = (candidate.phone ?? "").trim();
  let phone: string | null = blankToNull(phoneRaw);
  if (phone !== null && !PHONE_RE.test(phone)) {
    issues.push({
      field: "phone",
      message: "Enter a valid phone number (or clear it).",
    });
    phone = null;
  }

  const genderRaw = (candidate.gender ?? "").trim().toLowerCase();
  let gender: "mens" | "womens" | null = null;
  if (genderRaw === "mens" || genderRaw === "womens") {
    gender = genderRaw;
  } else if (genderRaw !== "") {
    issues.push({
      field: "gender",
      message: "Enter mens or womens (or clear it).",
    });
  }

  const handicap = handicapCellSchema.safeParse(candidate.handicapIndex ?? "");
  let handicapIndex: number | null = null;
  if (handicap.success) {
    handicapIndex = handicap.data;
  } else {
    issues.push({
      field: "handicapIndex",
      message:
        handicap.error.issues[0]?.message ?? "Enter a valid handicap index.",
    });
  }

  const whsRaw = (candidate.whsNumber ?? "").trim();
  let whsNumber: string | null = blankToNull(whsRaw);
  if (whsNumber !== null && !WHS_RE.test(whsNumber)) {
    issues.push({
      field: "whsNumber",
      message: "WHS numbers are 3–20 letters, digits, or dashes.",
    });
    whsNumber = null;
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    row: {
      source,
      playerId: null,
      fullName,
      email,
      phone,
      gender,
      handicapIndex,
      whsNumber,
    },
  };
}

/** The fields of a validated club/CSV row a preview table displays. */
function toRow(source: RosterSource, row: {
  fullName: string;
  email: string | null;
  phone: string | null;
  gender: "mens" | "womens" | null;
  handicapIndex: number | null;
  whsNumber: string | null;
}, playerId: string | null): RosterRow {
  return Object.freeze({
    source,
    playerId,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    gender: row.gender,
    handicapIndex: row.handicapIndex,
    whsNumber: row.whsNumber,
  });
}

// ─── Input paths → staged entries ─────────────────────────────────────────────

/**
 * Parses raw CSV/Excel-export text into staged roster entries. Column
 * mapping is the shared `parsePlayersCsv` auto-detection (renamed/shuffled
 * headers like "Golfer Name", "HI", "E-mail" map without manual fiddling);
 * each staged CSV entry keeps its source line number so a flagged row
 * matches the line the user sees in their spreadsheet.
 */
export function rosterFromCsv(text: string): {
  readonly entries: readonly RosterEntry[];
  readonly rejected: readonly RosterEntry[];
  readonly hadHeader: boolean;
} {
  const parsed = parsePlayersCsv(text);
  const entries: RosterEntry[] = [];
  const rejected: RosterEntry[] = [];

  for (const bad of parsed.rejected) {
    rejected.push({
      key: `csv-line:${bad.rowNumber}`,
      source: "csv",
      row: toRow(
        "csv",
        {
          fullName: bad.raw[0] ?? "",
          email: null,
          phone: null,
          gender: null,
          handicapIndex: null,
          whsNumber: null,
        },
        null,
      ),
      issues: bad.messages.map((message) => ({
        field: "fullName" as const,
        message,
      })),
    });
  }

  for (const { rowNumber, row } of parsed.parsed) {
    entries.push({
      key: `csv-line:${rowNumber}:${rosterKey(row.fullName, row.email)}`,
      source: "csv",
      row: toRow("csv", row, null),
      issues: [],
    });
  }

  return { entries, rejected, hadHeader: parsed.hadHeader };
}

/** Staged entries for players picked from the club database (already valid). */
export function rosterFromClub(
  players: readonly (Pick<
    PlayerRow,
    "id" | "fullName" | "email" | "phone" | "gender" | "handicapIndex" | "whsNumber"
  >)[],
): readonly RosterEntry[] {
  return players.map((player) => ({
    key: rosterKey(player.fullName, player.email),
    source: "club" as const,
    row: toRow("club", player, player.id),
    issues: [] as const,
  }));
}

/** One "add by hand" row from the small form's raw values. */
export function rosterFromManual(candidate: {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  gender?: string | null;
  handicapIndex?: string | null;
  whsNumber?: string | null;
}): { entry: RosterEntry } | { issues: RosterIssue[] } {
  const result = validateRosterCandidate("manual", candidate);
  if (!result.ok) return { issues: result.issues };
  return {
    entry: {
      key: rosterRowKey(result.row),
      source: "manual",
      row: result.row,
      issues: [],
    },
  };
}

// ─── Merging paths into one deduplicated preview ──────────────────────────────

/**
 * Merges staged entries from every input path into one deduplicated
 * roster keyed on the (name, email) identity: the same person arriving by
 * CSV, the club picker, and by hand resolves to a single preview row whose
 * club `playerId` is adopted from whichever path knew it. Dropped repeats
 * land in `duplicates` so the preview can say "already in the list"
 * instead of silently vanishing.
 */
export function mergeRoster(
  ...batches: readonly (readonly RosterEntry[])[]
): RosterPreview {
  // Dedupe keys on the (name, email) identity — a staged entry's display
  // `key` carries source detail (line numbers) that would defeat the merge.
  const byIdentity = new Map<string, RosterEntry>();
  const ordered: RosterEntry[] = [];
  const duplicates: RosterEntry[] = [];

  for (const batch of batches) {
    for (const entry of batch) {
      const identity = rosterRowKey(entry.row);
      const existing = byIdentity.get(identity);
      if (existing === undefined) {
        byIdentity.set(identity, entry);
        ordered.push(entry);
        continue;
      }
      // Adopt the club player id when the repeat is the picked club row.
      if (entry.row.playerId !== null && existing.row.playerId === null) {
        const merged: RosterEntry = Object.freeze({
          ...existing,
          row: Object.freeze({ ...existing.row, playerId: entry.row.playerId }),
        });
        byIdentity.set(identity, merged);
        const index = ordered.indexOf(existing);
        if (index >= 0) ordered[index] = merged;
      }
      duplicates.push(entry);
    }
  }

  return Object.freeze({
    entries: Object.freeze(ordered),
    rejected: [],
    duplicates: Object.freeze(duplicates),
  });
}

export type RosterPreview = {
  /** Rows ready to attach, in input order, deduplicated by identity. */
  readonly entries: readonly RosterEntry[];
  /** Kept structurally empty by mergeRoster; rejected CSV rows ride `duplicates`. */
  readonly rejected: readonly RosterEntry[];
  /** Rows dropped as repeats of an already-staged identity. */
  readonly duplicates: readonly RosterEntry[];
};

/**
 * The commit payload from a preview: attach rows (skipped identities
 * excluded) plus the skipped rows for the report. Pure — the server action
 * generates tokens and performs every write.
 */
export function commitPlan(
  preview: RosterPreview,
  skip: ReadonlySet<string>,
): {
  readonly attach: readonly RosterRow[];
  readonly skipped: readonly RosterRow[];
} {
  const attach: RosterRow[] = [];
  const skipped: RosterRow[] = [];
  for (const entry of preview.entries) {
    const identity = rosterRowKey(entry.row);
    if (skip.has(identity) || skip.has(entry.key)) {
      skipped.push(entry.row);
      continue;
    }
    attach.push(entry.row);
  }
  return { attach: Object.freeze(attach), skipped: Object.freeze(skipped) };
}

/** Quick line count for the import summary line. */
export function csvLineCount(text: string): number {
  return parseCsvText(text).length;
}
