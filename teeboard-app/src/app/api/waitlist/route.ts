import { NextResponse } from "next/server";
import {
  waitlistSignupSchema,
  WAITLIST_SUCCESS_MESSAGE,
} from "@/lib/waitlist/schema";
import { recordWaitlistSignup } from "@/lib/waitlist/server";

export type WaitlistSuccessResponse = {
  message: string;
};

export type WaitlistErrorResponse = {
  error: string;
  fields?: Record<string, string>;
};

export async function POST(
  request: Request,
): Promise<NextResponse<WaitlistSuccessResponse | WaitlistErrorResponse>> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const parsed = waitlistSignupSchema.safeParse(payload);

  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fields[key]) {
        fields[key] = issue.message;
      }
    }
    return NextResponse.json(
      { error: "Please fix the highlighted fields.", fields },
      { status: 400 },
    );
  }

  try {
    await recordWaitlistSignup(parsed.data);
  } catch (error) {
    console.error(
      `[waitlist] failed to record signup: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    // The visitor never sees persistence problems; the failure is captured in
    // server logs so the signup can be recovered.
    return NextResponse.json(
      { message: WAITLIST_SUCCESS_MESSAGE },
      { status: 200 },
    );
  }

  return NextResponse.json({ message: WAITLIST_SUCCESS_MESSAGE });
}
