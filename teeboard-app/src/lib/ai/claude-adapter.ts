import "server-only";
import { DEFAULT_MODEL, callClaude, type ClaudeParseResult } from "./messages";

/**
 * The Claude Haiku adapter (M4-T004) — the single boundary around the
 * Anthropic Messages API. Everything is environment-driven (the API key and
 * model never live in code), the 8-second timeout is enforced inside the
 * call core, temperature is pinned to 0, and the output is Zod-validated
 * before anything else sees it. The adapter performs no database access —
 * logging happens in the route handler, never here.
 */

export type ClaudeAdapterConfig = {
  readonly apiKey: string;
  readonly model: string;
};

/**
 * Resolves the adapter's configuration from the environment. The API key
 * is required and fails fast when missing; the model has a default so a
 * deployment only ever needs the key. Never hardcodes secrets.
 */
export function adapterConfig(): ClaudeAdapterConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing Claude configuration: set ANTHROPIC_API_KEY.");
  }
  return {
    apiKey,
    model: process.env.CLAUDE_MODEL || DEFAULT_MODEL,
  };
}

/**
 * Sends one Claude Haiku Messages API request. Never throws — every
 * failure mode (missing key, timeout, HTTP failure, invalid output) is a
 * typed value the route handler turns into a graceful fallback.
 */
export async function claudeParseEvent(
  text: string,
  now: Date = new Date(),
): Promise<ClaudeParseResult> {
  let apiKey: string;
  let model: string;
  try {
    ({ apiKey, model } = adapterConfig());
  } catch {
    return {
      ok: false,
      reason: "missing_key",
      model: DEFAULT_MODEL,
    };
  }

  return callClaude({ apiKey, model, text, now });
}
