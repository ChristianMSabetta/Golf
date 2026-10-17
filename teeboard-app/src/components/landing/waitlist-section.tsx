import { WaitlistForm } from "@/components/landing/waitlist-form";
import { brand } from "@/lib/brand";

type WaitlistSectionProps = {
  utmSource?: string;
};

export function WaitlistSection({ utmSource }: WaitlistSectionProps) {
  return (
    <section
      id="waitlist"
      className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6"
    >
      <div className="mx-auto mb-8 max-w-2xl text-center">
        <h2 className="font-heading text-3xl font-semibold tracking-tight text-brand">
          Join the {brand.name} waitlist
        </h2>
        <p className="mt-3 text-lg text-muted-foreground">
          Tell us about your course and we&#39;ll reach out with a live demo.
        </p>
      </div>
      <WaitlistForm utmSource={utmSource} />
    </section>
  );
}
