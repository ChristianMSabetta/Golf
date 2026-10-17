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
