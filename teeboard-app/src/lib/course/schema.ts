import { z } from "zod";

/**
 * Shared client/server contract for the course editor (M4-T001): course
 * meta, the 9/18-hole scorecard grid (par, stroke index, yards per hole),
 * and tee definitions with per-gender rating and slope. The editor form and
 * the save server action validate against these single schemas, so what
 * staff confirm client-side is exactly what the server enforces.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const COURSE_HOLES_COUNTS = [9, 18] as const;
export type CourseHolesCount = (typeof COURSE_HOLES_COUNTS)[number];

/** A 9-hole event plays either the front (1–9) or back (10–18) nine. */
export const NINE_OPTIONS = ["front", "back"] as const;
export type NineOption = (typeof NINE_OPTIONS)[number];

export const TEE_GENDERS = ["mens", "womens"] as const;
export type TeeGender = (typeof TEE_GENDERS)[number];

export const PAR_MIN_PER_HOLE = 3;
export const PAR_MAX_PER_HOLE = 6;
export const YARDS_MAX = 800;

/** Course par totals: 54–90 for 18 holes, 27–45 for 9. */
export const PAR_TOTAL_9 = { min: 27, max: 45 } as const;
export const PAR_TOTAL_18 = { min: 54, max: 90 } as const;

/** USGA tee bounds. */
export const RATING_MIN = 50;
export const RATING_MAX = 80;
export const SLOPE_MIN = 55;
export const SLOPE_MAX = 155;

/** Par-total bounds for a 9- or 18-hole course. */
export function parTotalBounds(holesCount: CourseHolesCount): {
  min: number;
  max: number;
} {
  return holesCount === 9 ? PAR_TOTAL_9 : PAR_TOTAL_18;
}

// ─── Cell schemas (blank-tolerant form inputs) ─────────────────────────────────

/**
 * A blank cell ("", null, undefined) is allowed mid-edit — the editor treats
 * blanks as "not filled in yet" — but any present value must be a whole
 * number inside the bounds. Blankness itself raises "enter a value" so the
 * user gets a field-level message instead of a silent zero.
 */
function blankableInt(
  min: number,
  max: number,
  blankMessage: string,
  wholeMessage = "Enter a whole number.",
) {
  return z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((raw): number | null => {
      if (raw === null || raw === undefined) return null;
      if (typeof raw === "number") return Number.isInteger(raw) ? raw : NaN;
      const trimmed = raw.trim();
      if (trimmed === "") return null;
      const parsed = Number(trimmed);
      return Number.isInteger(parsed) ? parsed : NaN;
    })
    .superRefine((value, ctx) => {
      if (value === null) {
        ctx.addIssue({ code: "custom", message: blankMessage });
      } else if (Number.isNaN(value)) {
        ctx.addIssue({ code: "custom", message: wholeMessage });
      } else if (value < min || value > max) {
        ctx.addIssue({
          code: "custom",
          message: `Enter a number between ${min} and ${max}.`,
        });
      }
    });
}

export const parCellSchema = blankableInt(
  PAR_MIN_PER_HOLE,
  PAR_MAX_PER_HOLE,
  "Enter the hole's par (3–6).",
);

export const strokeIndexCellSchema = blankableInt(
  1,
  18,
  "Enter the stroke index (1 = hardest hole).",
);

/** Yards are optional per hole (some scorecards omit them). */
export const yardsCellSchema = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((raw): number | null | typeof NaN => {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "number") return raw;
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? NaN : parsed;
  })
  .superRefine((value, ctx) => {
    if (value === null) return;
    if (Number.isNaN(value)) {
      ctx.addIssue({ code: "custom", message: "Enter a number of yards." });
    } else if (!Number.isInteger(value)) {
      ctx.addIssue({ code: "custom", message: "Enter whole yards." });
    } else if (value < 0 || value > YARDS_MAX) {
      ctx.addIssue({
        code: "custom",
        message: `Yards must be between 0 and ${YARDS_MAX}.`,
      });
    }
  });

export const holeRowSchema = z.object({
  holeNumber: z.coerce.number().int().min(1).max(18),
  par: parCellSchema,
  strokeIndex: strokeIndexCellSchema,
  yards: yardsCellSchema,
});

export type HoleRow = z.output<typeof holeRowSchema>;

// ─── Cross-hole checks ───────────────────────────────────────────────────────

/**
 * Stroke indexes must form a unique permutation of 1..holesCount. Issues
 * land on the exact `holes[i].strokeIndex` paths so the grid can flag the
 * conflicting cells; messages name the holes and the duplicate value.
 */
export function validateStrokeIndexes(
  rows: readonly HoleRow[],
  holesCount: CourseHolesCount,
  ctx: z.RefinementCtx,
): void {
  const seen = new Map<number, number[]>();

  rows.forEach((row, i) => {
    const si = row.strokeIndex;
    if (si === null) return; // blank handled by the cell schema
    if (si < 1 || si > holesCount) {
      ctx.addIssue({
        code: "custom",
        path: ["holes", i, "strokeIndex"],
        message: `Stroke index must be between 1 and ${holesCount} on a ${holesCount}-hole course.`,
      });
      return;
    }
    const list = seen.get(si) ?? [];
    list.push(row.holeNumber);
    seen.set(si, list);
  });

  const missing: number[] = [];
  for (let si = 1; si <= holesCount; si += 1) {
    if (!seen.has(si)) missing.push(si);
  }
  if (missing.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["holes"],
      message:
        `Stroke indexes must use every value from 1 to ${holesCount} exactly once — ` +
        `missing ${missing.join(", ")}.`,
    });
  }

  for (const [si, holeNumbers] of seen) {
    if (holeNumbers.length > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["holes"],
        message: `Duplicate stroke index ${si} — holes ${holeNumbers.join(" and ")} both use it. Give each hole a unique stroke index.`,
      });
    }
  }
}

/**
 * Par-total check with the 9/18-specific bounds. Issues land on every par
 * cell so the whole row lights up; blanks are skipped (the cell schema
 * already flags them).
 */
export function validateParTotal(
  rows: readonly HoleRow[],
  holesCount: CourseHolesCount,
  ctx: z.RefinementCtx,
): void {
  const { min, max } = parTotalBounds(holesCount);
  if (rows.some((row) => row.par === null)) return;
  const total = rows.reduce((sum: number, row) => sum + (row.par ?? 0), 0);
  if (total < min || total > max) {
    const message =
      `The pars add up to ${total} — a ${holesCount}-hole course ` +
      `must total ${min}–${max}. Adjust the pars.`;
    rows.forEach((_, i) => {
      ctx.addIssue({ code: "custom", path: ["holes", i, "par"], message });
    });
  }
}

// ─── Tee cells ────────────────────────────────────────────────────────────────

function decimalCell() {
  return z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((raw): number | null => {
      if (raw === null || raw === undefined) return null;
      if (typeof raw === "number") return raw;
      const trimmed = raw.trim();
      if (trimmed === "") return null;
      const parsed = Number(trimmed);
      return Number.isNaN(parsed) ? NaN : parsed;
    });
}

/** USGA course rating: 50–80, at most one decimal place. */
export const teeCourseRatingCell = decimalCell().superRefine(
  (value, ctx) => {
    if (value === null) {
      ctx.addIssue({
        code: "custom",
        message: `Enter the course rating (${RATING_MIN}–${RATING_MAX}).`,
      });
    } else if (Number.isNaN(value)) {
      ctx.addIssue({ code: "custom", message: "Enter a number, e.g. 71.2." });
    } else if (value < RATING_MIN || value > RATING_MAX) {
      ctx.addIssue({
        code: "custom",
        message: `Course rating must be between ${RATING_MIN} and ${RATING_MAX}.`,
      });
    } else if (Math.round(value * 10) !== value * 10) {
      ctx.addIssue({
        code: "custom",
        message: "Use at most one decimal place (e.g. 71.2).",
      });
    }
  },
);

/** USGA slope rating: 55–155, whole number. */
export const teeSlopeCell = decimalCell().superRefine((value, ctx) => {
  if (value === null) {
    ctx.addIssue({
      code: "custom",
      message: `Enter the slope rating (${SLOPE_MIN}–${SLOPE_MAX}).`,
    });
  } else if (Number.isNaN(value)) {
    ctx.addIssue({ code: "custom", message: "Enter a number, e.g. 128." });
  } else if (!Number.isInteger(value)) {
    ctx.addIssue({ code: "custom", message: "Slope is a whole number." });
  } else if (value < SLOPE_MIN || value > SLOPE_MAX) {
    ctx.addIssue({
      code: "custom",
      message: `Slope must be between ${SLOPE_MIN} and ${SLOPE_MAX}.`,
    });
  }
});

/**
 * Optional text cell: "", null, and undefined all mean "not set" (stored as
 * null); anything else is trimmed and length-checked.
 */
function optionalNullable(max: number, message: string) {
  return z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (typeof v === "string" ? v.trim() : ""))
    .refine((v) => v === "" || v.length <= max, { message })
    .transform((v) => (v === "" ? null : v));
}

export const teeSchema = z.object({
  id: z.string().optional(),
  name: z
    .string()
    .trim()
    .min(1, "Enter the tee's name (e.g. Blue).")
    .max(60, "Tee names are 60 characters or fewer."),
  color: optionalNullable(40, "Colors are 40 characters or fewer."),
  gender: z.enum(TEE_GENDERS, "Choose men's or women's ratings."),
  courseRating: teeCourseRatingCell,
  slopeRating: teeSlopeCell,
});

export type Tee = z.output<typeof teeSchema>;

// ─── Course schema ────────────────────────────────────────────────────────────

export const courseSchema = z
  .object({
    id: z.string().optional(),
    name: z
      .string()
      .trim()
      .min(1, "Enter the course name.")
      .max(160, "Course names are 160 characters or fewer."),
    city: optionalNullable(120, "City names are 120 characters or fewer."),
    state: optionalNullable(60, "State/province is 60 characters or fewer."),
    country: z
      .string()
      .trim()
      .min(1, "Enter the country (e.g. US).")
      .max(60, "Country is 60 characters or fewer.")
      .default("US"),
    holesCount: z.coerce
      .number()
      .int()
      .refine(
        (v): v is CourseHolesCount => v === 9 || v === 18,
        "Choose 9 or 18 holes.",
      ),
    nineOption: z.enum(NINE_OPTIONS).default("front"),
    holes: z.array(holeRowSchema),
    tees: z
      .array(teeSchema)
      .min(1, "Add at least one tee with its rating and slope."),
  })
  .superRefine((course, ctx) => {
    const holesCount: CourseHolesCount =
      course.holesCount === 9 ? 9 : 18;

    if (course.holes.length !== holesCount) {
      ctx.addIssue({
        code: "custom",
        path: ["holes"],
        message: `A ${holesCount}-hole course needs exactly ${holesCount} hole rows.`,
      });
    }

    // Hole numbers must sit inside the selected nine for 9-hole courses.
    const expected = course.holesCount === 9
      ? course.nineOption === "back"
        ? Array.from({ length: 9 }, (_, i) => 10 + i)
        : Array.from({ length: 9 }, (_, i) => 1 + i)
      : Array.from({ length: 18 }, (_, i) => 1 + i);

    course.holes.forEach((hole, i) => {
      if (!expected.includes(hole.holeNumber)) {
        const range =
          course.holesCount === 9
            ? course.nineOption === "back"
              ? "10–18"
              : "1–9"
            : "1–18";
        ctx.addIssue({
          code: "custom",
          path: ["holes", i, "holeNumber"],
          message: `Hole ${hole.holeNumber} is outside the ${range} this course plays.`,
        });
      }
    });

    const holeNumbers = course.holes.map((h) => h.holeNumber);
    const duplicates = holeNumbers.filter(
      (n, i) => holeNumbers.indexOf(n) !== i,
    );
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["holes"],
        message: `Duplicate hole number${duplicates.length > 1 ? "s" : ""}: ${duplicates.join(", ")}.`,
      });
    }

    validateStrokeIndexes(course.holes, holesCount, ctx);
    validateParTotal(course.holes, holesCount, ctx);

    // tee_sets enforces unique (course_id, name, gender) — mirror it here so
    // the user gets a field-level message instead of a database error.
    for (let i = 0; i < course.tees.length; i += 1) {
      for (let j = i + 1; j < course.tees.length; j += 1) {
        const a = course.tees[i]!;
        const b = course.tees[j]!;
        if (
          a.name.toLowerCase() === b.name.toLowerCase() &&
          a.gender === b.gender
        ) {
          const whose = a.gender === "mens" ? "men's" : "women's";
          ctx.addIssue({
            code: "custom",
            path: ["tees", j, "name"],
            message: `Two ${whose} tees can't both be named "${b.name}" — give each a unique name.`,
          });
        }
      }
    }
  });

export type CourseInput = z.input<typeof courseSchema>;
export type Course = z.output<typeof courseSchema>;

export type CourseActionState = {
  readonly error?: string;
  readonly fields?: Record<string, string>;
  readonly saved?: boolean;
};

export const COURSE_SAVED_MESSAGE = "Course saved.";
export const COURSE_DELETED_MESSAGE = "Course deleted.";