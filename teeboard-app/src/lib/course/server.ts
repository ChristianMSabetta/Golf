import "server-only";
import { cache } from "react";
import { getRequestSupabase } from "@/lib/supabase/server";

/**
 * RLS-respecting course data access (M4-T001). Every read goes through the
 * request-bound client so PostgREST applies the signed-in staff member's
 * club policies — another club's rows are simply invisible.
 */

export type CourseSummary = {
  readonly id: string;
  readonly name: string;
  readonly city: string | null;
  readonly state: string | null;
  readonly country: string;
  readonly holesCount: 9 | 18;
};

export type HoleRecord = {
  readonly holeNumber: number;
  readonly par: number;
  readonly strokeIndex: number;
  readonly yards: number | null;
};

export type TeeRecord = {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
  readonly gender: "mens" | "womens";
  readonly courseRating: number | null;
  readonly slopeRating: number | null;
};

export type CourseDetail = CourseSummary & {
  readonly holes: readonly HoleRecord[];
  readonly tees: readonly TeeRecord[];
};

type CourseRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string;
  holes_count: number;
};

type HoleDbRow = {
  hole_number: number;
  par: number;
  stroke_index: number;
  yards: number | null;
};

type TeeDbRow = {
  id: string;
  name: string;
  color: string | null;
  gender: "mens" | "womens";
  course_rating: number | string | null;
  slope_rating: number | null;
};

function toCourseSummary(row: CourseRow): CourseSummary {
  return Object.freeze({
    id: row.id,
    name: row.name,
    city: row.city,
    state: row.state,
    country: row.country,
    holesCount: row.holes_count === 9 ? 9 : 18,
  });
}

function toTee(row: TeeDbRow): TeeRecord {
  const rating =
    row.course_rating === null
      ? null
      : typeof row.course_rating === "string"
        ? Number(row.course_rating)
        : row.course_rating;
  return Object.freeze({
    id: row.id,
    name: row.name,
    color: row.color,
    gender: row.gender,
    courseRating: rating,
    slopeRating: row.slope_rating,
  });
}

/** Lists the signed-in club's courses, newest first. */
export async function listCourses(clubId: string): Promise<CourseSummary[]> {
  const client = await getRequestSupabase();
  const { data, error } = await client
    .from("courses")
    .select("id, name, city, state, country, holes_count")
    .eq("club_id", clubId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to list courses: ${error.message}`);
  }
  return (data ?? []).map(toCourseSummary);
}

/** Loads one course with its holes and tees; null when absent or not ours. */
export const getCourseDetail = cache(
  async (courseId: string): Promise<CourseDetail | null> => {
  const client = await getRequestSupabase();

  const { data: course, error: courseError } = await client
    .from("courses")
    .select("id, name, city, state, country, holes_count")
    .eq("id", courseId)
    .maybeSingle<CourseRow>();

  if (courseError) {
    throw new Error(`Failed to load course: ${courseError.message}`);
  }
  if (!course) return null;

  const { data: holes, error: holesError } = await client
    .from("holes")
    .select("hole_number, par, stroke_index, yards")
    .eq("course_id", courseId)
    .order("hole_number", { ascending: true });

  if (holesError) {
    throw new Error(`Failed to load holes: ${holesError.message}`);
  }

  const { data: tees, error: teesError } = await client
    .from("tee_sets")
    .select(
      "id, name, color, gender, course_rating, slope_rating",
    )
    .eq("course_id", courseId)
    .order("name", { ascending: true });

  if (teesError) {
    throw new Error(`Failed to load tee sets: ${teesError.message}`);
  }

  return Object.freeze({
    ...toCourseSummary(course),
    holes: (holes ?? []).map((h: HoleDbRow) =>
      Object.freeze({
        holeNumber: h.hole_number,
        par: h.par,
        strokeIndex: h.stroke_index,
        yards: h.yards,
      }),
    ),
    tees: (tees ?? []).map(toTee),
  });
  },
);

/**
 * Whether a course is referenced by any event — the guard for the delete
 * action's friendly error (`events.course_id` is `on delete restrict`).
 */
export const courseHasEvents = cache(
  async (courseId: string): Promise<boolean> => {
  const client = await getRequestSupabase();
  const { count, error } = await client
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("course_id", courseId);

  if (error) {
    throw new Error(`Failed to check course events: ${error.message}`);
  }
  return (count ?? 0) > 0;
  },
);
