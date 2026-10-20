import type { ReactNode } from "react";
import Link from "next/link";
import { brand } from "@/lib/brand";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12 text-foreground">
      <Link
        href="/"
        className="mb-8 flex items-center gap-2"
        aria-label={`${brand.name} home`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- brand logo comes from env-var-backed config */}
        <img
          src={brand.logoUrl}
          alt={`${brand.name} logo`}
          className="size-8"
        />
        <span className="font-heading text-xl font-semibold text-brand">
          {brand.name}
        </span>
      </Link>
      {children}
    </div>
  );
}
