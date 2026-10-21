import { NextResponse } from "next/server";

/**
 * Liveness probe: answers 200 whenever the Node process itself is
 * up. Deliberately touches no backing service, so a Supabase outage
 * never causes the platform to restart healthy instances.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    { status: "alive", timestamp: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
