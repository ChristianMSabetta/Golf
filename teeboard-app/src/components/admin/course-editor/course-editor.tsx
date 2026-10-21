"use client";

import { useMemo, useActionState, useState } from "react";
import { ClipboardPaste, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  COURSE_HOLES_COUNTS,
  COURSE_SAVED_MESSAGE,
  NINE_OPTIONS,
  TEE_GENDERS,
  parTotalBounds,
  type CourseActionState,
  type CourseHolesCount,
  type HoleRow,
} from "@/lib/course/schema";
import { saveCourse } from "@/lib/course/actions";
import { parseScorecardText } from "@/lib/course/parse-scorecard";
import { sumPars } from "@/lib/course/totals";

/**
 * The course editor (M4-T001): an 18-hole scorecard grid (par, stroke index,
 * yards per hole), tee definitions with per-gender rating and slope, and the
 * paste-from-scorecard parser. Client state mirrors the shared Zod contract
 * (src/lib/course/schema.ts); the server action validates the exact same
 * payload, so errors surfaced here are identical to the server's.
 */

type TeeDraft = {
  id: string | undefined;
  name: string;
  color: string;
  gender: (typeof TEE_GENDERS)[number];
  courseRating: string;
  slopeRating: string;
};

type EditorCourse = {
  id: string | undefined;
  name: string;
  city: string;
  state: string;
  country: string;
  holesCount: CourseHolesCount;
  nineOption: (typeof NINE_OPTIONS)[number];
  holes: HoleRow[];
  tees: {
    id: string | undefined;
    name: string;
    color: string;
    gender: (typeof TEE_GENDERS)[number];
    courseRating: number | null;
    slopeRating: number | null;
  }[];
};

const STRING_SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function fieldError(
  fields: Record<string, string>,
  key: string,
): string | undefined {
  return fields[key];
}

export function CourseEditor({
  course,
  readOnly = false,
}: {
  course: EditorCourse;
  readOnly?: boolean;
}) {
  const [name, setName] = useState(course.name);
  const [city, setCity] = useState(course.city);
  const [state, setState] = useState(course.state);
  const [country, setCountry] = useState(course.country);
  const [holesCount, setHolesCount] = useState<CourseHolesCount>(
    course.holesCount,
  );
  const [nineOption, setNineOption] = useState<
    (typeof NINE_OPTIONS)[number]
  >(course.nineOption ?? "front");
  const [holes, setHoles] = useState<HoleRow[]>(() =>
    course.holes.map((h) => ({ ...h })),
  );
  const [tees, setTees] = useState<TeeDraft[]>(() =>
    course.tees.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color ?? "",
      gender: t.gender,
      courseRating: t.courseRating === null ? "" : String(t.courseRating),
      slopeRating: t.slopeRating === null ? "" : String(t.slopeRating),
    })),
  );
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteApplied, setPasteApplied] = useState<string | null>(null);

  const [actionState, formAction, pending] = useActionState<
    CourseActionState,
    FormData
  >(saveCourse, {});

  const errors = actionState.fields ?? {};
  const bounds = parTotalBounds(holesCount);

  /** Rows for the current 9/18 grid, re-derivable whenever holesCount flips. */
  const gridRows = useMemo(() => {
    const start = holesCount === 9 && nineOption === "back" ? 10 : 1;
    return Array.from({ length: holesCount }, (_, i) => {
      const holeNumber = start + i;
      return (
        holes.find((h) => h.holeNumber === holeNumber) ?? {
          holeNumber,
          par: null,
          strokeIndex: null,
          yards: null,
        }
      );
    });
  }, [holes, holesCount, nineOption]);

  const parTotal = useMemo(() => sumPars(gridRows), [gridRows]);

  function updateHole(
    index: number,
    field: "par" | "strokeIndex" | "yards",
    rawValue: string,
  ) {
    setHoles((current) => {
      const target = gridRows[index]!;
      const existing = current.find(
        (h) => h.holeNumber === target.holeNumber,
      );
      const value =
        rawValue.trim() === ""
          ? null
          : Number.isNaN(Number(rawValue))
            ? rawValue // let the schema flag it
            : Number(rawValue);
      const next = existing
        ? { ...existing, [field]: value }
        : { ...target, [field]: value };
      return [
        ...current.filter((h) => h.holeNumber !== target.holeNumber),
        next,
      ].sort((a, b) => a.holeNumber - b.holeNumber);
    });
  }

  function changeHolesCount(next: CourseHolesCount) {
    setHolesCount(next);
    if (next === 9) {
      // Keep whichever nine currently holds more filled cells.
      const front = holes.filter(
        (h) => h.holeNumber <= 9 && h.par !== null,
      ).length;
      const back = holes.filter(
        (h) => h.holeNumber > 9 && h.par !== null,
      ).length;
      setNineOption(back > front ? "back" : "front");
    }
  }

  function applyPaste() {
    const { rows } = parseScorecardText(pasteText);
    setHoles(
      rows
        .map((row) => ({
          ...row,
          par: row.par ?? null,
          strokeIndex: row.strokeIndex ?? null,
          yards: row.yards ?? null,
        }))
        .filter((row) => row.par !== null || row.strokeIndex !== null || row.yards !== null),
    );
    setPasteApplied(new Date().toISOString());
    setPasteOpen(false);
    setPasteText("");
  }

  function payload(): unknown {
    return {
      id: course.id,
      name,
      city,
      state,
      country,
      holesCount,
      nineOption,
      holes: gridRows.map((h) => ({
        holeNumber: h.holeNumber,
        par: h.par,
        strokeIndex: h.strokeIndex,
        yards: h.yards,
      })),
      tees: tees.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        gender: t.gender,
        courseRating: t.courseRating,
        slopeRating: t.slopeRating,
      })),
    };
  }

  function updateTee(
    index: number,
    patch: Partial<TeeDraft>,
  ) {
    setTees((current) =>
      current.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    );
  }

  function addTee() {
    setTees((current) => [
      ...current,
      {
        id: undefined,
        name: "",
        color: "",
        gender: "mens",
        courseRating: "",
        slopeRating: "",
      },
    ]);
  }

  function removeTee(index: number) {
    setTees((current) => current.filter((_, i) => i !== index));
  }

  return (
    <form action={formAction} noValidate className="flex flex-col gap-6">
      <input type="hidden" name="payload" value={JSON.stringify(payload())} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            {course.id ? `Edit ${course.name || "course"}` : "New course"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {readOnly
              ? "Read-only — your role can view courses but not edit them."
              : "Par, stroke index, and yards per hole, plus tee ratings. Events pick this up for scoring."}
          </p>
        </div>
        {!readOnly ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPasteOpen((open) => !open)}
              className="gap-2"
            >
              <ClipboardPaste className="size-4" aria-hidden />
              Paste from scorecard
            </Button>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? "Saving…" : "Save course"}
            </Button>
          </div>
        ) : null}
      </div>

      {pasteOpen ? (
        <Card>
          <CardHeader>
            <CardTitle>Paste from scorecard</CardTitle>
            <CardDescription>
              Paste the printed scorecard text — one hole per line, columns
              like hole, par, yards, and stroke index in any order, with or
              without headers. Everything lands in the grid for you to check
              before saving.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <textarea
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              rows={8}
              spellCheck={false}
              placeholder={
                "1 4 401 7\n2 3 178 13\n…"
              }
              className="numeric w-full rounded-lg border border-input bg-transparent p-3 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label="Scorecard text"
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={applyPaste}
                disabled={pasteText.trim() === ""}
              >
                Fill grid
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPasteOpen(false)}
              >
                Cancel
              </Button>
            </div>
            {pasteApplied ? (
              <p className="text-sm text-foreground" role="status">
                Scorecard parsed into the grid — check each hole, then save.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Course details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="course-name">Course name</Label>
            <Input
              id="course-name"
              value={name}
              disabled={readOnly}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={Boolean(fieldError(errors, "name"))}
            />
            {fieldError(errors, "name") ? (
              <p className="text-sm text-destructive">
                {fieldError(errors, "name")}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="course-city">City</Label>
            <Input
              id="course-city"
              value={city}
              disabled={readOnly}
              onChange={(event) => setCity(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="course-state">State / province</Label>
            <Input
              id="course-state"
              value={state}
              disabled={readOnly}
              onChange={(event) => setState(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="course-country">Country</Label>
            <Input
              id="course-country"
              value={country}
              disabled={readOnly}
              onChange={(event) => setCountry(event.target.value)}
              aria-invalid={Boolean(fieldError(errors, "country"))}
            />
            {fieldError(errors, "country") ? (
              <p className="text-sm text-destructive">
                {fieldError(errors, "country")}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="course-holes">Holes</Label>
            <select
              id="course-holes"
              value={holesCount}
              disabled={readOnly}
              onChange={(event) =>
                changeHolesCount(Number(event.target.value) as CourseHolesCount)
              }
              className={STRING_SELECT_CLASS}
            >
              {COURSE_HOLES_COUNTS.map((count) => (
                <option key={count} value={count} className="bg-card">
                  {count} holes
                </option>
              ))}
            </select>
            {fieldError(errors, "holesCount") ? (
              <p className="text-sm text-destructive">
                {fieldError(errors, "holesCount")}
              </p>
            ) : null}
          </div>
          {holesCount === 9 ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="course-nine">Which nine</Label>
              <select
                id="course-nine"
                value={nineOption}
                disabled={readOnly}
                onChange={(event) =>
                  setNineOption(
                    event.target.value as (typeof NINE_OPTIONS)[number],
                  )
                }
                className={STRING_SELECT_CLASS}
              >
                {NINE_OPTIONS.map((option) => (
                  <option key={option} value={option} className="bg-card">
                    {option === "front" ? "Front nine (1–9)" : "Back nine (10–18)"}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scorecard</CardTitle>
          <CardDescription>
            Par and stroke index for every hole. Stroke indexes must use
            each value 1–{holesCount} exactly once ({holesCount} = hardest).
            Par total must land in {bounds.min}–{bounds.max} — currently{" "}
            <span className="numeric font-medium text-foreground">
              {parTotal}
            </span>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {fieldError(errors, "holes") ? (
            <p className="text-sm text-destructive" role="alert">
              {fieldError(errors, "holes")}
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-3">Hole</th>
                  <th className="pb-2 pr-3">Par</th>
                  <th className="pb-2 pr-3">Yards</th>
                  <th className="pb-2">Stroke index</th>
                </tr>
              </thead>
              <tbody>
                {gridRows.map((hole, index) => {
                  const key = String(index);
                  const parErr = fieldError(errors, `holes.${key}.par`);
                  const siErr = fieldError(errors, `holes.${key}.strokeIndex`);
                  const yardsErr = fieldError(errors, `holes.${key}.yards`);
                  return (
                    <tr key={hole.holeNumber}>
                      <td className="numeric pb-1.5 pr-3 pt-1.5 font-medium">
                        {hole.holeNumber}
                      </td>
                      <td className="pb-1.5 pr-3 pt-1.5">
                        <Input
                          inputMode="numeric"
                          className="numeric w-16 text-center"
                          value={hole.par ?? ""}
                          disabled={readOnly}
                          onChange={(event) =>
                            updateHole(index, "par", event.target.value)
                          }
                          aria-label={`Hole ${hole.holeNumber} par`}
                          aria-invalid={Boolean(parErr)}
                        />
                        {parErr ? (
                          <p className="mt-1 text-xs text-destructive">
                            {parErr}
                          </p>
                        ) : null}
                      </td>
                      <td className="pb-1.5 pr-3 pt-1.5">
                        <Input
                          inputMode="numeric"
                          className="numeric w-20 text-center"
                          value={hole.yards ?? ""}
                          disabled={readOnly}
                          onChange={(event) =>
                            updateHole(index, "yards", event.target.value)
                          }
                          aria-label={`Hole ${hole.holeNumber} yards`}
                          aria-invalid={Boolean(yardsErr)}
                        />
                        {yardsErr ? (
                          <p className="mt-1 text-xs text-destructive">
                            {yardsErr}
                          </p>
                        ) : null}
                      </td>
                      <td className="pb-1.5 pt-1.5">
                        <Input
                          inputMode="numeric"
                          className="numeric w-16 text-center"
                          value={hole.strokeIndex ?? ""}
                          disabled={readOnly}
                          onChange={(event) =>
                            updateHole(index, "strokeIndex", event.target.value)
                          }
                          aria-label={`Hole ${hole.holeNumber} stroke index`}
                          aria-invalid={Boolean(siErr)}
                        />
                        {siErr ? (
                          <p className="mt-1 text-xs text-destructive">
                            {siErr}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tees</CardTitle>
          <CardDescription>
            Rating (50–80) and slope (55–155) per tee, men&apos;s or
            women&apos;s. These feed WHS course-handicap math at event time.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {tees.length === 0 ? (
            <p className="text-sm text-destructive" role="alert">
              Add at least one tee with its rating and slope.
            </p>
          ) : null}
          {tees.map((tee, index) => {
            const key = String(index);
            const nameErr = fieldError(errors, `tees.${key}.name`);
            const genderErr = fieldError(errors, `tees.${key}.gender`);
            const ratingErr = fieldError(
              errors,
              `tees.${key}.courseRating`,
            );
            const slopeErr = fieldError(errors, `tees.${key}.slopeRating`);
            return (
              <div
                key={tee.id ?? `new-${key}`}
                className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-3"
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`tee-name-${key}`}>Tee name</Label>
                  <Input
                    id={`tee-name-${key}`}
                    value={tee.name}
                    disabled={readOnly}
                    onChange={(event) =>
                      updateTee(index, { name: event.target.value })
                    }
                    aria-invalid={Boolean(nameErr)}
                  />
                  {nameErr ? (
                    <p className="text-sm text-destructive">{nameErr}</p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`tee-color-${key}`}>Color (optional)</Label>
                  <Input
                    id={`tee-color-${key}`}
                    value={tee.color}
                    disabled={readOnly}
                    onChange={(event) =>
                      updateTee(index, { color: event.target.value })
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`tee-gender-${key}`}>Ratings for</Label>
                  <select
                    id={`tee-gender-${key}`}
                    value={tee.gender}
                    disabled={readOnly}
                    onChange={(event) =>
                      updateTee(index, {
                        gender: event.target.value as TeeDraft["gender"],
                      })
                    }
                    className={STRING_SELECT_CLASS}
                    aria-invalid={Boolean(genderErr)}
                  >
                    {TEE_GENDERS.map((gender) => (
                      <option key={gender} value={gender} className="bg-card">
                        {gender === "mens" ? "Men" : "Women"}
                      </option>
                    ))}
                  </select>
                  {genderErr ? (
                    <p className="text-sm text-destructive">{genderErr}</p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`tee-rating-${key}`}>Course rating</Label>
                  <Input
                    id={`tee-rating-${key}`}
                    inputMode="decimal"
                    className="numeric"
                    value={tee.courseRating}
                    disabled={readOnly}
                    onChange={(event) =>
                      updateTee(index, { courseRating: event.target.value })
                    }
                    aria-invalid={Boolean(ratingErr)}
                  />
                  {ratingErr ? (
                    <p className="text-sm text-destructive">{ratingErr}</p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`tee-slope-${key}`}>Slope</Label>
                  <Input
                    id={`tee-slope-${key}`}
                    inputMode="numeric"
                    className="numeric"
                    value={tee.slopeRating}
                    disabled={readOnly}
                    onChange={(event) =>
                      updateTee(index, { slopeRating: event.target.value })
                    }
                    aria-invalid={Boolean(slopeErr)}
                  />
                  {slopeErr ? (
                    <p className="text-sm text-destructive">{slopeErr}</p>
                  ) : null}
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="gap-1"
                    disabled={readOnly}
                    onClick={() => removeTee(index)}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    Remove tee
                  </Button>
                </div>
              </div>
            );
          })}
          {!readOnly ? (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={addTee}
              >
                <Plus className="size-3.5" aria-hidden />
                Add tee
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {actionState.error ? (
        <p className="text-sm text-destructive" role="alert">
          {actionState.error}
        </p>
      ) : null}
      {actionState.saved && !actionState.error ? (
        <p className="text-sm text-foreground" role="status">
          {COURSE_SAVED_MESSAGE}
        </p>
      ) : null}

      {!readOnly ? (
        <div>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Saving…" : "Save course"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
