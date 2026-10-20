import "server-only";
import ws from "ws";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export type ProfileRow = {
  id: string;
  user_id: string;
  club_id: string | null;
  full_name: string;
  email: string;
  role: "owner" | "head_pro" | "event_manager" | "superadmin";
  is_superadmin: boolean;
};

export type StaffRole = ProfileRow["role"];

function supabaseSettings() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase configuration: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return { url, serviceRoleKey };
}

/**
 * Server-side Supabase client factory using the service-role key. RLS never
 * applies to this client; it must only be used for trusted server code
 * (validation, first-run provisioning, rate/pin state transitions). Reads
 * connection details exclusively from server-side environment variables.
 */
export function getServerSupabase(): SupabaseClient {
  const { url, serviceRoleKey } = supabaseSettings();

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws as unknown as WebSocketLikeConstructor },
  });
}

/**
 * Request-bound Supabase client for React Server Components, route handlers,
 * and server actions: carries the signed-in user's cookies so PostgREST
 * applies RLS with their claims, and persists refreshed session cookies
 * back to the response so the session survives server-side navigation.
 *
 * Uses the public anon key — never the service-role key — so a missing
 * configuration fails loudly instead of silently issuing RLS-bypassing
 * sessions.
 */
export async function getRequestSupabase(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase configuration: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const cookieStore = await cookies();

  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value } of cookiesToSet) {
            cookieStore.set(name, value);
          }
        } catch {
          // `cookies().set` throws inside a Server Component render (Next.js
          // only allows it in route handlers/server actions); the middleware
          // refresh keeps the session alive in that case.
        }
      },
    },
  });

  return client;
}

export type AuthUser = NonNullable<
  Awaited<ReturnType<SupabaseClient["auth"]["getUser"]>>["data"]["user"]
>;

/**
 * The signed-in user for the current request, or null. Authorization
 * decisions always read the role from the profiles database row
 * server-side (src/lib/auth/authorization.ts), never from client claims.
 */
export async function getAuthContext(): Promise<
  { user: null } | { user: AuthUser }
> {
  const requestClient = await getRequestSupabase();
  const { data: userData, error } = await requestClient.auth.getUser();
  if (error || !userData.user) return { user: null };
  return { user: userData.user };
}

export type StaffAuthContext = {
  user: AuthUser | null;
  profile: ProfileRow | null;
};

/**
 * Resolves the current staff member's user AND profile rows in one pass.
 *
 * The profile read goes through the service-role client because profile
 * provisioning (first-run club creation) races with the anon-role policy
 * check for brand-new users; role and club assignment come from the
 * database row, never from a client-supplied claim.
 */
export async function getStaffAuthContext(): Promise<StaffAuthContext> {
  const { user } = await getAuthContext();
  if (!user) return { user: null, profile: null };

  const serverClient = getServerSupabase();
  const { data: profile, error } = await serverClient
    .from("profiles")
    .select("id, user_id, club_id, full_name, email, role, is_superadmin")
    .eq("user_id", user.id)
    .maybeSingle<ProfileRow>();

  if (error) {
    throw new Error(`Failed to load staff profile: ${error.message}`);
  }

  return { user, profile: profile ?? null };
}
