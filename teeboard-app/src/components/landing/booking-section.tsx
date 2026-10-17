import { CalendarClock } from "lucide-react";
import { CalInlineEmbed } from "@/components/landing/cal-inline-embed";
import { toCalLink } from "@/lib/cal-embed/cal-link";
import { brand } from "@/lib/brand";

/**
 * "Book a 15-min call" section rendered through the Cal.com inline embed.
 * The event-type link comes from NEXT_PUBLIC_CALCOM_EVENT_LINK so it can be
 * swapped without code changes; the section is hidden when the variable is
 * unset or unusable rather than rendering a broken embed.
 */
export function BookingSection() {
  const calLink = toCalLink(process.env.NEXT_PUBLIC_CALCOM_EVENT_LINK);

  if (!calLink) return null;

  return (
    <section
      id="book-a-call"
      className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6"
    >
      <div className="mx-auto mb-8 max-w-2xl text-center">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground">
          <CalendarClock
            className="size-4 text-brand-gold"
            aria-hidden="true"
          />
          Talk it through
        </p>
        <h2 className="font-heading text-3xl font-semibold tracking-tight text-brand">
          Book a <span className="numeric">15</span>-min call
        </h2>
        <p className="mt-3 text-lg text-muted-foreground">
          Prefer a walkthrough before joining? Pick a time and see{" "}
          {brand.name} live on a real leaderboard — no pitch deck, just the
          product.
        </p>
      </div>
      <CalInlineEmbed calLink={calLink} />
    </section>
  );
}
