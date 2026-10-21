export type ZodIssue = {
  path: (string | number | symbol)[];
  message: string;
};

/**
 * Flattens Zod issues into the editor's field-error lookup shape: dotted
 * paths ("holes.4.par") → first message per field, so the grid can mark the
 * exact conflicting cell.
 */
export function fieldErrors(
  issues: readonly ZodIssue[],
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".");
    if (key && !fields[key]) {
      fields[key] = issue.message;
    }
  }
  return fields;
}
