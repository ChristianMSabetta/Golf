import { z } from "zod";

/**
 * Shared client/server contract for password sign-in. Both the sign-in form
 * and the server action validate against this single schema.
 */
export const passwordSignInSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .email("Enter a valid email address.")
    .max(254, "Enter a valid email address."),
  password: z
    .string()
    .min(1, "Enter your password.")
    .max(128, "Passwords are 128 characters or fewer."),
});

/**
 * Shared client/server contract for magic-link sign-in.
 */
export const magicLinkSignInSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .email("Enter a valid email address.")
    .max(254, "Enter a valid email address."),
});

/**
 * Shared client/server contract for first-run owner sign-up: creates the
 * auth user, provisions the club, and links the owner profile. The club
 * timezone must be a valid IANA zone and defaults per US conventions.
 */
export const ownerSignUpSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .email("Enter a valid email address.")
    .max(254, "Enter a valid email address."),
  password: z
    .string()
    .min(8, "Use at least 8 characters.")
    .max(128, "Passwords are 128 characters or fewer."),
  fullName: z
    .string()
    .trim()
    .min(1, "Enter your full name.")
    .max(120, "Names are 120 characters or fewer."),
  clubName: z
    .string()
    .trim()
    .min(1, "Enter your club name.")
    .max(160, "Club names are 160 characters or fewer."),
  timezone: z
    .string()
    .trim()
    .min(1, "Select a timezone.")
    .max(64)
    .default("America/New_York"),
});

/**
 * Scorer PIN verification payload. The event is addressed by id (the
 * scorer-facing page resolves the short code to an id server-side) and the
 * identifier scopes the per-actor lockout state.
 */
export const scorerPinVerifySchema = z.object({
  eventId: z.string().uuid("Unknown event."),
  pin: z
    .string()
    .trim()
    .min(4, "PINs are at least 4 digits.")
    .max(12, "PINs are at most 12 digits.")
    .regex(/^\d+$/, "The PIN contains digits only."),
  identifier: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional(),
});

export type PasswordSignInInput = z.input<typeof passwordSignInSchema>;
export type PasswordSignIn = z.output<typeof passwordSignInSchema>;
export type MagicLinkSignInInput = z.input<typeof magicLinkSignInSchema>;
export type MagicLinkSignIn = z.output<typeof magicLinkSignInSchema>;
export type OwnerSignUpInput = z.input<typeof ownerSignUpSchema>;
export type OwnerSignUp = z.output<typeof ownerSignUpSchema>;
export type ScorerPinVerifyInput = z.input<typeof scorerPinVerifySchema>;
export type ScorerPinVerify = z.output<typeof scorerPinVerifySchema>;

/** Copy shown after a magic link is requested. */
export const MAGIC_LINK_SENT_MESSAGE =
  "Check your email — we sent you a sign-in link.";
