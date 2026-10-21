/**
 * Proof page header. Every product name and branding string renders from
 * the env-var-backed brand configuration (src/lib/brand.ts) — nothing is
 * hardcoded here.
 */
import { brand } from "@/lib/brand";

export function ProofHeader() {
  return (
    <header className="border-b border-border/80 bg-cream/90">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-2 px-4 sm:px-6">
        <span className="font-heading text-lg font-semibold text-brand">
          {brand.name}
        </span>
        <span className="text-sm text-muted-foreground">
          · Phase 2 scoring-engine integration proof
        </span>
      </div>
    </header>
  );
}
