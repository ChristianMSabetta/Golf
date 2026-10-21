import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Readiness probe: verifies the deployment can reach its only backing
 * service (Supabase) through the server-side service-role client — the
 * same trusted path server code uses for provisioning and role checks.
 * RLS grants no table access to the anon role, so the request-path client
 * would (by design) answer 403 on a healthy deployment; this probe must
 * instead prove the database round-trip itself. Returns 200 with a
 * checks summary when the database answers, 503 with the failing check
 * otherwise, so a load balancer can pull an unhealthy instance out of
 * rotation. Exposes no secrets (only a head count and latency), performs
 * no writes, and never renders user data; unauthenticated by design.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const startedAt = Date.now();

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      return NextResponse.json(
        {
          status: "unhealthy",
          checks: { config: false },
          timestamp: new Date().toISOString(),
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    const supabase = getServerSupabase();
    const { error } = await supabase
      .from("clubs")
      .select("id", { count: "exact", head: true })
      .limit(1);

    const healthy = !error;
    const body = {
      status: healthy ? "healthy" : "unhealthy",
      checks: { config: true, database: healthy },
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(body, {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const body = {
      status: "unhealthy",
      checks: { config: true, database: false },
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(body, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
