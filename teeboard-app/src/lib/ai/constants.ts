/**
 * Environment-independent constants for the AI event setup (M4-T004).
 * Nothing here reads the environment — that lives in the adapter.
 */

/** Provider request budget: 8 seconds end to end, enforced with an abort signal. */
export const AI_PARSE_TIMEOUT_MS = 8000;

/**
 * The rate limit: at most 30 successful-or-attempted Claude calls per
 * club per rolling day. Derived from `ai_parse_log` rows (the Phase 1
 * schema is frozen — no new rate-limit tables).
 */
export const AI_PARSE_DAILY_LIMIT = 30;
