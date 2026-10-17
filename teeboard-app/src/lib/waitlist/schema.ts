import { z } from "zod";
import { US_STATE_CODES } from "@/lib/us-states";

/** Roles a waitlist visitor can identify with. */
export const WAITLIST_ROLES = [
  "head_professional",
  "golf_professional",
  "course_manager",
  "course_owner",
  "other",
] as const;

/**
 * Shared client/server contract for waitlist signups. The client form and the
 * route handler both validate against this single schema.
 */
export const waitlistSignupSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .email("Enter a valid email address.")
    .max(254, "Enter a valid email address."),
  name: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(120, "Name must be 120 characters or fewer."),
  courseName: z
    .string()
    .trim()
    .min(1, "Enter your course name.")
    .max(160, "Course name must be 160 characters or fewer."),
  state: z
    .string()
    .trim()
    .length(2, "Select your state.")
    .transform((value) => value.toUpperCase())
    .refine((value) => US_STATE_CODES.includes(value), "Select your state."),
  role: z.enum(WAITLIST_ROLES, { message: "Select your role." }),
  utmSource: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type WaitlistSignupInput = z.input<typeof waitlistSignupSchema>;
export type WaitlistSignup = z.output<typeof waitlistSignupSchema>;
export type WaitlistRole = (typeof WAITLIST_ROLES)[number];

/** Copy shown on the page after a successful signup. */
export const WAITLIST_SUCCESS_MESSAGE =
  "Thanks — I'll reach out within 24 hours.";
