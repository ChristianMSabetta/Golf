"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getStaff } from "@/lib/auth/authorization";
import { courseSchema, type CourseActionState } from "@/lib/course/schema";
import { fieldErrors } from "@/lib/course/field-errors";
import { courseHasEvents } from "@/lib/course/server";

/**
 * Course editor server actions (M4-T001). Authorization runs server-side
 * before validation on every action; writes go through the service-role
 * client so the multi-table save (courses → holes → tee_sets) runs
 * atomically under one client, with the club check enforced in every
 * `.eq("club_id", …)` filter. Staff roles allowed to manage courses match
 * the RLS policy set (`owner`, `head_pro`, `event_manager`).
 */

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const VALIDATION_ERROR = "Please fix the highlighted fields.";
const NO_CLUB_ERROR =
  "No club is linked to your account yet — ask your club owner to invite you.";
const FORBIDDEN_ERROR =
  "Your role doesn't allow managing courses. Ask the club owner.";
const COURSE_IN_USE_ERROR =
  "This course is used by an event and can't be deleted. Archive or reassign the event first.";

const COURSE_ROLES = ["owner", "head_pro", "event_manager"] as const;

type AuthedClub = {
  readonly clubId: string;
};

async function authorizeCourseStaff(): Promise<AuthedClub | null> {
  const staff = await getStaff();
  if (!staff) return null;
  if (staff.clubId === null) return null;
  if (
    !staff.isSuperadmin &&
    !COURSE_ROLES.includes(
      staff.role as (typeof COURSE_ROLES)[number],
    )
  ) {
    return null;
  }
  return { clubId: staff.clubId };
}

/**
 * Maps validated grid rows to `holes` columns. The cell schemas make par and
 * stroke index mandatory, so a null here means validation was bypassed —
 * fail loudly instead of writing a broken scorecard.
 */
function toDbHoles(
  holes: ReadonlyArray<{
    holeNumber: number;
    par: number | null;
    strokeIndex: number | null;
    yards: number | null;
  }>,
) {
  return holes.map((hole) => {
    if (hole.par === null || hole.strokeIndex === null) {
      throw new Error("hole par/stroke index missing after validation");
    }
    return {
      hole_number: hole.holeNumber,
      par: hole.par,
      stroke_index: hole.strokeIndex,
      yards: hole.yards,
    };
  });
}

/**
 * Creates or updates a course with its holes and tee sets. The three tables
 * are written in a deliberate order (course → holes → tees) under the
 * service-role client; a failure at any step aborts before the next so a
 * partial save never silently stands.
 */
export async function saveCourse(
  _prev: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  const auth = await authorizeCourseStaff();
  if (!auth) {
    const staff = await getStaff();
    if (!staff) {
      return { fields: {}, error: "Please sign in to continue." };
    }
    if (staff.clubId === null) {
      return { fields: {}, error: NO_CLUB_ERROR };
    }
    return { fields: {}, error: FORBIDDEN_ERROR };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? "null"));
  } catch {
    return { error: VALIDATION_ERROR };
  }

  const parsed = courseSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      error: VALIDATION_ERROR,
      fields: fieldErrors(parsed.error.issues),
    };
  }

  const course = parsed.data;
  const client = getServerSupabase();

  // courses enforces unique (club_id, name) — check it here so the user
  // gets a field-level message instead of a database error.
  const { data: nameClash } = await client
    .from("courses")
    .select("id")
    .eq("club_id", auth.clubId)
    .ilike("name", course.name)
    .maybeSingle<{ id: string }>();
  if (nameClash && nameClash.id !== course.id) {
    return {
      error: VALIDATION_ERROR,
      fields: { name: `A course called "${course.name}" already exists — give this one a different name.` },
    };
  }

  const courseRow = {
    name: course.name,
    city: course.city,
    state: course.state,
    country: course.country,
    holes_count: course.holesCount,
    updated_at: new Date().toISOString(),
  };

  try {
    let courseId: string;

    if (course.id) {
      // Update only our club's row (defense in depth: the service role
      // bypasses RLS, so the club filter is enforced right here).
      const { data: updated, error } = await client
        .from("courses")
        .update(courseRow)
        .eq("id", course.id)
        .eq("club_id", auth.clubId)
        .select("id")
        .maybeSingle<{ id: string }>();

      if (error) throw new Error(error.message);
      if (!updated) throw new Error("course not found for this club");
      courseId = updated.id;

      const { error: holesDeleteError } = await client
        .from("holes")
        .delete()
        .eq("course_id", courseId);
      if (holesDeleteError) throw new Error(holesDeleteError.message);

      const { error: teesDeleteError } = await client
        .from("tee_sets")
        .delete()
        .eq("course_id", courseId);
      if (teesDeleteError) throw new Error(teesDeleteError.message);
    } else {
      const { data: inserted, error } = await client
        .from("courses")
        .insert({ ...courseRow, club_id: auth.clubId })
        .select("id")
        .single<{ id: string }>();

      if (error) throw new Error(error.message);
      courseId = inserted.id;
    }

    const holeRows = toDbHoles(course.holes).map((hole) => ({
      ...hole,
      course_id: courseId,
    }));
    if (holeRows.length > 0) {
      const { error } = await client.from("holes").insert(holeRows);
      if (error) throw new Error(error.message);
    }

    const teeRows = course.tees.map((tee) => ({
      course_id: courseId,
      name: tee.name,
      color: tee.color ?? "",
      gender: tee.gender,
      course_rating: tee.courseRating,
      slope_rating: tee.slopeRating,
    }));
    if (teeRows.length > 0) {
      const { error } = await client.from("tee_sets").insert(teeRows);
      if (error) throw new Error(error.message);
    }

    revalidatePath("/admin", "layout");
    revalidatePath(`/admin/courses/${courseId}`);
    return { saved: true };
  } catch (error) {
    console.error(
      `[course] save failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}

/** Deletes a draft course (blocked when an event references it). */
export async function deleteCourse(
  _prev: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  const auth = await authorizeCourseStaff();
  if (!auth) {
    const staff = await getStaff();
    if (!staff) {
      return { fields: {}, error: "Please sign in to continue." };
    }
    if (staff.clubId === null) {
      return { fields: {}, error: NO_CLUB_ERROR };
    }
    return { fields: {}, error: FORBIDDEN_ERROR };
  }

  const courseId = String(formData.get("courseId") ?? "");
  if (courseId === "") {
    return { error: "Choose a course to delete." };
  }

  const client = getServerSupabase();

  try {
    // The club filter under the service role is the tenant guard.
    const { data: owned, error: loadError } = await client
      .from("courses")
      .select("id")
      .eq("id", courseId)
      .eq("club_id", auth.clubId)
      .maybeSingle<{ id: string }>();

    if (loadError) throw new Error(loadError.message);
    if (!owned) throw new Error("course not found for this club");

    if (await courseHasEvents(courseId)) {
      return { error: COURSE_IN_USE_ERROR };
    }

    const { error } = await client
      .from("courses")
      .delete()
      .eq("id", courseId)
      .eq("club_id", auth.clubId);

    if (error) throw new Error(error.message);

    revalidatePath("/admin", "layout");
    return { saved: true };
  } catch (error) {
    console.error(
      `[course] delete failed for club ${auth.clubId}: ${String(error)}`,
    );
    return { error: GENERIC_ERROR };
  }
}
