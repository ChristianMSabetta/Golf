"use client";

import { Check, ChevronRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WizardStepView } from "@/lib/events/wizard";

/**
 * The wizard's step rail (M4-T003): every step in order with its
 * completion checkmark, lock, or active marker. Navigation is free to any
 * visited/unlocked step; validation gating happens in the step forms.
 */

export function WizardStepRail({
  steps,
  active,
  onNavigate,
}: {
  steps: readonly WizardStepView[];
  active: string;
  onNavigate: (id: WizardStepView["id"]) => void;
}) {
  return (
    <ol className="flex flex-row flex-wrap items-center gap-1">
      {steps.map((step, i) => {
        const locked = step.status === "locked";
        const complete = step.status === "complete";
        const isActive = step.id === active;

        return (
          <li key={step.id} className="flex items-center">
            <button
              type="button"
              disabled={locked}
              aria-current={isActive ? "step" : undefined}
              onClick={() => onNavigate(step.id)}
              title={locked ? "Complete the earlier steps first" : step.description}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                locked
                  ? "cursor-not-allowed text-muted-foreground/50"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                isActive && "bg-sidebar-accent text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full text-[0.7rem] font-semibold",
                  complete
                    ? "bg-primary text-primary-foreground"
                    : isActive
                      ? "bg-foreground text-background"
                      : "border border-border text-muted-foreground",
                )}
              >
                {complete ? <Check className="size-3" aria-hidden /> : i + 1}
              </span>
              {step.label}
              {locked ? (
                <Lock className="size-3" aria-hidden />
              ) : null}
            </button>
            {i < steps.length - 1 ? (
              <ChevronRight
                className="mx-1 size-4 text-muted-foreground/40"
                aria-hidden
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
