"use client";

import { Sparkles } from "lucide-react";

/**
 * The 'Auto-filled' badge (M4-T004): shown beside every wizard field the
 * AI pre-fill populated, until the user touches that field. Purely
 * presentational — the badge state lives in the step forms.
 */
export function AutofillBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      data-slot="autofill-badge"
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[0.65rem] font-medium text-primary"
    >
      <Sparkles className="size-3" aria-hidden />
      Auto-filled
    </span>
  );
}
