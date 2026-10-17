import { Hero } from "@/components/landing/hero";
import { DemoVideo } from "@/components/landing/demo-video";
import { Pricing } from "@/components/landing/pricing";
import { BookingSection } from "@/components/landing/booking-section";
import { WaitlistSection } from "@/components/landing/waitlist-section";

type LandingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function LandingPage({ searchParams }: LandingPageProps) {
  const params = await searchParams;
  const utmSource = firstParam(params.utm_source);

  return (
    <main id="top" className="flex flex-1 flex-col">
      <Hero />
      <DemoVideo />
      <Pricing />
      <BookingSection />
      <WaitlistSection utmSource={utmSource} />
    </main>
  );
}
