import "server-only";
import { getServerSupabase } from "@/lib/supabase/server";
import { AI_PARSE_DAILY_LIMIT } from "./constants";
import { checkDailyLimit, utcDayWindow, type RateLimitDecision } from "./rate-limit";

/**
 * `ai_parse_log` access (M4-T004). Every Claude call — success or failure —
 * is logged through this module with the service-role client, because the
 * log doubles as the rate-limit state: the 30/day/club budget is derived by
 * counting the current day's rows attributed to the club (the Phase 1
 * schema is frozen; no new rate-limit tables were added).
 *
 * The AI never writes anywhere else. The only rows this feature touches
 * are these log rows, and log rows never mutate event data.
 */

export type AiParseLogInsert = {
  readonly clubId: string;
  readonly text: string;
  readonly output: unknown;
  readonly validated: boolean;
  readonly model: string;
  readonly error: string | null;
  readonly latencyMs: number;
};

/** Logs one parse attempt (success or failure) to `ai_parse_log`. */
export async function logAiParse(input: AiParseLogInsert): Promise<void> {
  const client = getServerSupabase();
  const { error } = await client.from("ai_parse_log").insert({
    club_id: input.clubId,
    event_id: null,
    input: input.text,
    output: input.output as Record<string, unknown> | null,
    validated: input.validated,
    model: input.model,
    error: input.error,
    latency_ms: input.latencyMs,
  });

  if (error) {
    throw new Error(`Failed to log AI parse: ${error.message}`);
  }
}

/**
 * Counts this club's `ai_parse_log` rows created since the start of the
 * current UTC day — the state behind the 30/day/club limit. Counting rows
 * (rather than a dedicated rate-limit table) is the constraint the frozen
 * Phase 1 schema imposes; the count-then-call sequence serves a single
 * staff member per request, which the daily budget tolerates.
 */
export async function countTodayAiParses(
  clubId: string,
  now: Date = new Date(),
): Promise<number> {
  const client = getServerSupabase();
  const { start } = utcDayWindow(now);
  const { count, error } = await client
    .from("ai_parse_log")
    .select("id", { count: "exact", head: true })
    .eq("club_id", clubId)
    .gte("created_at", start.toISOString());

  if (error) {
    throw new Error(`Failed to count AI parse log: ${error.message}`);
  }
  return count ?? 0;
}

/** Resolves the club's remaining AI-parse budget for the current UTC day. */
export async function checkAiParseBudget(
  clubId: string,
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  const callsToday = await countTodayAiParses(clubId, now);
  return checkDailyLimit(callsToday, AI_PARSE_DAILY_LIMIT);
}
