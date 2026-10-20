import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const PIN_SALT_BYTES = 16;

/**
 * Canonical scorer-PIN hashing recipe, shared by event creation (Phase 4)
 * and PIN verification (src/lib/scorer/pin.ts): sha256(`${salt}:${pin}`)
 * hex with a 16-byte crypto-random salt.
 */
export function hashScorerPin(
  pin: string,
  salt: string = randomBytes(PIN_SALT_BYTES).toString("hex"),
): { hash: string; salt: string } {
  const hash = createHash("sha256").update(`${salt}:${pin}`).digest("hex");
  return { hash, salt };
}

/**
 * Constant-time comparison so a wrong PIN takes the same path as a right one.
 */
export function verifyScorerPinHash(
  pin: string,
  salt: string,
  expectedHash: string,
): boolean {
  const candidate = Buffer.from(hashScorerPin(pin, salt).hash, "utf8");
  const expected = Buffer.from(expectedHash, "utf8");
  return (
    candidate.length === expected.length &&
    timingSafeEqual(candidate, expected)
  );
}
