import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Per-request middleware:
 * 1. Refreshes the Supabase Auth session so every request carries fresh
 *    access tokens before reaching the app (src/lib/supabase/middleware.ts).
 * 2. Applies a nonce-based Content-Security-Policy to every non-asset
 *    response. A per-request nonce lets Next.js bootstrap scripts run while
 *    the rest of the policy stays locked down. Sources:
 *    - app.cal.com — the Cal.com inline embed (script, iframe, images, XHR)
 *    - *.supabase.co — Supabase API/Realtime called from the browser
 *    Resend is called server-side only and needs no browser sources.
 */
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'nonce-{NONCE}' 'strict-dynamic' https://app.cal.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://app.cal.com",
  "font-src 'self' data:",
  "connect-src 'self' https://app.cal.com https://*.supabase.co wss://*.supabase.co",
  "frame-src 'self' https://app.cal.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
];

const SCRIPT_SRC_DIRECTIVE =
  "script-src 'self' 'nonce-{NONCE}' 'strict-dynamic' https://app.cal.com";
const CONNECT_SRC_DIRECTIVE =
  "connect-src 'self' https://app.cal.com https://*.supabase.co wss://*.supabase.co";

function buildCsp(nonce: string): string {
  return CSP_DIRECTIVES.join("; ").replace("{NONCE}", nonce);
}

function buildDevCsp(): string {
  // Development needs eval for React Fast Refresh and a local WebSocket for
  // HMR; HTTPS-only upgrades are dropped because localhost serves over http.
  return CSP_DIRECTIVES.map((directive) => {
    if (directive === SCRIPT_SRC_DIRECTIVE) {
      return "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://app.cal.com";
    }
    if (directive === CONNECT_SRC_DIRECTIVE) {
      return "connect-src 'self' ws: http://localhost:* https://app.cal.com https://*.supabase.co ws://*.supabase.co";
    }
    return directive;
  })
    .filter((directive) => directive !== "upgrade-insecure-requests")
    .join("; ");
}

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  response.headers.set(
    "Content-Security-Policy",
    process.env.NODE_ENV === "development" ? buildDevCsp() : buildCsp(nonce()),
  );

  return response;
}

function nonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export const config = {
  matcher: [
    // Skip immutable static assets and the public brand assets; every other
    // route (pages and API handlers) gets the session refresh + CSP. Baseline
    // hardening headers (nosniff, frame options, referrer, permissions) for
    // all routes come from next.config.ts.
    "/((?!_next/static|_next/image|favicon.ico|logo.svg).*)",
  ],
};
