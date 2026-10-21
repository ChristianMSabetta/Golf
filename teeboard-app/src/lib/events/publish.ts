import { z } from "zod";
import { brand } from "@/lib/brand";

/**
 * Pure publish logic (M4-T007): the short-code alphabet and generator, the
 * scorer PIN contract, and the public/TV/score link builders — plus the
 * publish-step payload schema. The generators take a byte source so the
 * server action injects `node:crypto` randomness (they never call Math.random
 * — access credentials must be unpredictable). No I/O, no server imports.
 */

export const SHORT_CODE_LENGTH = 6;
export const SHORT_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789" as const;
export const SCORER_PIN_LENGTH = 4;
export const GROUP_TOKEN_HEX_LENGTH = 32;

/**
 * Draws `length` characters from `alphabet` using `randomByte()` as the
 * entropy source. Rejection sampling keeps the distribution uniform. A
 * byte ≥ 0 treats every value as a candidate draw.
 */
export function randomCode(
  alphabet: string,
  length: number,
  randomByte: () => number,
): string {
  const out: string[] = [];
  while (out.length < length) {
    const byte = randomByte() & 0xff;
    if (byte < alphabet.length * 8) {
      out.push(alphabet[byte % alphabet.length] ?? "");
    }
  }
  return out.join("");
}

/** A 6-char short code from the URL-safe alphabet (no ambiguous glyphs). */
export function newShortCode(randomByte: () => number): string {
  return randomCode(SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH, randomByte);
}

/** A 4-digit scorer PIN, uniform over 0000–9999 (leading zeros allowed). */
export function newScorerPin(randomByte: () => number): string {
  const digits = randomCode("0123456789", SCORER_PIN_LENGTH, randomByte);
  return digits;
}

/**
 * A 32-char lowercase-hex group token — the exact shape the Phase 1
 * `event_players.group_token` check constraints demand (`^[0-9a-f]{32}$`).
 */
export function newGroupToken(randomByte: () => number): string {
  const out: string[] = [];
  for (let i = 0; i < GROUP_TOKEN_HEX_LENGTH / 2; i += 1) {
    out.push((randomByte() & 0xff).toString(16).padStart(2, "0"));
  }
  return out.join("");
}

// ─── Links ───────────────────────────────────────────────────────────────────

/** Public leaderboard: `/e/<code>` (is_public gates strangers). */
export function publicLeaderboardUrl(shortCode: string): string {
  return `/e/${shortCode}`;
}

/** TV broadcast view: `/e/<code>/tv`. */
export function tvUrl(shortCode: string): string {
  return `/e/${shortCode}/tv`;
}

/** Scorer entry: `/score` (the event PIN is entered there). */
export function scorerEntryUrl(): string {
  return "/score";
}

/** Absolute URL for copy-to-clipboard, from the env-var-backed product domain. */
export function absoluteUrl(path: string): string {
  return `https://${brand.domain}${path}`;
}

// ─── Publish payload ─────────────────────────────────────────────────────────

export const publishStepSchema = z.object({
  eventId: z.string().min(1, "Save the event basics first."),
  isPublic: z.boolean(),
});

export type PublishStep = z.output<typeof publishStepSchema>;

/** The server action's success state: the generated credentials + links. */
export type PublishResult = {
  readonly shortCode: string;
  readonly scorerPin: string;
  readonly publicUrl: string;
  readonly tvUrl: string;
  readonly scorerUrl: string;
};
