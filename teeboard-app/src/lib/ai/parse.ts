import { aiEventPrefillSchema, type AiEventPrefill } from "./schema";

/**
 * Pure model-output parsing (M4-T004): pulls the JSON object out of raw
 * Claude text (code fences and stray prose are tolerated) and Zod-validates
 * it against the wizard's pre-fill contract. Also extracts the text blocks
 * from a Messages API response body. No I/O — the adapter and the test
 * suite share this.
 */

/** Extracts the text content blocks from a Messages API response body. */
export function textBlocks(body: unknown): string[] {
  const content = (body as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (block): block is { type: string; text?: unknown } =>
        typeof block === "object" && block !== null,
    )
    .filter((block) => block.type === "text")
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .filter((text) => text.length > 0);
}

/** Extracts the outermost JSON object from raw text, or null when absent. */
export function extractJsonCandidate(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

/**
 * Parses raw model text into a validated prefill. Any deviation from the
 * JSON contract — wrapping prose, unknown fields, wrong types — is a
 * parse failure (null) and the wizard falls back to empty.
 */
export function parseModelText(raw: string): AiEventPrefill | null {
  const candidate = extractJsonCandidate(raw);
  if (candidate === null) return null;
  const validated = aiEventPrefillSchema.safeParse(candidate);
  return validated.success ? validated.data : null;
}
