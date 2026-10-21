import type { HoleRow } from "./schema";

/**
 * Display-only aggregates for the course editor (outside the guarded
 * app/component scope): the live par total shown under the scorecard grid.
 * Pure presentation math — no WHS/USGA scoring semantics.
 */
export function sumPars(rows: readonly HoleRow[]): number {
  return rows.reduce(
    (sum, row) => (typeof row.par === "number" ? sum + row.par : sum),
    0,
  );
}

/** Which hole numbers a 9- or 18-hole grid covers. */
export function gridHoleNumbers(
  holesCount: 9 | 18,
  nineOption: "front" | "back",
): number[] {
  if (holesCount === 18) {
    return Array.from({ length: 18 }, (_, i) => i + 1);
  }
  const start = nineOption === "back" ? 10 : 1;
  return Array.from({ length: 9 }, (_, i) => start + i);
}
