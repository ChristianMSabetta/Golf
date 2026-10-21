import { describe, expect, it } from "vitest";
import {
  courseSchema,
  parTotalBounds,
  type CourseInput,
  type HoleRow,
} from "./schema";
import { parseScorecardText } from "./parse-scorecard";
import { fieldErrors } from "./field-errors";

// ─── helpers ────────────────────────────────────────────────────────────────

function validHoles(count: 9 | 18, offset = 0): HoleRow[] {
  // A true permutation of 1..count (par stays 4 so 18 holes total 72).
  const order = Array.from({ length: count }, (_, i) => (i * 7 + 3) % count);
  return Array.from({ length: count }, (_, i) => ({
    holeNumber: i + 1 + offset,
    par: 4,
    strokeIndex: order.indexOf(i) + 1,
    yards: 350 + i,
  }));
}

function validTees() {
  return [
    {
      name: "Blue",
      color: "blue",
      gender: "mens" as const,
      courseRating: 71.2,
      slopeRating: 128,
    },
  ];
}

function validCourse(overrides: Partial<CourseInput> = {}): CourseInput {
  return {
    name: "Championship Course",
    city: "Austin",
    state: "TX",
    country: "US",
    holesCount: 18,
    nineOption: "front",
    holes: validHoles(18),
    tees: validTees(),
    ...overrides,
  };
}

// ─── scorecard validation ─────────────────────────────────────────────────────

describe("courseSchema", () => {
  it("accepts a valid 18-hole course", () => {
    const result = courseSchema.safeParse(validCourse());
    expect(result.success).toBe(true);
  });

  it("accepts a valid 9-hole course (front nine)", () => {
    const result = courseSchema.safeParse(
      validCourse({
        holesCount: 9,
        nineOption: "front",
        holes: validHoles(9),
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a valid 9-hole course (back nine, holes 10–18)", () => {
    const result = courseSchema.safeParse(
      validCourse({
        holesCount: 9,
        nineOption: "back",
        holes: validHoles(9, 9),
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a 9-hole course carrying 18 hole rows", () => {
    const result = courseSchema.safeParse(
      validCourse({ holesCount: 9, holes: validHoles(18) }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          String(i.message).includes("exactly 9 hole rows"),
        ),
      ).toBe(true);
    }
  });

  it("rejects a 9-hole course whose rows sit outside the selected nine", () => {
    const result = courseSchema.safeParse(
      validCourse({
        holesCount: 9,
        nineOption: "back",
        holes: validHoles(9), // rows are 1–9 but "back" plays 10–18
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = fieldErrors(result.error.issues);
      expect(fields["holes.0.holeNumber"]).toContain(
        "outside the 10–18",
      );
    }
  });

  it("rejects an 18-hole course carrying rows for holes 10–18 twice", () => {
    const result = courseSchema.safeParse(
      validCourse({ holes: [...validHoles(18), ...validHoles(9, 9)] }),
    );
    expect(result.success).toBe(false); // 27 rows ≠ 18, duplicates flagged
  });

  it("rejects an invalid holesCount", () => {
    const result = courseSchema.safeParse(
      validCourse({ holesCount: 12 as unknown as 9 }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a blank course name with a clear message", () => {
    const result = courseSchema.safeParse(validCourse({ name: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Enter the course name.",
      );
    }
  });
});

// ─── stroke index uniqueness ─────────────────────────────────────────────────

describe("stroke index uniqueness", () => {
  it("rejects duplicate stroke indexes, naming both holes", () => {
    const holes = validHoles(18);
    const dup = [...holes];
    if (dup[1] && dup[5]) {
      dup[1] = { ...dup[1]!, strokeIndex: dup[5]!.strokeIndex };
    }

    const result = courseSchema.safeParse(validCourse({ holes: dup }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) =>
        i.message.includes("Duplicate stroke index"),
      )).toBe(true);
      expect(result.error.issues.some((i) =>
        i.message.includes("holes 2 and 6"),
      )).toBe(true);
    }
  });

  it("rejects a missing stroke index (not a full permutation)", () => {
    const holes = validHoles(18);
    const broken = [...holes];
    if (broken[3]) {
      broken[3] = { ...broken[3]!, strokeIndex: broken[0]!.strokeIndex };
    }

    const result = courseSchema.safeParse(validCourse({ holes: broken }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) =>
        i.message.includes("must use every value from 1 to 18"),
      )).toBe(true);
    }
  });

  it("flags a blank stroke index cell on the exact hole", () => {
    const holes = validHoles(18);
    const blanked = [...holes];
    if (blanked[4]) {
      blanked[4] = { ...blanked[4]!, strokeIndex: "" as unknown as number };
    }

    const result = courseSchema.safeParse(validCourse({ holes: blanked }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = fieldErrors(result.error.issues);
      expect(fields["holes.4.strokeIndex"]).toBe(
        "Enter the stroke index (1 = hardest hole).",
      );
    }
  });

  it("on a 9-hole course, stroke index 10 is out of range", () => {
    const holes = validHoles(9);
    const outOfRange = [...holes];
    if (outOfRange[0]) {
      outOfRange[0] = { ...outOfRange[0]!, strokeIndex: 10 };
    }

    const result = courseSchema.safeParse(
      validCourse({ holesCount: 9, holes: outOfRange }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = fieldErrors(result.error.issues);
      expect(fields["holes.0.strokeIndex"]).toBe(
        "Stroke index must be between 1 and 9 on a 9-hole course.",
      );
    }
  });
});

// ─── par totals ───────────────────────────────────────────────────────────────

describe("par totals", () => {
  it("exposes 54–90 for 18 and 27–45 for 9", () => {
    expect(parTotalBounds(18)).toEqual({ min: 54, max: 90 });
    expect(parTotalBounds(9)).toEqual({ min: 27, max: 45 });
  });

  it("rejects an 18-hole par total over 90", () => {
    const holes = validHoles(18);
    const inflated = holes.map((h) => ({ ...h, par: 6 }));

    const result = courseSchema.safeParse(validCourse({ holes: inflated }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) =>
        i.message.includes("must total 54–90"),
      )).toBe(true);
    }
  });

  it("rejects a 9-hole par total over 45 and accepts the 27 boundary", () => {
    const holes = validHoles(9);
    const inflated = holes.map((h) => ({ ...h, par: 6 }));

    const result = courseSchema.safeParse(
      validCourse({ holesCount: 9, holes: inflated }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) =>
        i.message.includes("must total 27–45"),
      )).toBe(true);
    }

    const boundary = holes.map((h) => ({ ...h, par: 3 }));
    expect(
      courseSchema.safeParse(
        validCourse({ holesCount: 9, holes: boundary }),
      ).success,
    ).toBe(true);
  });

  it("treats 54 and 90 as the inclusive 18-hole par-total boundaries", () => {
    const holes = validHoles(18);
    const allPar3 = holes.map((h) => ({ ...h, par: 3 }));
    const allPar5 = holes.map((h) => ({ ...h, par: 5 }));

    expect(
      courseSchema.safeParse(validCourse({ holes: allPar3 })).success,
    ).toBe(true); // 54 = inclusive low boundary
    expect(
      courseSchema.safeParse(validCourse({ holes: allPar5 })).success,
    ).toBe(true); // 90 = inclusive high boundary

    const over = holes.map((h) => ({ ...h, par: 6 }));
    const result = courseSchema.safeParse(validCourse({ holes: over }));
    expect(result.success).toBe(false); // 108 > 90
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("must total 54–90"))).toBe(true);
    }
  });

  it("flags per-hole par out of 3–6 on the exact cell", () => {
    const holes = validHoles(18);
    const bad = [...holes];
    if (bad[7]) {
      bad[7] = { ...bad[7]!, par: 9 };
    }

    const result = courseSchema.safeParse(validCourse({ holes: bad }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = fieldErrors(result.error.issues);
      expect(fields["holes.7.par"]).toBe("Enter a number between 3 and 6.");
    }
  });
});

// ─── tee validations ────────────────────────────────────────────────────────

describe("tee validations", () => {
  it("rejects slope out of 55–155 on the exact tee", () => {
    const tees = [
      { ...validTees()[0]!, slopeRating: 200 },
    ];
    const result = courseSchema.safeParse(validCourse({ tees }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = fieldErrors(result.error.issues);
      expect(fields["tees.0.slopeRating"]).toBe(
        "Slope must be between 55 and 155.",
      );
    }
  });

  it("rejects rating out of 50–80 on the exact tee", () => {
    const tees = [{ ...validTees()[0]!, courseRating: 48 }];
    const result = courseSchema.safeParse(validCourse({ tees }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = fieldErrors(result.error.issues);
      expect(fields["tees.0.courseRating"]).toBe(
        "Course rating must be between 50 and 80.",
      );
    }
  });

  it("accepts a rating with one decimal place", () => {
    const tees = [{ ...validTees()[0]!, courseRating: 72.5 }];
    expect(courseSchema.safeParse(validCourse({ tees })).success).toBe(true);
  });

  it("rejects a rating with two decimal places", () => {
    const tees = [{ ...validTees()[0]!, courseRating: 72.51 }];
    const result = courseSchema.safeParse(validCourse({ tees }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = fieldErrors(result.error.issues);
      expect(fields["tees.0.courseRating"]).toBe(
        "Use at most one decimal place (e.g. 71.2).",
      );
    }
  });

  it("rejects duplicate tee names within a gender, allows across genders", () => {
    const tees = [
      { ...validTees()[0]!, name: "Blue", gender: "mens" as const },
      {
        name: "Blue",
        color: null,
        gender: "mens" as const,
        courseRating: 71.2,
        slopeRating: 128,
      },
    ];
    const result = courseSchema.safeParse(validCourse({ tees }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = fieldErrors(result.error.issues);
      expect(fields["tees.1.name"]).toContain("unique name");
    }

    const crossGender = courseSchema.safeParse(
      validCourse({
        tees: [
          { ...validTees()[0]!, name: "Blue", gender: "mens" as const },
          {
            name: "Blue",
            color: null,
            gender: "womens" as const,
            courseRating: 70.1,
            slopeRating: 120,
          },
        ],
      }),
    );
    expect(crossGender.success).toBe(true);
  });

  it("requires at least one tee", () => {
    const result = courseSchema.safeParse(validCourse({ tees: [] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("at least one tee");
    }
  });
});

// ─── paste-from-scorecard parser ────────────────────────────────────────────

describe("parseScorecardText", () => {
  it("parses a plain positional scorecard (hole par yards si)", () => {
    const text = [
      "1 4 401 7",
      "2 3 178 13",
      "3 5 512 3",
    ].join("\n");

    const { rows, matchedLines } = parseScorecardText(text);
    expect(matchedLines).toBe(3);
    expect(rows[0]).toEqual({
      holeNumber: 1,
      par: 4,
      yards: 401,
      strokeIndex: 7,
    });
    expect(rows[1]).toEqual({
      holeNumber: 2,
      par: 3,
      yards: 178,
      strokeIndex: 13,
    });
    expect(rows[17]).toEqual({
      holeNumber: 18,
      par: null,
      strokeIndex: null,
      yards: null,
    });
  });

  it("parses a three-column scorecard without yards (hole par si)", () => {
    const text = "5\t4\t11";
    const { rows } = parseScorecardText(text);
    expect(rows[4]).toEqual({
      holeNumber: 5,
      par: 4,
      yards: null,
      strokeIndex: 11,
    });
  });

  it("parses labeled rows like 'Hole 1 Par 4 380 yards SI 7'", () => {
    const text = "Hole 1 Par 4 380 yards SI 7";
    const { rows } = parseScorecardText(text);
    expect(rows[0]).toEqual({
      holeNumber: 1,
      par: 4,
      yards: 380,
      strokeIndex: 7,
    });
  });

  it("skips a header line without failing", () => {
    const text = ["HOLE PAR YARDS SI", "1 4 401 7"].join("\n");
    const { rows, matchedLines } = parseScorecardText(text);
    expect(matchedLines).toBe(1);
    expect(rows[0]?.par).toBe(4);
  });

  it("skips prose and blank lines", () => {
    const text = [
      "",
      "Championship Course — scorecard",
      "1 4 401 7",
      "",
      "OUT 36",
    ].join("\n");
    const { matchedLines, rows } = parseScorecardText(text);
    expect(matchedLines).toBe(1);
    expect(rows[0]?.par).toBe(4);
  });

  it("supports 9-hole pastes and fills the rest with nulls", () => {
    const text = [
      "1 4 380 5",
      "2 4 395 11",
      "3 3 150 15",
      "4 5 520 1",
    ].join("\n");
    const { rows, matchedLines } = parseScorecardText(text);
    expect(matchedLines).toBe(4);
    expect(rows[3]).toEqual({
      holeNumber: 4,
      par: 5,
      yards: 520,
      strokeIndex: 1,
    });
    expect(rows[9]).toEqual({
      holeNumber: 10,
      par: null,
      strokeIndex: null,
      yards: null,
    });
  });

  it("keeps the last paste for duplicate hole rows (corrections win)", () => {
    const text = ["1 4 380 5", "1 4 391 6"].join("\n");
    const { rows } = parseScorecardText(text);
    expect(rows[0]?.yards).toBe(391);
    expect(rows[0]?.strokeIndex).toBe(6);
  });

  it("feeds straight into the schema — a full paste validates", () => {
    const text = Array.from(
      { length: 18 },
      (_, i) => `${i + 1} 4 ${350 + i} ${((i * 5) % 18) + 1}`,
    ).join("\n");
    const { rows } = parseScorecardText(text);
    const result = courseSchema.safeParse(
      validCourse({ holes: rows }),
    );
    expect(result.success).toBe(true);
  });
});
