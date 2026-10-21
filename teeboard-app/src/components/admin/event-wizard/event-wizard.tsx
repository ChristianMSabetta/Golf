"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WizardStepRail } from "./wizard-steps";
import { BasicsStep } from "./basics-step";
import { FormatStep } from "./format-step";
import {
  completedSteps,
  furthestStep,
  wizardSteps,
  type WizardDraftData,
} from "@/lib/events/wizard";
import {
  basicsStepSchema,
  type WizardStepId,
} from "@/lib/events/schema";
import type { CourseSummary } from "@/lib/course/server";

/**
 * The event creation wizard (M4-T003): the 5-step framework with per-step
 * validation gating, free navigation to any visited/unlocked step, and
 * debounced draft autosave through the server actions. The step registry
 * drives the rail; implemented steps render their form, upcoming ones a
 * preview card — Players (M4-T005), Groups (M4-T006), and Extras &
 * publish (M4-T007) land later in this milestone.
 */

export function EventWizard({
  draft,
  courses,
  initialStep,
  canEdit,
}: {
  draft: WizardDraftData | null;
  courses: readonly CourseSummary[];
  initialStep: WizardStepId;
  canEdit: boolean;
}) {
  const router = useRouter();

  // Deep-linked step on load; server props don't reset it afterward.
  const [step, setStep] = useState<WizardStepId>(
    draft?.formatData != null ? initialStep : "basics",
  );
  const [eventId, setEventId] = useState<string | null>(
    draft?.eventId ?? null,
  );
  const [visited, setVisited] = useState<WizardStepId[]>(["basics"]);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  /**
   * Validation-driven gating: a step is reachable when its predecessors'
   * data validates. `basics` validates from the draft (or is step 0), so
   * `format` unlocks only once Basics parses clean.
   */
  const basicsValid =
    draft !== null && basicsStepSchema.safeParse(draft).success;
  const furthest = furthestStep(
    basicsValid ? draft : null,
    draft?.formatData ?? null,
  );
  const completed = completedSteps(
    basicsValid ? draft : null,
    draft?.formatData ?? null,
  );
  const steps = wizardSteps(furthest, completed);

  const onBasicsSaved = useCallback(
    (id: string, at: string) => {
      setEventId(id);
      setSavedAt(at);
      router.replace(`/admin/events/new?event=${id}&step=${step}`);
    },
    [router, step],
  );

  const onFormatSaved = useCallback((at: string) => {
    setSavedAt(at);
  }, []);

  /** Free navigation to any unlocked or previously visited step. */
  function navigate(next: WizardStepId) {
    if (next === step) return;
    const index = steps.findIndex((s) => s.id === next);
    const reachable =
      index >= 0 && (index <= furthest || visited.includes(next));
    if (!reachable) return;
    setVisited((current) =>
      current.includes(next) ? current : [...current, next],
    );
    setStep(next);
    if (eventId !== null) {
      router.replace(`/admin/events/new?event=${eventId}&step=${next}`);
    }
  }

  const activeStep = steps.find((s) => s.id === step) ?? steps[0]!;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Event wizard
          </p>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            {draft?.name && draft.name.length > 0 ? draft.name : "New event"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Five steps from blank page to published event. Your draft
            autosaves as you go — leave and come back any time.
          </p>
        </div>
        {savedAt ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            Saved {new Date(savedAt).toLocaleTimeString()}
          </p>
        ) : null}
      </div>

      <WizardStepRail steps={steps} active={step} onNavigate={navigate} />

      {step === "basics" ? (
        <BasicsStep
          draft={draft}
          courses={courses}
          eventId={eventId}
          onSaved={onBasicsSaved}
          readOnly={!canEdit}
        />
      ) : null}

      {step === "format" ? (
        eventId !== null ? (
          <FormatStep
            draft={draft}
            eventId={eventId}
            onSaved={onFormatSaved}
            readOnly={!canEdit}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Save the basics first</CardTitle>
              <CardDescription>
                The format step attaches to a saved draft — finish the
                basics above and the format unlocks here.
              </CardDescription>
            </CardHeader>
          </Card>
        )
      ) : null}

      {step !== "basics" && step !== "format" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4" aria-hidden />
              {activeStep.label}
            </CardTitle>
            <CardDescription>
              {activeStep.description} This step arrives with the rest of
              the event milestone — your draft is safe and autosaved.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Everything you&apos;ve entered so far is saved to the event
            draft — continue with Format, or pick the draft up later from
            the events list.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
