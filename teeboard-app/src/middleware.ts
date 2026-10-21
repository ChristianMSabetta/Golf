import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Per-request middleware:
 * 1. Refreshes the Supabase Auth session so every request carries fresh
 *    access tokens before reaching the app (src/lib/supabase/middleware.ts).
 * 2. Applies a nonce-based Content-Security-Policy to every non-asset
 *    response, with the nonce echoed to Next.js through the request
 *    headers so rendered <script> tags carry it (required with
 *    'strict-dynamic'). Sources:
 *    - app.cal.com — the Cal.com inline embed (script, iframe, images, XHR)
 *    - *.supabase.co — Supabase API/Realtime called from the browser
 *    Resend is called server-side only and needs no browser sources.
 * 3. In development the CSP relaxes to 'unsafe-inline'/'unsafe-eval' for
 *    React Fast Refresh and adds a local ws: source for HMR.
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
  if (process.env.NODE_ENV === "development") {
    const response = await updateSession(request);
    response.headers.set("Content-Security-Policy", buildDevCsp());
    return response;
  }

  // The nonce travels BOTH ways: on the REQUEST headers (`x-nonce` plus a
  // Content-Security-Policy header) so Next.js extracts it during SSR and
  // applies it to the <script> tags it renders (with 'strict-dynamic',
  // rendered scripts are only allowed by their nonce), and on the RESPONSE
  // CSP header so the browser enforces the same policy. The request headers
  // differ from the incoming ones, so every matched route renders
  // dynamically — required, since a prerendered page cannot carry a
  // per-request nonce. updateSession forwards these same headers through
  // both of its response paths so a token refresh never drops the nonce.
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = await updateSession(request, requestHeaders);
  response.headers.set("x-nonce", nonce);
  response.headers.set("Content-Security-Policy", csp);

  return response;
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
