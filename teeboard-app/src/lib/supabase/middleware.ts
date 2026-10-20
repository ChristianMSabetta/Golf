import "server-only";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });

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
        const rewriteResponse = NextResponse.next({ request });

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
