import "server-only";
import type { WaitlistSignup } from "./schema";

export type WaitlistRecordResult = {
  recordedAt: string;
};

/**
 * Records a validated waitlist signup. Until persistence lands, the structured
 * server log is the capture channel, so no signup is lost. The persistence and
 * admin-notification wiring (Supabase insert + Resend notify) attaches here.
 */
export async function recordWaitlistSignup(
  signup: WaitlistSignup,
): Promise<WaitlistRecordResult> {
  const recordedAt = new Date().toISOString();

  const record = {
    email: signup.email,
    name: signup.name,
    courseName: signup.courseName,
    state: signup.state,
    role: signup.role,
    utmSource: signup.utmSource ?? null,
    createdAt: recordedAt,
  };

  console.info(
    `[waitlist] signup ${JSON.stringify(record)}`,
  );

  return { recordedAt };
}
