/**
 * The Phase 2 integration proof page (M3-T004): a thin leaderboard over the
 * committed static fixture, computed client-side entirely through
 * @teeboard/scoring.
 *
 * Deliberately free of Phase 4 machinery: no Realtime subscription, no
 * polling fallback, no Supabase client, no database read — the fixture in
 * src/lib/leaderboard/fixture.ts is the only data source.
 */
import type { Metadata } from "next";
import { brand } from "@/lib/brand";
import { StandingsTable } from "@/components/proof/standings-table";
import { ProofHeader } from "@/components/proof/proof-header";

export const metadata: Metadata = {
  title: `${brand.name} leaderboard proof`,
  description:
    "Seeded-event leaderboard proof: gross and net standings and position movement computed through the pure scoring package.",
};

export default function LeaderboardProofPage() {
  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <ProofHeader />
      <StandingsTable />
    </main>
  );
}
