import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The adapter boundary marker is bundler-only; stub it so the suite can
// import the module under test.
vi.mock("server-only", () => ({}));
import {
  CLAUDE_API_URL,
  DEFAULT_MODEL,
  callClaude,
} from "./messages";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  FORMAT_LABELS,
  FORMAT_DESCRIPTIONS,
} from "./prompt";
import { AI_PARSE_TIMEOUT_MS } from "./constants";

/**
 * Claude call-core verification (M4-T004): one Messages API call per parse
 * at temperature 0 with the 8-second abort budget, credentials supplied by
 * the env-driven adapter, and every failure mode — timeout, HTTP failure,
 * invalid output, network error — surfacing as the graceful fallback.
 * The `server-only` boundary itself stays untested by design (it guards
 * the import, not logic).
 */

const NOW = new Date("2026-10-21T08:00:00.000Z");
const TEXT =
  "4-man scramble next Saturday, shotgun 8am, 18 holes, net 80%, CTP on 4 and 12";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function messageBody(text: string): unknown {
  return { content: [{ type: "text", text }] };
}

describe("callClaude", () => {
  it("makes exactly one request at temperature 0 with the API key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        messageBody('{"format":"scramble","teamSize":4,"holesCount":18}'),
      ),
    );

    const result = await callClaude({
      apiKey: "test-key",
      model: DEFAULT_MODEL,
      text: TEXT,
      now: NOW,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(CLAUDE_API_URL);
    expect(init.headers).toMatchObject({
      "x-api-key": "test-key",
      "anthropic-version": "2023-06-01",
    });
    const body = JSON.parse(String(init.body)) as {
      temperature: number;
      model: string;
      system: string;
      max_tokens: number;
      messages: { role: string; content: string }[];
    };
    expect(body.temperature).toBe(0);
    expect(body.model).toBe(DEFAULT_MODEL);
    expect(body.system).toBe(SYSTEM_PROMPT);
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.role).toBe("user");
    expect(body.messages[0]?.content).toContain(TEXT);
    expect(result.ok).toBe(true);
  });

  it("parses the spec-style scramble one-liner into structured prefill", async () => {
    const result = await callClaude({
      apiKey: "test-key",
      model: DEFAULT_MODEL,
      text: TEXT,
      now: NOW,
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse(
          messageBody(
            '{"name":"Saturday Scramble","startDate":"2026-10-24","holesCount":18,"rounds":1,"startType":"shotgun","format":"scramble","teamSize":4,"scoringBasis":"net","handicapAllowancePct":80}',
          ),
        ),
      ) as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prefill).toEqual({
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
    }
  });

  it("joins multiple text blocks before parsing", async () => {
    const result = await callClaude({
      apiKey: "test-key",
      model: DEFAULT_MODEL,
      text: TEXT,
      now: NOW,
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse({
          content: [
            { type: "text", text: '{"format":' },
            { type: "text", text: '"best_ball","teamSize":2}' },
          ],
        }),
      ) as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prefill.format).toBe("best_ball");
    }
  });

  it("fails with invalid_output when the model output doesn't validate", async () => {
    const result = await callClaude({
      apiKey: "test-key",
      model: DEFAULT_MODEL,
      text: TEXT,
      now: NOW,
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse(messageBody("I couldn't read that description.")),
      ) as unknown as typeof fetch,
    });

    expect(result).toEqual({
      ok: false,
      reason: "invalid_output",
      model: DEFAULT_MODEL,
    });
  });

  it("rejects unknown keys in the model output", async () => {
    const result = await callClaude({
      apiKey: "test-key",
      model: DEFAULT_MODEL,
      text: TEXT,
      now: NOW,
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse(messageBody('{"courseName":"Fake CC"}')),
      ) as unknown as typeof fetch,
    });

    expect(result).toEqual({
      ok: false,
      reason: "invalid_output",
      model: DEFAULT_MODEL,
    });
  });

  it("fails with request_failed on an HTTP error", async () => {
    const result = await callClaude({
      apiKey: "test-key",
      model: DEFAULT_MODEL,
      text: TEXT,
      now: NOW,
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse({ error: "overloaded" }, 529),
      ) as unknown as typeof fetch,
    });

    expect(result).toEqual({
      ok: false,
      reason: "request_failed",
      model: DEFAULT_MODEL,
    });
  });

  it("fails with timeout when the request exceeds the budget", async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );

    const result = await callClaude({
      apiKey: "test-key",
      model: DEFAULT_MODEL,
      text: TEXT,
      now: NOW,
      timeoutMs: 50,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result).toEqual({
      ok: false,
      reason: "timeout",
      model: DEFAULT_MODEL,
    });
  });

  it("uses the 8-second timeout budget", () => {
    expect(AI_PARSE_TIMEOUT_MS).toBe(8000);
  });

  it("surfaces request_failed when fetch throws", async () => {
    const result = await callClaude({
      apiKey: "test-key",
      model: DEFAULT_MODEL,
      text: TEXT,
      now: NOW,
      fetchImpl: vi.fn().mockRejectedValue(
        new Error("network down"),
      ) as unknown as typeof fetch,
    });

    expect(result).toEqual({
      ok: false,
      reason: "request_failed",
      model: DEFAULT_MODEL,
    });
  });

  it("clears the abort timer when the call settles", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    await callClaude({
      apiKey: "test-key",
      model: DEFAULT_MODEL,
      text: TEXT,
      now: NOW,
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse(messageBody("{}")),
      ) as unknown as typeof fetch,
    });
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe("buildUserPrompt", () => {
  it("includes the formats, current date, and description", () => {
    const prompt = buildUserPrompt(
      TEXT,
      FORMAT_LABELS,
      FORMAT_DESCRIPTIONS,
      NOW,
    );
    expect(prompt).toContain("Current date (ISO): 2026-10-21T08:00:00.000Z");
    expect(prompt).toContain(`Event description:\n${TEXT}`);
    expect(prompt).toContain("scramble");
    expect(prompt).toContain("stroke_play");
  });

  it("lists every wizard format", () => {
    const prompt = buildUserPrompt(
      TEXT,
      FORMAT_LABELS,
      FORMAT_DESCRIPTIONS,
      NOW,
    );
    for (const format of Object.keys(FORMAT_LABELS)) {
      expect(prompt).toContain(format);
    }
  });
});

describe("adapterConfig via claudeParseEvent", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
  });

  it("is exercised by the endpoint; missing keys surface as missing_key", async () => {
    const { claudeParseEvent } = await import("./claude-adapter");
    delete process.env.ANTHROPIC_API_KEY;

    const result = await claudeParseEvent(TEXT, NOW);
    expect(result).toEqual({
      ok: false,
      reason: "missing_key",
      model: DEFAULT_MODEL,
    });
  });
});
