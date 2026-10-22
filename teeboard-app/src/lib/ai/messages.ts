import type { AiEventPrefill } from "./schema";
import {
  FORMAT_LABELS,
  FORMAT_DESCRIPTIONS,
  SYSTEM_PROMPT,
  buildUserPrompt,
} from "./prompt";
import { AI_PARSE_TIMEOUT_MS } from "./constants";
import { parseModelText, textBlocks } from "./parse";

/**
 * The pure Messages API call core (M4-T004): request construction and
 * response triage, free of `server-only` and environment reads, so the
 * test suite can exercise the timeout, retry-free single call, and every
 * failure mode. `claude-adapter.ts` is the thin env-driven boundary that
 * delegates here.
 */

export type ClaudeParseSuccess = {
  readonly ok: true;
  readonly prefill: AiEventPrefill;
  readonly model: string;
};

export type ClaudeParseFailure = {
  readonly ok: false;
  readonly reason: "timeout" | "invalid_output" | "request_failed" | "missing_key";
  readonly model: string;
};

export type ClaudeParseResult = ClaudeParseSuccess | ClaudeParseFailure;

export const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
export const CLAUDE_API_VERSION = "2023-06-01";
export const DEFAULT_MODEL = "claude-haiku-latest";

/**
 * The Messages API endpoint. `ANTHROPIC_BASE_URL` (optional) overrides the
 * host — e.g. a self-hosted proxy — while the production default stays the
 * real Anthropic URL. The path is fixed either way.
 */
export function claudeApiUrl(): string {
  const base = process.env.ANTHROPIC_BASE_URL?.replace(/\/+$/, "");
  return base ? `${base}/v1/messages` : CLAUDE_API_URL;
}

export type FetchLike = typeof fetch;

/**
 * Runs one Messages API call with the given key/model. The temperature is
 * pinned to 0, the 8-second budget is enforced with an abort signal, and
 * the joined text is Zod-validated — never thrown, always a typed result.
 */
export async function callClaude(
  input: {
    readonly apiKey: string;
    readonly model: string;
    readonly text: string;
    readonly now: Date;
    readonly timeoutMs?: number;
    readonly fetchImpl?: FetchLike;
  },
): Promise<ClaudeParseResult> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? AI_PARSE_TIMEOUT_MS,
  );

  try {
    const response = await (input.fetchImpl ?? fetch)(claudeApiUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": CLAUDE_API_VERSION,
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: 1024,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildUserPrompt(
              input.text,
              FORMAT_LABELS,
              FORMAT_DESCRIPTIONS,
              input.now,
            ),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: "request_failed", model: input.model };
    }

    const body: unknown = await response.json();
    const joined = textBlocks(body).join("\n");
    const prefill = parseModelText(joined);
    if (prefill === null) {
      return { ok: false, reason: "invalid_output", model: input.model };
    }
    return { ok: true, prefill, model: input.model };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, reason: "timeout", model: input.model };
    }
    return { ok: false, reason: "request_failed", model: input.model };
  } finally {
    clearTimeout(timer);
  }
}
