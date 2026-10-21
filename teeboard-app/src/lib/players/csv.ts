import {
  PLAYER_CSV_COLUMNS,
  csvRowSchema,
  type CsvRow,
  type PlayerRow,
} from "./schema";

/**
 * Pure CSV helpers for the player list (M4-T002): an RFC-4180-ish parser
 * (quoted fields, escaped quotes, CRLF/CR/LF) that maps header names onto
 * the expected columns, and a serializer for exports. No I/O, no server
 * imports — importable anywhere and unit-testable without mocks.
 */

// ─── Header normalization ─────────────────────────────────────────────────────

/**
 * Accepted header spellings per column. Real-world club exports shuffle
 * and rename columns ("Player", "Golfer Name", "HI", "HCP", "WHS #"), so
 * the import path stays forgiving: unknown-but-plausible headers map by
 * keyword, totally unrecognized columns are ignored (they'd otherwise
 * reject every real-world file).
 */
const HEADER_ALIASES: Record<string, readonly string[]> = {
  full_name: [
    "full_name",
    "fullname",
    "name",
    "player",
    "player name",
    "playername",
    "golfer",
    "golfer name",
    "member",
    "member name",
  ],
  email: ["email", "email address", "e-mail", "mail"],
  phone: ["phone", "phone number", "mobile", "cell", "telephone", "tel"],
  gender: ["gender", "sex", "tee", "tee gender"],
  handicap_index: [
    "handicap_index",
    "handicap",
    "handicapindex",
    "hi",
    "hcp",
    "handicap index",
    "whs handicap",
    "index",
  ],
  whs_number: ["whs_number", "whs", "whs no", "whs num", "whs#", "number", "ghin", "ghin #"],
};

/** Normalizes a raw header cell: lowercase, trimmed, punctuation squashed. */
function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, " ")
    .replace(/[.]+$/, "");
}

/** Maps a raw header cell to a canonical column, or null when unknown. */
export function headerToColumn(raw: string): string | null {
  const normalized = normalizeHeader(raw);
  if (normalized === "") return null;
  for (const [column, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalized)) return column;
  }
  // Keyword fallback for spellings the alias list doesn't carry verbatim.
  if (normalized.includes("name") && !normalized.includes("user")) return "full_name";
  if (normalized.includes("mail")) return "email";
  if (normalized.includes("phone") || normalized.includes("mobile")) return "phone";
  if (normalized.includes("gender") || normalized === "sex") return "gender";
  if (normalized.includes("handicap") || normalized === "hi" || normalized === "hcp") {
    return "handicap_index";
  }
  if (normalized.includes("whs") || normalized.includes("ghin")) return "whs_number";
  return null;
}

/**
 * Whether a raw header row looks like a header at all (vs. a file that
 * starts straight with data). Heuristic: any recognized column wins.
 */
export function isHeaderRow(cells: readonly string[]): boolean {
  return cells.some((cell) => headerToColumn(cell) !== null);
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/** Splits CSV text into lines honoring quoted embeds. */
export function parseCsvText(text: string): readonly string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === "," || char === ";" || char === "\t") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      row.push(field);
      field = "";
      if (char === "\r" && next === "\n") i += 1;
      if (row.some((cell) => cell !== "")) {
        rows.push(row);
      }
      row = [];
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((cell) => cell !== "")) {
    rows.push(row);
  }

  return rows;
}

export type ParsedCsvRow = {
  readonly ok: true;
  readonly rowNumber: number;
  readonly row: CsvRow;
};

export type RejectedCsvRow = {
  readonly ok: false;
  readonly rowNumber: number;
  readonly raw: readonly string[];
  readonly messages: readonly string[];
};

export type ParsedCsvResult = {
  /** Line 1 of the file, whether or not it carried headers. */
  readonly hadHeader: boolean;
  /** Data rows that passed the shared csvRowSchema. */
  readonly parsed: readonly ParsedCsvRow[];
  /** Data rows that failed, with every validation message. */
  readonly rejected: readonly RejectedCsvRow[];
};

/**
 * Parses CSV text into schema-valid player rows plus per-row rejections.
 * `rowNumber` counts source lines (the header is line 1), so a rejected
 * row's flag matches the line the user sees in their spreadsheet.
 */
export function parsePlayersCsv(text: string): ParsedCsvResult {
  const lines = parseCsvText(text);
  const parsed: ParsedCsvRow[] = [];
  const rejected: RejectedCsvRow[] = [];

  let start = 0;
  // CSV column → csvRowSchema field (camelCase).
  const headerMap = new Map<number, string>();
  let hadHeader = false;

  if (lines.length > 0 && isHeaderRow(lines[0]!)) {
    hadHeader = true;
    lines[0]!.forEach((cell, i) => {
      const column = headerToColumn(cell);
      if (column && !headerMap.has(i)) headerMap.set(i, column);
    });
    start = 1;
  }

  for (let i = start; i < lines.length; i += 1) {
    const cells = lines[i]!;
    const rowNumber = i + 1;

    const raw: Record<string, string> = {};
    if (hadHeader) {
      for (const [index, column] of headerMap) {
        const value = cells[index];
        if (value !== undefined) raw[column] = value;
      }
      raw.full_name ??= cells[0] ?? "";
    } else {
      // Positional fallback: name, email, phone, gender, HI, WHS #.
      raw.full_name = cells[0] ?? "";
      raw.email = cells[1] ?? "";
      raw.phone = cells[2] ?? "";
      raw.gender = cells[3] ?? "";
      raw.handicap_index = cells[4] ?? "";
      raw.whs_number = cells[5] ?? "";
    }

    const result = csvRowSchema.safeParse({
      rowNumber,
      fullName: raw.full_name ?? "",
      email: raw.email ?? "",
      phone: raw.phone ?? "",
      gender: raw.gender ?? "",
      handicapIndex: raw.handicap_index ?? "",
      whsNumber: raw.whs_number ?? "",
    });

    if (result.success) {
      parsed.push({ ok: true, rowNumber, row: result.data });
    } else {
      rejected.push({
        ok: false,
        rowNumber,
        raw: cells,
        messages: result.error.issues.map((issue) => issue.message),
      });
    }
  }

  return { hadHeader, parsed, rejected };
}

// ─── Serializer ──────────────────────────────────────────────────────────────

/** Escapes one CSV cell for RFC-4180 output. */
function escapeCell(value: string): string {
  if (/[",;\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Serializes the player list for export, in the canonical column order —
 * the exact headers `parsePlayersCsv` accepts on import.
 */
export function serializePlayersCsv(
  players: readonly (Pick<
    PlayerRow,
    "fullName" | "email" | "phone" | "gender" | "handicapIndex" | "whsNumber"
  >)[],
): string {
  const header = PLAYER_CSV_COLUMNS.join(",");
  const lines = players.map((player) =>
    [
      player.fullName,
      player.email ?? "",
      player.phone ?? "",
      player.gender ?? "",
      player.handicapIndex === null ? "" : String(player.handicapIndex),
      player.whsNumber ?? "",
    ]
      .map((cell) => escapeCell(String(cell)))
      .join(","),
  );
  return [header, ...lines].join("\r\n");
}
