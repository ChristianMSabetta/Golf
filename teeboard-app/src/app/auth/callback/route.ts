import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRequestSupabase } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/auth/first-run";

/**
 * Supabase Auth callback for magic links and email confirmations: exchanges
 * the one-time code for a session server-side, ensures the staff profile row
 * exists (first-run provisioning for owners happens in the sign-up action),
 * then redirects into the admin app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/admin";

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in`);
  }

  const supabase = await getRequestSupabase();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/sign-in`);
  }

  try {
    const fullName =
      typeof data.user.user_metadata?.full_name === "string"
        ? data.user.user_metadata.full_name
        : undefined;

    await ensureProfile({
      id: data.user.id,
      email: data.user.email ?? "",
      fullName,
    });
  } catch (error) {
    console.error(
      `[auth] profile provisioning failed for ${data.user.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return NextResponse.redirect(`${origin}/sign-in`);
  }

  const safeNext =
    next.startsWith("/") && !next.startsWith("//") ? next : "/admin";

  return NextResponse.redirect(`${origin}${safeNext}`);
}
