import { AI_PARSE_DAILY_LIMIT } from "./constants";

/**
 * Pure rate-limit arithmetic for the AI event setup (M4-T004). The state
 * is derived from `ai_parse_log` — the count of this club's rows whose
 * `created_at` falls inside the current UTC day — because the Phase 1
 * schema is frozen and no new rate-limit tables may be added. Keeping the
 * day boundary logic here (pure, unit-tested) means the route handler
 * only ever supplies a row count and a clock.
 */

export type RateLimitDecision = {
  readonly allowed: boolean;
  readonly remaining: number;
};

/**
 * Decides whether one more AI parse call may run for a club that has
 * already made `callsToday` calls since the UTC day boundary. Exactly
 * `AI_PARSE_DAILY_LIMIT` calls per day are allowed: the 31st is refused.
 */
export function checkDailyLimit(
  callsToday: number,
  limit: number = AI_PARSE_DAILY_LIMIT,
): RateLimitDecision {
  const safeCount = Number.isFinite(callsToday) && callsToday > 0 ? callsToday : 0;
  const allowed = safeCount < limit;
  return {
    allowed,
    remaining: allowed ? limit - safeCount : 0,
  };
}

/**
 * The half-open UTC day window [start, end) that a counted row's
 * `created_at` must fall inside. `now` is injectable so tests don't
 * depend on the wall clock.
 */
export function utcDayWindow(now: Date): {
  readonly start: Date;
  readonly end: Date;
} {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Whether a logged call's `created_at` falls inside the current UTC day
 * window — the filter behind the route handler's count query.
 */
export function isWithinCurrentUtcDay(
  createdAt: Date | string,
  now: Date,
): boolean {
  const stamp = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  const { start, end } = utcDayWindow(now);
  return stamp.getTime() >= start.getTime() && stamp.getTime() < end.getTime();
}
