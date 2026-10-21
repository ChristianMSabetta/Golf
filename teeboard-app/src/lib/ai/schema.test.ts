import { describe, expect, it } from "vitest";
import {
  AI_PARSE_FAILURE_MESSAGE,
  AI_PARSE_INPUT_MAX,
  aiEventPrefillSchema,
  aiParseRequestSchema,
  aiParseResponseSchema,
} from "./schema";
import { parseModelText } from "./parse";

/**
 * AI event-setup verification (M4-T004): the request/response Zod
 * contracts, the strict pre-fill shape, and the graceful-fallback parsing
 * of raw model text. Expected behaviors are hand-derived from the wizard
 * step schemas the pre-fill targets — never mirrored from an
 * implementation.
 */

describe("ai parse request schema", () => {
  it("accepts a one-sentence event description", () => {
    const text =
      "4-man scramble next Saturday, shotgun 8am, 18 holes, net 80%, CTP on 4 and 12";
    expect(aiParseRequestSchema.safeParse({ text }).success).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    const parsed = aiParseRequestSchema.parse({ text: "  stroke play  " });
    expect(parsed.text).toBe("stroke play");
  });

  it("rejects empty text", () => {
    expect(aiParseRequestSchema.safeParse({ text: "" }).success).toBe(false);
    expect(aiParseRequestSchema.safeParse({ text: "   " }).success).toBe(false);
  });

  it("rejects text beyond the input maximum", () => {
    expect(
      aiParseRequestSchema.safeParse({ text: "x".repeat(AI_PARSE_INPUT_MAX + 1) })
        .success,
    ).toBe(false);
  });

  it("rejects a missing text field", () => {
    expect(aiParseRequestSchema.safeParse({}).success).toBe(false);
    expect(aiParseRequestSchema.safeParse({ description: "scramble" }).success)
      .toBe(false);
  });
});

describe("ai event prefill schema", () => {
  it("accepts the spec-style scramble one-liner as structured data", () => {
    const parsed = aiEventPrefillSchema.safeParse({
      name: "Saturday Scramble",
      startDate: "2026-10-24",
      holesCount: 18,
      rounds: 1,
      startType: "shotgun",
      format: "scramble",
      teamSize: 4,
      scoringBasis: "net",
      handicapAllowancePct: 80,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.format).toBe("scramble");
      expect(parsed.data.teamSize).toBe(4);
      expect(parsed.data.handicapAllowancePct).toBe(80);
      expect(parsed.data.startType).toBe("shotgun");
    }
  });

  it("accepts the minimal best-ball one-liner", () => {
    const parsed = aiEventPrefillSchema.safeParse({
      holesCount: 9,
      nineOption: "front",
      format: "best_ball",
      teamSize: 2,
    });
    expect(parsed.success).toBe(true);
  });

  it("treats every field as optional — the AI states only what the text says", () => {
    expect(aiEventPrefillSchema.safeParse({}).success).toBe(true);
  });

  it("rejects unknown keys so drifting output can't smuggle data", () => {
    expect(
      aiEventPrefillSchema.safeParse({ courseName: "Pinehurst" }).success,
    ).toBe(false);
  });

  it("rejects formats outside the wizard's five", () => {
    expect(
      aiEventPrefillSchema.safeParse({ format: "match_play" }).success,
    ).toBe(false);
  });

  it("rejects out-of-range enum-ish values", () => {
    expect(aiEventPrefillSchema.safeParse({ holesCount: 12 }).success).toBe(false);
    expect(aiEventPrefillSchema.safeParse({ rounds: 3 }).success).toBe(false);
    expect(aiEventPrefillSchema.safeParse({ teamSize: 5 }).success).toBe(false);
    expect(
      aiEventPrefillSchema.safeParse({ handicapAllowancePct: 101 }).success,
    ).toBe(false);
    expect(
      aiEventPrefillSchema.safeParse({ handicapAllowancePct: -1 }).success,
    ).toBe(false);
    expect(
      aiEventPrefillSchema.safeParse({ maxScoreFixedCap: 21 }).success,
    ).toBe(false);
    expect(aiEventPrefillSchema.safeParse({ startType: "cannon" }).success).toBe(false);
    expect(aiEventPrefillSchema.safeParse({ nineOption: "side" }).success).toBe(false);
    expect(
      aiEventPrefillSchema.safeParse({ scoringBasis: "modified" }).success,
    ).toBe(false);
    expect(
      aiEventPrefillSchema.safeParse({ tiebreakMethod: "lottery" }).success,
    ).toBe(false);
    expect(
      aiEventPrefillSchema.safeParse({ maxScoreRule: "triple_par" }).success,
    ).toBe(false);
  });

  it("rejects malformed dates", () => {
    expect(
      aiEventPrefillSchema.safeParse({ startDate: "10/24/2026" }).success,
    ).toBe(false);
    expect(
      aiEventPrefillSchema.safeParse({ startDate: "Saturday" }).success,
    ).toBe(false);
  });

  it("rejects string numbers where numbers are required", () => {
    expect(
      aiEventPrefillSchema.safeParse({ teamSize: "four" }).success,
    ).toBe(false);
    expect(
      aiEventPrefillSchema.safeParse({ holesCount: "18" }).success,
    ).toBe(false);
  });
});

describe("ai parse response schema", () => {
  it("accepts a prefill with its message", () => {
    const parsed = aiParseResponseSchema.safeParse({
      prefill: { format: "scramble" },
      message: "Auto-filled — review each field before saving.",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts the empty fallback with the couldn't-read message", () => {
    const parsed = aiParseResponseSchema.safeParse({
      prefill: null,
      message: AI_PARSE_FAILURE_MESSAGE,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a null prefill without a message", () => {
    expect(aiParseResponseSchema.safeParse({ prefill: null }).success).toBe(false);
  });

  it("rejects a prefill the wizard couldn't represent", () => {
    expect(
      aiParseResponseSchema.safeParse({
        prefill: { format: "match_play" },
        message: "x",
      }).success,
    ).toBe(false);
  });
});

describe("parseModelText", () => {
  it("parses a bare JSON object", () => {
    const prefill = parseModelText('{"format":"scramble","teamSize":2}');
    expect(prefill).toEqual({ format: "scramble", teamSize: 2 });
  });

  it("tolerates code fences and stray prose around the JSON", () => {
    const prefill = parseModelText(
      '```json\n{"holesCount":9,"nineOption":"back"}\n```\nHope that helps!',
    );
    expect(prefill).toEqual({ holesCount: 9, nineOption: "back" });
  });

  it("returns null for prose without an object", () => {
    expect(parseModelText("I could not read that description.")).toBeNull();
    expect(parseModelText("")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseModelText('{"format": scramble}')).toBeNull();
  });

  it("returns null when the JSON fails the prefill contract", () => {
    expect(parseModelText('{"courseId":"nope"}')).toBeNull();
    expect(parseModelText('{"teamSize":9}')).toBeNull();
    expect(parseModelText("[]")).toBeNull();
  });
});
