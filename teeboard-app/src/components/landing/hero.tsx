import { Button } from "@/components/ui/button";
import { brand } from "@/lib/brand";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-gold/0 via-brand-gold to-brand-gold/0"
      />
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 px-4 pt-20 pb-16 text-center sm:px-6 sm:pt-24">
        <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground">
          <span className="numeric font-medium text-brand-gold">WHS</span>
          live golf scoring
        </p>
        <h1 className="max-w-3xl text-balance font-heading text-4xl font-semibold tracking-tight text-brand sm:text-5xl">
          {brand.name}: live leaderboards your players can follow from anywhere
          on the course
        </h1>
        <p className="max-w-2xl text-balance text-lg text-muted-foreground">
          {brand.name} keeps your events alive on every screen — a single setup
          at the shop, and scores update the moment they&#39;re posted.
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <a href="#waitlist">Join the waitlist</a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#pricing">See pricing</a>
          </Button>
        </div>
        <dl className="grid w-full max-w-2xl grid-cols-1 gap-4 pt-8 sm:grid-cols-3">
          <div className="flex flex-col items-center gap-1 rounded-xl border border-border bg-card px-4 py-5">
            <dt className="text-sm text-muted-foreground">Live leaderboard</dt>
            <dd className="font-heading text-lg font-semibold text-brand">
              scores update in real time
            </dd>
          </div>
          <div className="flex flex-col items-center gap-1 rounded-xl border border-border bg-card px-4 py-5">
            <dt className="text-sm text-muted-foreground">WHS/USGA scoring</dt>
            <dd className="font-heading text-lg font-semibold text-brand">
              built into every format
            </dd>
          </div>
          <div className="flex flex-col items-center gap-1 rounded-xl border border-border bg-card px-4 py-5">
            <dt className="text-sm text-muted-foreground">Zero new hardware</dt>
            <dd className="font-heading text-lg font-semibold text-brand">
              runs on what you carry today
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
