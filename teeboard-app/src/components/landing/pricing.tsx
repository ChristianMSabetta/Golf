import { Check } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { brand } from "@/lib/brand";

export function Pricing() {
  return (
    <section id="pricing" className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
      <div className="mx-auto mb-8 max-w-2xl text-center">
        <h2 className="font-heading text-3xl font-semibold tracking-tight text-brand">
          Simple pricing, no contract
        </h2>
        <p className="mt-3 text-lg text-muted-foreground">
          One plan, one rate, no contract — cancel any time.
        </p>
      </div>
      <div className="flex justify-center">
        <Card className="w-full max-w-md border-brand-gold/60 ring-1 ring-brand-gold/60">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{brand.name}</CardTitle>
            <CardDescription>
              Everything a course needs for live scoring.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-balance">
              <span className="numeric font-heading text-5xl font-semibold tracking-tight text-brand">
                $129
              </span>
              <span className="numeric ml-2 text-lg text-muted-foreground">
                /month
              </span>
            </p>
            <ul className="mt-6 flex flex-col items-start gap-2.5 text-left text-sm">
              {[
                "Real-time leaderboards and digital scorecards",
                "WHS/USGA handicap-aware scoring",
                "Unlimited events and players",
                "Works on phones and tablets you already own",
              ].map((feature) => (
                <li key={feature} className="flex items-start gap-2.5">
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-brand-gold"
                    aria-hidden="true"
                  />
                  {feature}
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter className="justify-center border-t-0 bg-transparent">
            <Button asChild size="lg" className="w-full">
              <a href="#waitlist">Join the waitlist</a>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </section>
  );
}
