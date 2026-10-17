import { brand } from "@/lib/brand";
import { toCalLink } from "@/lib/cal-embed/cal-link";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  const calLink = toCalLink(process.env.NEXT_PUBLIC_CALCOM_EVENT_LINK);

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-cream/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <a
          href="#top"
          className="flex items-center gap-2"
          aria-label={`${brand.name} home`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- brand logo comes from env-var-backed config */}
          <img
            src={brand.logoUrl}
            alt={`${brand.name} logo`}
            className="size-7"
          />
          <span className="font-heading text-lg font-semibold text-brand">
            {brand.name}
          </span>
        </a>
        <nav
          aria-label="Landing page sections"
          className="flex items-center gap-2"
        >
          {calLink ? (
            <Button asChild size="lg" variant="outline">
              <a href="#book-a-call">Book a call</a>
            </Button>
          ) : null}
          <Button asChild size="lg">
            <a href="#waitlist">Join the waitlist</a>
          </Button>
        </nav>
      </div>
    </header>
  );
}
