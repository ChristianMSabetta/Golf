"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "./field-error";
import { saveBasicsStep } from "@/lib/events/actions";
import {
  basicsStepSchema,
  EVENT_HOLES_COUNTS,
  EVENT_NINE_OPTIONS,
  EVENT_ROUNDS,
  EVENT_START_TYPES,
  type WizardActionState,
} from "@/lib/events/schema";
import type { CourseSummary } from "@/lib/course/server";
import type { WizardDraftData } from "@/lib/events/wizard";

/**
 * Wizard Basics step (M4-T003): name, date, course (from the club's course
 * editor), 9 or 18 holes, 1–2 rounds, and tee-times vs. shotgun start. The
 * same Zod schema gates client-side progression and the autosave action;
 * valid values autosave (debounced) so the draft survives a refresh.
 */

const AUTOSAVE_DEBOUNCE_MS = 1500;
const STRING_SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function BasicsStep({
  draft,
  courses,
  eventId,
  onSaved,
  readOnly = false,
}: {
  draft: WizardDraftData | null;
  courses: readonly CourseSummary[];
  eventId: string | null;
  onSaved: (eventId: string, savedAt: string) => void;
  readOnly?: boolean;
}) {
  const [name, setName] = useState(draft?.name ?? "");
  const [startDate, setStartDate] = useState(draft?.startDate ?? todayIso());
  const [courseId, setCourseId] = useState(
    draft?.courseId ?? (courses[0]?.id ?? ""),
  );
  const [holesCount, setHolesCount] = useState<number>(draft?.holesCount ?? 18);
  const [nineOption, setNineOption] = useState<
    (typeof EVENT_NINE_OPTIONS)[number]
  >(draft?.nineOption ?? "front");
  const [rounds, setRounds] = useState<number>(draft?.rounds ?? 1);
  const [startType, setStartType] = useState<
    (typeof EVENT_START_TYPES)[number]
  >(draft?.startType ?? "tee_times");

  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [state, formAction, pending] = useActionState<
    WizardActionState,
    FormData
  >(saveBasicsStep, {});

  const formRef = useRef<HTMLFormElement>(null);

  function payload() {
    return { name, startDate, courseId, holesCount, nineOption, rounds, startType };
  }

  function validate(): Record<string, string> {
    const parsed = basicsStepSchema.safeParse(payload());
    if (parsed.success) return {};
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (!fields[key]) fields[key] = issue.message;
    }
    return fields;
  }

  // Debounced autosave: valid values persist automatically; invalid ones
  // wait for the explicit button (which surfaces the field errors). The
  // first render is skipped — an unchanged draft is never re-persisted
  // just because the form remounted.
  const firstRenderRef = useRef(true);
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    if (readOnly) return;
    const timer = setTimeout(() => {
      if (Object.keys(validate()).length > 0) return;
      formRef.current?.requestSubmit();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    name,
    startDate,
    courseId,
    holesCount,
    nineOption,
    rounds,
    startType,
    readOnly,
  ]);

  // Surface the persisted id + timestamp once the action answers.
  useEffect(() => {
    if (state.saved && state.eventId) {
      onSaved(state.eventId, state.savedAt ?? new Date().toISOString());
    }
  }, [state.saved, state.eventId, state.savedAt, onSaved]);

  const errors = state.fields ?? {};

  function err(key: string): string | undefined {
    return clientErrors[key] ?? errors[key];
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    const fields = validate();
    if (Object.keys(fields).length > 0) {
      event.preventDefault();
      setClientErrors(fields);
      return;
    }
    setClientErrors({});
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-6"
    >
      {eventId !== null ? (
        <input type="hidden" name="eventId" value={eventId} />
      ) : null}
      <input type="hidden" name="payload" value={JSON.stringify(payload())} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="size-4" aria-hidden />
            Basics
          </CardTitle>
          <CardDescription>
            What, when, and where — the event&apos;s name, date, course, and
            round structure. Saving creates a draft you can come back to.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="event-name">Event name</Label>
            <Input
              id="event-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Saturday Scramble"
              aria-invalid={Boolean(err("name"))}
              disabled={readOnly}
              required
            />
            <FieldError message={err("name")} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="event-date">Date</Label>
              <Input
                id="event-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-invalid={Boolean(err("startDate"))}
                disabled={readOnly}
                required
              />
              <FieldError message={err("startDate")} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="event-course">Course</Label>
              <select
                id="event-course"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                aria-invalid={Boolean(err("courseId"))}
                disabled={readOnly || courses.length === 0}
                className={STRING_SELECT_CLASS}
                required
              >
                {courses.length === 0 ? (
                  <option value="">No courses yet — create one first</option>
                ) : (
                  courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name} ({course.holesCount} holes)
                    </option>
                  ))
                )}
              </select>
              <FieldError message={err("courseId")} />
            </div>
          </div>

          <fieldset className="grid gap-5 sm:grid-cols-2" disabled={readOnly}>
            <div className="grid gap-2">
              <Label>Holes</Label>
              <div className="flex gap-2">
                {EVENT_HOLES_COUNTS.map((count) => (
                  <label
                    key={count}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary/5"
                  >
                    <input
                      type="radio"
                      name="holes-count"
                      value={count}
                      checked={holesCount === count}
                      onChange={() => setHolesCount(count)}
                      className="accent-[#0F5132]"
                    />
                    {count} holes
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="event-nine">Nine played</Label>
              <select
                id="event-nine"
                value={nineOption}
                onChange={(e) =>
                  setNineOption(
                    e.target.value as (typeof EVENT_NINE_OPTIONS)[number],
                  )
                }
                disabled={readOnly || holesCount !== 9}
                className={STRING_SELECT_CLASS}
              >
                {EVENT_NINE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option === "front" ? "Front (1–9)" : "Back (10–18)"}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="event-rounds">Rounds</Label>
              <select
                id="event-rounds"
                value={rounds}
                onChange={(e) => setRounds(Number(e.target.value))}
                disabled={readOnly}
                className={STRING_SELECT_CLASS}
              >
                {EVENT_ROUNDS.map((count) => (
                  <option key={count} value={count}>
                    {count} {count === 1 ? "round" : "rounds"}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="event-start">Start</Label>
              <select
                id="event-start"
                value={startType}
                onChange={(e) =>
                  setStartType(
                    e.target.value as (typeof EVENT_START_TYPES)[number],
                  )
                }
                disabled={readOnly}
                className={STRING_SELECT_CLASS}
              >
                <option value="tee_times">Tee times</option>
                <option value="shotgun">Shotgun start</option>
              </select>
            </div>
          </fieldset>

          {state.error && !state.saved ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {state.error}
            </p>
          ) : null}
          {state.saved ? (
            <p className="text-sm font-medium text-primary">
              Basics saved — draft autosaves as you edit.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending || readOnly}>
              {pending
                ? "Saving…"
                : eventId === null
                  ? "Create draft"
                  : "Save basics"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
