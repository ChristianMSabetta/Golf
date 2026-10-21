import type { HoleRow } from "./schema";

/**
 * "Paste from scorecard" (M4-T001): turns typical printed/scorecard text —
 * multi-line rows of hole number, par, yards, and stroke index, labeled or
 * positional, with headers and prose mixed in — into editor grid rows for
 * the user to confirm. Tolerant by design: header rows, blank lines, and
 * stray words are skipped; nothing is fatal until the schema validates.
 */

export type ParsedScorecard = {
  /** 18 hole rows (1–18) in order; cells the text didn't cover stay null. */
  readonly rows: HoleRow[];
  /** How many input lines were recognized as hole rows. */
  readonly matchedLines: number;
};

/** Column labels mapped to grid fields (case/plural tolerant). */
const COLUMN_LABELS: Record<string, "hole" | "par" | "yards" | "strokeIndex"> = {
  hole: "hole",
  holes: "hole",
  no: "hole",
  num: "hole",
  number: "hole",
  par: "par",
  pars: "par",
  yards: "yards",
  yard: "yards",
  yd: "yards",
  yds: "yards",
  m: "yards",
  meters: "yards",
  si: "strokeIndex",
  hicp: "strokeIndex",
  hcp: "strokeIndex",
  handicap: "strokeIndex",
  stroke: "strokeIndex",
  index: "strokeIndex",
};

/** Known non-data words that are skipped, never fatal. */
const SKIP_WORDS = new Set([
  "out",
  "in",
  "front",
  "back",
  "nine",
  "total",
  "totals",
  "tee",
  "tees",
  "rating",
  "slope",
  "mens",
  "womens",
  "men",
  "women",
  "course",
  "club",
  "blue",
  "white",
  "red",
  "gold",
  "black",
]);

const FIELD_BOUNDS = {
  hole: [1, 18] as const,
  par: [3, 6] as const,
  yards: [0, 800] as const,
  strokeIndex: [1, 18] as const,
};

function normalizeLabel(token: string): string {
  return token
    .replace(/[^a-z]/gi, "")
    .toLowerCase();
}

function isNumeric(token: string): boolean {
  return /^[0-9]+(?:\.[0-9]+)?$/.test(token);
}

type Cell =
  | { type: "label"; field: "hole" | "par" | "yards" | "strokeIndex" }
  | { type: "number"; value: number }
  | { type: "skip" };

function tokenize(line: string): Cell[] {
  const tokens = line
    .replace(/[|·•:;,]/g, " ")
    .replace(/[()]/g, " ")
    .split(/\s+/)
    .filter((t) => t !== "");

  const cells: Cell[] = [];
  for (const token of tokens) {
    if (isNumeric(token)) {
      cells.push({ type: "number", value: Number(token) });
      continue;
    }
    const bare = normalizeLabel(token);
    if (bare === "") {
      // Punctuation-only tokens (--- separators) are skipped.
      cells.push({ type: "skip" });
    } else if (Object.hasOwn(COLUMN_LABELS, bare)) {
      cells.push({ type: "label", field: COLUMN_LABELS[bare]! });
    } else if (SKIP_WORDS.has(bare)) {
      cells.push({ type: "skip" });
    } else {
      return []; // unrecognized word → not a hole row
    }
  }
  return cells;
}

type HoleLine = {
  holeNumber: number;
  par: number | null;
  yards: number | null;
  strokeIndex: number | null;
};

function inBounds(
  field: keyof typeof FIELD_BOUNDS,
  value: number,
): boolean {
  const [min, max] = FIELD_BOUNDS[field];
  return value >= min && value <= max;
}

/**
 * Parses a line with column labels ("Hole 1 Par 4 380 yards SI 7"). Each
 * label consumes the next number after it; numbers not claimed by any label
 * fill the still-empty fields in the canonical printed order (par, yards,
 * stroke index), so mixed layouts keep working.
 */
function parseLabeled(cells: readonly Cell[]): HoleLine | null {
  let par: number | null = null;
  let yards: number | null = null;
  let strokeIndex: number | null = null;
  let holeNumber: number | null = null;

  const consumed = new Set<number>();
  const assign = (field: keyof typeof FIELD_BOUNDS, index: number) => {
    const value = (cells[index] as { type: "number"; value: number }).value;
    if (!inBounds(field, value)) return;
    if (field === "hole") holeNumber = value;
    else if (field === "par") par = value;
    else if (field === "yards") yards = value;
    else strokeIndex = value;
    consumed.add(index);
  };

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i]!;
    if (cell.type !== "label") continue;

    // Both printed orders occur: "Par 4" (label before its value) and
    // "380 yards" (value before its label). Prefer the adjacent
    // unconsumed number on either side.
    const prev = cells[i - 1];
    if (prev && prev.type === "number" && !consumed.has(i - 1)) {
      assign(cell.field, i - 1);
      continue;
    }
    const nextIndex = cells.findIndex(
      (c, j) => j > i && c.type === "number" && !consumed.has(j),
    );
    if (nextIndex !== -1) {
      assign(cell.field, nextIndex);
    }
  }

  // Numbers no label claimed fill the remaining fields in printed order.
  const leftovers = cells
    .map((c, i) => ({ c, i }))
    .filter(
      ({ c, i }) => c.type === "number" && !consumed.has(i),
    )
    .map(({ c }) => (c as { type: "number"; value: number }).value);

  if (holeNumber === null && leftovers.length > 0) {
    const idx = leftovers.findIndex((n) => inBounds("hole", n));
    if (idx !== -1) {
      holeNumber = leftovers[idx]!;
      leftovers.splice(idx, 1);
    }
  }

  if (par === null) {
    const idx = leftovers.findIndex((n) => inBounds("par", n));
    if (idx !== -1) {
      par = leftovers[idx]!;
      leftovers.splice(idx, 1);
    }
  }
  if (yards === null) {
    const idx = leftovers.findIndex((n) => inBounds("yards", n));
    if (idx !== -1) {
      yards = leftovers[idx]!;
      leftovers.splice(idx, 1);
    }
  }
  if (strokeIndex === null) {
    const idx = leftovers.findIndex((n) => inBounds("strokeIndex", n));
    if (idx !== -1) {
      strokeIndex = leftovers[idx]!;
      leftovers.splice(idx, 1);
    }
  }

  if (holeNumber === null) return null;
  return { holeNumber, par, yards, strokeIndex };
}

/** Positional layout: hole, par, [yards], stroke index — 2 to 4 numbers. */
function parsePositional(cells: readonly Cell[]): HoleLine | null {
  const numbers = cells
    .filter((c): c is { type: "number"; value: number } => c.type === "number")
    .map((c) => c.value);

  if (numbers.length < 2 || numbers.length > 4) return null;
  const [first, second, third, fourth] = numbers as [
    number,
    number,
    number?,
    number?,
  ];

  if (!inBounds("hole", first)) return null;
  const holeNumber = first;
  if (!inBounds("par", second)) return null;

  const par: number = second;
  let yards: number | null = null;
  let strokeIndex: number | null = null;

  if (numbers.length === 4) {
    if (third !== undefined && !inBounds("yards", third)) return null;
    if (fourth !== undefined && !inBounds("strokeIndex", fourth)) return null;
    yards = third ?? null;
    strokeIndex = fourth ?? null;
  } else if (numbers.length === 3) {
    // hole, par, si is the common 3-column print; hole, par, yards also
    // exists — decide by range: 1–18 fits both, so prefer stroke index.
    if (third === undefined) return null;
    if (inBounds("strokeIndex", third)) {
      strokeIndex = third;
    } else if (inBounds("yards", third)) {
      yards = third;
    } else {
      return null;
    }
  }

  return { holeNumber, par, yards, strokeIndex };
}

function parseLine(line: string): HoleLine | null {
  const cells = tokenize(line);
  if (cells.length === 0) return null;
  const hasLabel = cells.some((c) => c.type === "label");
  const parsed = hasLabel ? parseLabeled(cells) : parsePositional(cells);
  if (!parsed) return null;
  if (
    parsed.par === null &&
    parsed.yards === null &&
    parsed.strokeIndex === null
  ) {
    return null; // header row like "HOLE PAR YARDS SI"
  }
  return parsed;
}

/**
 * Parses pasted scorecard text into grid rows. Duplicate hole rows keep the
 * last occurrence (a corrected re-paste wins). The result always carries 18
 * slots; holes the text didn't cover stay null for the user to fill in and
 * the schema to flag.
 */
export function parseScorecardText(text: string): ParsedScorecard {
  const byHole = new Map<
    number,
    { par: number | null; yards: number | null; strokeIndex: number | null }
  >();
  let matchedLines = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    matchedLines += 1;
    const existing = byHole.get(parsed.holeNumber) ?? {
      par: null,
      yards: null,
      strokeIndex: null,
    };
    byHole.set(parsed.holeNumber, {
      par: parsed.par ?? existing.par,
      yards: parsed.yards ?? existing.yards,
      strokeIndex: parsed.strokeIndex ?? existing.strokeIndex,
    });
  }

  const rows: HoleRow[] = [];
  for (let holeNumber = 1; holeNumber <= 18; holeNumber += 1) {
    const found = byHole.get(holeNumber);
    rows.push({
      holeNumber,
      par: found?.par ?? null,
      strokeIndex: found?.strokeIndex ?? null,
      yards: found?.yards ?? null,
    });
  }

  return { rows, matchedLines };
}
