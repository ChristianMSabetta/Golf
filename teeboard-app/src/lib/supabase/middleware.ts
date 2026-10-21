import "server-only";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase Auth session cookie on the incoming request.
 *
 * `requestHeaders` (optional) are forwarded to the app on the rewritten
 * request — used by src/middleware.ts to hand Next.js the per-request CSP
 * nonce, which Next.js extracts from the request's Content-Security-Policy
 * header and applies to the <script> tags it renders (see the CSP guide).
 * Both response paths (the initial rewrite and the cookie-refresh rewrite)
 * must forward them or the nonce would be lost on token refreshes.
 */
export async function updateSession(
  request: NextRequest,
  requestHeaders?: Headers,
): Promise<NextResponse> {
  const forwardedHeaders = requestHeaders ?? request.headers;
  let response = NextResponse.next({
    request: { headers: forwardedHeaders },
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // No auth configured: let the request pass; protected routes fail
    // closed in requireStaffRole via a missing-auth redirect.
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        const rewriteResponse = NextResponse.next({
          request: { headers: forwardedHeaders },
        });

        for (const { name, value } of cookiesToSet) {
          rewriteResponse.cookies.set(name, value);
        }

        response = rewriteResponse;
      },
    },
  });

  // getUser() refreshes the access token when expired and persists the new
  // cookies via setAll above, so every request reaches the app with a
  // current session.
  await supabase.auth.getUser();

  return response;
}
