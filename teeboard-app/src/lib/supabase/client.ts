"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client for client components. Carries the anon key
 * (safe to expose) and the user's session cookies so PostgREST applies the
 * authenticated RLS policies. Sign-in flows call Supabase Auth through this
 * client (magic link and password); all authorization decisions are made
 * server-side (src/lib/auth/authorization.ts).
 */
export function getBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase configuration: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return createBrowserClient(url, anonKey);
}
