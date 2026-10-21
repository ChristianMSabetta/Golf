import { describe, expect, it } from "vitest";
import { AI_PARSE_DAILY_LIMIT } from "./constants";
import {
  checkDailyLimit,
  isWithinCurrentUtcDay,
  utcDayWindow,
} from "./rate-limit";

/**
 * Rate-limit verification (M4-T004): the 30/day/club budget is derived by
 * counting the current day's `ai_parse_log` rows per club (the Phase 1
 * schema is frozen — no rate-limit tables), so the boundary arithmetic
 * lives here as pure functions.
 */

const NOW = new Date("2026-10-21T14:35:00.000Z");
const LATER_TODAY = new Date("2026-10-21T23:59:59.999Z");
const YESTERDAY = new Date("2026-10-20T23:59:59.999Z");
const TOMORROW = new Date("2026-10-22T00:00:00.000Z");

describe("utcDayWindow", () => {
  it("spans exactly one UTC day starting at midnight", () => {
    const { start, end } = utcDayWindow(NOW);
    expect(start.toISOString()).toBe("2026-10-21T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-22T00:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("wraps across month and year boundaries", () => {
    const { start, end } = utcDayWindow(new Date("2026-12-31T05:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("isWithinCurrentUtcDay", () => {
  it("accepts stamps later the same UTC day", () => {
    expect(isWithinCurrentUtcDay(LATER_TODAY, NOW)).toBe(true);
  });

  it("rejects stamps from before the window", () => {
    expect(isWithinCurrentUtcDay(YESTERDAY, NOW)).toBe(false);
  });

  it("rejects stamps from after the window", () => {
    expect(isWithinCurrentUtcDay(TOMORROW, NOW)).toBe(false);
  });

  it("accepts ISO strings and offset stamps that land in the UTC day", () => {
    expect(isWithinCurrentUtcDay("2026-10-21T08:15:00.000Z", NOW)).toBe(true);
    expect(isWithinCurrentUtcDay("2026-10-21T08:15:00+02:00", NOW)).toBe(true);
    expect(isWithinCurrentUtcDay("2026-10-21T23:15:00-08:00", NOW)).toBe(false);
  });
});

describe("checkDailyLimit", () => {
  it("allows the first call of the day", () => {
    const decision = checkDailyLimit(0);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(AI_PARSE_DAILY_LIMIT);
  });

  it("allows the 30th call of the day", () => {
    const decision = checkDailyLimit(AI_PARSE_DAILY_LIMIT - 1);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(1);
  });

  it("refuses the 31st call of the day", () => {
    const decision = checkDailyLimit(AI_PARSE_DAILY_LIMIT);
    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
  });

  it("keeps refusing past the limit", () => {
    expect(checkDailyLimit(AI_PARSE_DAILY_LIMIT + 5).allowed).toBe(false);
  });

  it("defaults to the 30/day/club budget", () => {
    expect(AI_PARSE_DAILY_LIMIT).toBe(30);
  });

  it("treats non-finite counts as zero", () => {
    const decision = checkDailyLimit(Number.NaN);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(AI_PARSE_DAILY_LIMIT);
    expect(checkDailyLimit(-3).remaining).toBe(AI_PARSE_DAILY_LIMIT);
  });

  it("respects an overridden limit", () => {
    expect(checkDailyLimit(2, 2).allowed).toBe(false);
    expect(checkDailyLimit(1, 2).allowed).toBe(true);
  });
});
