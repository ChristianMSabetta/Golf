import { PlayCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { brand } from "@/lib/brand";

export function DemoVideo() {
  return (
    <section id="demo" className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
      <div className="mx-auto mb-8 max-w-2xl text-center">
        <h2 className="font-heading text-3xl font-semibold tracking-tight text-brand">
          Watch {brand.name} in action
        </h2>
        <p className="mt-3 text-lg text-muted-foreground">
          A <span className="numeric">60</span>-second look at setting up an
          event and following the leaderboard live.
        </p>
      </div>
      <Card className="mx-auto max-w-3xl border-dashed bg-secondary/40 ring-0">
        <CardContent>
          <div className="flex aspect-video flex-col items-center justify-center gap-4 rounded-xl bg-brand/95 text-primary-foreground">
            <PlayCircle className="size-14" aria-hidden="true" />
            <p className="text-sm">
              <span className="numeric">60</span>-second product demo
            </p>
            <p className="text-sm text-primary-foreground/75">
              The demo video will live in this player.
            </p>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
