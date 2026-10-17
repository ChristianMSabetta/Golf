import "server-only";
import { Resend } from "resend";
import { brand } from "@/lib/brand";

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  text: string;
  replyTo?: string | string[];
};

/**
 * Sends a transactional email via Resend. This adapter is the single
 * boundary around the Resend SDK: later transactional suites (Phase 5)
 * extend or swap this implementation without touching route handlers.
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error("Missing Resend configuration: set RESEND_API_KEY.");
  }

  const resend = new Resend(apiKey);

  const { data, error } = await resend.emails.send({
    from: brand.senderEmail,
    to: input.to,
    subject: input.subject,
    text: input.text,
    replyTo: input.replyTo,
  });

  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error("Resend send failed: no email id returned.");
  }
}
