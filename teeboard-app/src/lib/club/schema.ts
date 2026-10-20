import { z } from "zod";
import { CLUB_TIMEZONES } from "@/lib/brand";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const LOGO_URL = /^(?:https:\/\/\S+|\/[^\s]+)$/;

/** An empty string means "use the product default" (stored as null). */
const optionalUrl = z
  .string()
  .trim()
  .max(500, "Logo URLs are 500 characters or fewer.")
  .refine(
    (value) => value === "" || LOGO_URL.test(value),
    "Logo URLs must be https:// links or site-relative paths.",
  );

const optionalHexColor = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || HEX_COLOR.test(value),
    "Primary colors use the #RRGGBB hex format.",
  );

/**
 * Shared client/server contract for club profile settings. The settings form
 * and the update server action validate against this single schema, so a
 * club can never persist an unusable logo URL, color, or timezone. Empty
 * optional values clear the stored setting and fall back to the product
 * defaults at render time (see resolveClubBrand).
 */
export const clubProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your club name.")
    .max(160, "Club names are 160 characters or fewer."),
  logoUrl: optionalUrl,
  primaryColor: optionalHexColor,
  timezone: z.enum(CLUB_TIMEZONES, "Choose a supported timezone."),
});

export type ClubProfileInput = z.input<typeof clubProfileSchema>;
export type ClubProfile = z.output<typeof clubProfileSchema>;

/** Copy shown after the club profile saves successfully. */
export const CLUB_PROFILE_SAVED_MESSAGE = "Club profile saved.";
