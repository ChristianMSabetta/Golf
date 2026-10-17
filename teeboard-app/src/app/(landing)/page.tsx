import { brand } from "@/lib/brand";

export default function LandingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground">
        <span className="numeric font-medium text-brand-gold">WHS</span>
        live golf scoring
      </p>
      <h1 className="text-5xl font-semibold tracking-tight text-brand sm:text-6xl">
        {brand.name}
      </h1>
      <p className="max-w-xl text-balance text-lg text-muted-foreground">
        Real-time scoring, scorecards, and leaderboards for courses, pros, and
        players.
      </p>
    </main>
  );
}
