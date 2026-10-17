import "server-only";
import { getServerSupabase } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/resend-adapter";
import type { WaitlistSignup } from "./schema";

export type WaitlistRecordResult = {
  recordedAt: string;
};

const ROLE_SUBJECT_LABELS: Record<WaitlistSignup["role"], string> = {
  head_professional: "Head Professional",
  golf_professional: "Golf Professional",
  course_manager: "Course Manager",
  course_owner: "Course Owner",
  other: "Other",
};

function formatSignupEmail(signup: WaitlistSignup, recordedAt: string): string {
  const lines = [
    "New waitlist signup:",
    "",
    `Name: ${signup.name}`,
    `Email: ${signup.email}`,
    `Course: ${signup.courseName}`,
    `State: ${signup.state}`,
    `Role: ${ROLE_SUBJECT_LABELS[signup.role]}`,
    `Source: ${signup.utmSource ?? "direct"}`,
    `Submitted: ${recordedAt}`,
  ];
  return lines.join("\n");
}

/**
 * Records a validated waitlist signup and notifies the admin address.
 *
 * The Supabase insert is the source of truth: when it fails the error is
 * rethrown so the route handler logs it — a failed insert is never treated
 * as a success. The admin notification is best-effort: a Resend failure is
 * logged server-side but never blocks or fails the signup, and no email is
 * ever sent to the visitor.
 */
export async function recordWaitlistSignup(
  signup: WaitlistSignup,
): Promise<WaitlistRecordResult> {
  const recordedAt = new Date().toISOString();

  const row = {
    email: signup.email,
    name: signup.name,
    course_name: signup.courseName,
    state: signup.state,
    role: signup.role,
    utm_source: signup.utmSource ?? null,
    created_at: recordedAt,
  };

  const { error } = await getServerSupabase().from("waitlist").insert(row);

  if (error) {
    throw new Error(
      `Supabase waitlist insert failed: ${error.message}; signup for recovery: ${JSON.stringify(row)}`,
    );
  }

  const notifyEmail = process.env.ADMIN_NOTIFY_EMAIL;
  if (!notifyEmail) {
    console.error(
      "[waitlist] ADMIN_NOTIFY_EMAIL is not set; signup recorded but admin notification skipped",
    );
    return { recordedAt };
  }

  try {
    await sendEmail({
      to: notifyEmail,
      subject: `New waitlist signup — ${signup.courseName}`,
      text: formatSignupEmail(signup, recordedAt),
      replyTo: signup.email,
    });
  } catch (error) {
    console.error(
      `[waitlist] admin notification failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return { recordedAt };
}
