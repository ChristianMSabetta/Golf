/**
 * Central brand configuration. Values are read from environment variables so
 * the product name, domain, sender identity, and logo never appear hardcoded
 * in components. The fallbacks are code-level defaults for local development.
 */
export const brand = {
  name: process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "TeeBoard",
  domain: process.env.NEXT_PUBLIC_PRODUCT_DOMAIN ?? "teeboard.golf",
  senderEmail: process.env.SENDER_EMAIL ?? "no-reply@teeboard.golf",
  logoUrl: process.env.NEXT_PUBLIC_LOGO_URL ?? "/logo.svg",
} as const;

export type Brand = typeof brand;

/**
 * Default product branding for clubs that have not customized their profile.
 * The club's own settings override these values wherever they are set.
 */
export const DEFAULT_PRIMARY_COLOR = "#0F5132";
export const DEFAULT_LOGO_URL = "/logo.svg";

/**
 * Timezones offered to clubs (US conventions; IANA zone names). The default
 * is the US Eastern zone so dates render MM/DD/YYYY on the US calendar.
 */
export const CLUB_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;

export type ClubTimezone = (typeof CLUB_TIMEZONES)[number];

export const DEFAULT_TIMEZONE: ClubTimezone = "America/New_York";

/**
 * Curated primary-color choices for the club settings form (the product's
 * brand green and gold accents plus complementary course tones). Clubs can
 * also enter any #RRGGBB value directly.
 */
export const PRIMARY_COLOR_OPTIONS = [
  { value: DEFAULT_PRIMARY_COLOR, label: "Fairway Green" },
  { value: "#C9A227", label: "Gold Accent" },
  { value: "#1E6B4C", label: "Pine" },
  { value: "#2C4E80", label: "Clubhouse Blue" },
] as const;

/**
 * A club's resolved branding: the single source consumed by the admin app
 * now and by the leaderboard, PDFs, and transactional email in later
 * phases. Values fall back to the product defaults when the club has not
 * customized them; the color is always a valid `#RRGGBB` hex.
 */
export type ClubBrand = {
  readonly name: string;
  readonly logoUrl: string;
  readonly primaryColor: string;
  readonly timezone: ClubTimezone;
};

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const LOGO_URL_PATTERN = /^(?:https:\/\/\S+|\/[^\s]*)$/;

function normalizeColor(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (trimmed && HEX_COLOR_PATTERN.test(trimmed)) return trimmed.toLowerCase();
  return DEFAULT_PRIMARY_COLOR;
}

function normalizeLogoUrl(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (trimmed && LOGO_URL_PATTERN.test(trimmed) && trimmed.length <= 500) {
    return trimmed;
  }
  return brand.logoUrl || DEFAULT_LOGO_URL;
}

function normalizeTimezone(value: string | null | undefined): ClubTimezone {
  const zones: readonly string[] = CLUB_TIMEZONES;
  const trimmed = value?.trim();
  if (trimmed && zones.includes(trimmed)) return trimmed as ClubTimezone;
  return DEFAULT_TIMEZONE;
}

/**
 * Resolves a club's branding from its stored settings. Club settings are the
 * single source of truth for club-facing branding (name, logo, primary
 * color); anything unset falls back to the product's env-var-backed
 * defaults, and the color is normalized to a safe `#RRGGBB` hex.
 */
export function resolveClubBrand(input: {
  name?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  timezone?: string | null;
}): ClubBrand {
  const name = input.name?.trim();
  return Object.freeze({
    name: name && name.length > 0 ? name : brand.name,
    logoUrl: normalizeLogoUrl(input.logoUrl),
    primaryColor: normalizeColor(input.primaryColor),
    timezone: normalizeTimezone(input.timezone),
  });
}
