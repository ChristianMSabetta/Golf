import { describe, expect, it } from "vitest";
import {
  GROUP_TOKEN_HEX_LENGTH,
  SCORER_PIN_LENGTH,
  SHORT_CODE_ALPHABET,
  SHORT_CODE_LENGTH,
  newGroupToken,
  newScorerPin,
  newShortCode,
  publicLeaderboardUrl,
  publishStepSchema,
  randomCode,
  scorerEntryUrl,
  tvUrl,
} from "./publish";

/**
 * Publish credential tests (M4-T007): short code / PIN / token shape under
 * deterministic byte sources, plus the link builders. Expected shapes derive
 * from the Phase 1 column constraints and the task contract — 32-char hex
 * per group token, exactly 4 digits for the PIN, 6 chars from the
 * unambiguous alphabet for the short code.
 */

/** Deterministic byte source: cycles 0…255. */
function cyclingByte(): () => number {
  let next = 0;
  return () => {
    const value = next;
    next = (next + 1) % 256;
    return value;
  };
}

/** Always-zero source: the alphabet's first character everywhere. */
function zeroByte(): number {
  return 0;
}

describe("publish credential generators", () => {
  it("draws from the alphabet with rejection sampling", () => {
    // With a zero byte source every draw is alphabet[0] (uniform acceptance:
    // 0 < alphabet.length * 8 always holds).
    expect(randomCode("abc", 3, zeroByte)).toBe("aaa");
    // A byte cycling 0..255 yields deterministic, reproducible output.
    const code = randomCode("abcdefghjkmnpqrstuvwxyz23456789", 6, cyclingByte());
    expect(code).toHaveLength(6);
    for (const char of code) {
      expect(SHORT_CODE_ALPHABET).toContain(char);
    }
  });

  it("mints 6-char short codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = newShortCode(cyclingByte());
      expect(code).toHaveLength(SHORT_CODE_LENGTH);
      expect(code).toMatch(/^[a-z0-9]{6}$/);
      expect(code).not.toMatch(/[ilo01]/);
    }
  });

  it("mints exactly-4-digit PINs including leading zeros", () => {
    const pin = newScorerPin(zeroByte);
    expect(pin).toBe("0000");
    expect(pin).toHaveLength(SCORER_PIN_LENGTH);
    for (let i = 0; i < 50; i += 1) {
      const candidate = newScorerPin(cyclingByte());
      expect(candidate).toMatch(/^\d{4}$/);
    }
  });

  it("mints 32-char lowercase-hex group tokens", () => {
    for (let i = 0; i < 20; i += 1) {
      const token = newGroupToken(cyclingByte());
      expect(token).toHaveLength(GROUP_TOKEN_HEX_LENGTH);
      expect(token).toMatch(/^[0-9a-f]{32}$/); // the Phase 1 column check
    }
  });

  it("builds the shareable link paths", () => {
    expect(publicLeaderboardUrl("ab3xy9")).toBe("/e/ab3xy9");
    expect(tvUrl("ab3xy9")).toBe("/e/ab3xy9/tv");
    expect(scorerEntryUrl()).toBe("/score");
  });

  it("validates the publish payload", () => {
    expect(
      publishStepSchema.safeParse({ eventId: "e1", isPublic: true }).success,
    ).toBe(true);
    expect(publishStepSchema.safeParse({ eventId: "", isPublic: true }).success).toBe(false);
    expect(publishStepSchema.safeParse({ eventId: "e1" }).success).toBe(false);
  });
});
