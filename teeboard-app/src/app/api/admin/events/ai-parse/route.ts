import { NextResponse } from "next/server";
import { getStaff } from "@/lib/auth/authorization";
import {
  aiParseRequestSchema,
  AI_PARSE_FAILURE_MESSAGE,
  type AiEventPrefill,
  type AiParseResponse,
} from "@/lib/ai/schema";
import { AI_PARSE_DAILY_LIMIT } from "@/lib/ai/constants";
import { claudeParseEvent } from "@/lib/ai/claude-adapter";
import { checkAiParseBudget, logAiParse } from "@/lib/ai/log";

/**
 * The one-sentence AI event setup endpoint (M4-T004): a server-side POST
 * that turns a free-text event description into wizard pre-fill data via a
 * single Claude Haiku call (temperature 0, 8-second timeout).
 *
 * Safeguards, all enforced here — never in the client:
 * - Authorization: a signed-in staff member of a club with an
 *   event-managing role before anything else runs.
 * - Rate limit: 30 calls per day per club, derived by counting the current
 *   day's `ai_parse_log` rows attributed to the club (the Phase 1 schema
 *   is frozen — no new rate-limit tables).
 * - Logging: every call — success or failure — is logged to
 *   `ai_parse_log` with input, output, validated flag, model, error, and
 *   latency. A logging failure never masks the user response.
 * - Graceful fallback: invalid output, timeout, provider failure, or a
 *   missing key all answer the same "Couldn't read that" message with a
 *   null prefill — the wizard is left exactly as it was. The AI performs
 *   no database writes other than its log row.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EVENT_ROLES = ["owner", "head_pro", "event_manager"] as const;

function failure(
  message: string,
  status: number,
): NextResponse<AiParseResponse> {
  return NextResponse.json(
    { prefill: null, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: Request,
): Promise<NextResponse<AiParseResponse>> {
  const staff = await getStaff();
  if (!staff) return failure("Please sign in to continue.", 401);

  const clubId = staff.clubId;
  if (clubId === null) {
    return failure(
      "No club is linked to your account yet — ask your club owner to invite you.",
      403,
    );
  }

  if (
    !staff.isSuperadmin &&
    !EVENT_ROLES.includes(staff.role as (typeof EVENT_ROLES)[number])
  ) {
    return failure(
      "Your role doesn't allow managing events. Ask the club owner.",
      403,
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return failure("Invalid request body.", 400);
  }

  const parsedRequest = aiParseRequestSchema.safeParse(payload);
  if (!parsedRequest.success) {
    return failure(
      parsedRequest.error.issues[0]?.message ?? AI_PARSE_FAILURE_MESSAGE,
      400,
    );
  }
  const text = parsedRequest.data.text;

  let budget: Awaited<ReturnType<typeof checkAiParseBudget>>;
  try {
    budget = await checkAiParseBudget(clubId);
  } catch (budgetFailure) {
    console.error(
      `[ai-parse] budget check failed for club ${clubId}: ${String(budgetFailure)}`,
    );
    return failure(AI_PARSE_FAILURE_MESSAGE, 200);
  }
  if (!budget.allowed) {
    return failure(
      `Daily AI setup limit reached (${AI_PARSE_DAILY_LIMIT} per day per club) — try again tomorrow.`,
      429,
    );
  }

  const startedAt = Date.now();
  const result = await claudeParseEvent(text);
  const latencyMs = Date.now() - startedAt;

  const prefill: AiEventPrefill | null = result.ok ? result.prefill : null;
  const logError = result.ok ? null : result.reason;

  try {
    await logAiParse({
      clubId,
      text,
      output: prefill,
      validated: prefill !== null,
      model: result.model,
      error: logError,
      latencyMs,
    });
  } catch (logWriteFailure) {
    console.error(
      `[ai-parse] log write failed for club ${clubId}: ${String(logWriteFailure)}`,
    );
  }

  if (prefill === null) {
    return failure(AI_PARSE_FAILURE_MESSAGE, 200);
  }

  return NextResponse.json(
    {
      prefill,
      message: "Auto-filled — review each field before saving.",
    } satisfies AiParseResponse,
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
