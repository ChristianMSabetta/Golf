import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/authorization";
import { getStaffClub } from "@/lib/club/server";
import { getCourseDetail } from "@/lib/course/server";
import { CourseEditor } from "@/components/admin/course-editor/course-editor";

// Session-dependent: never prerendered at build time.
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { id } = await params;
  const detail = await getCourseDetail(id);
  return { title: detail ? `Edit ${detail.name}` : "Course" };
}

/**
 * The 18-hole scorecard editor for an existing course (M4-T001): par,
 * stroke index, and yards per hole, plus tee definitions with per-gender
 * rating and slope, and the paste-from-scorecard parser.
 */
export default async function EditCoursePage({ params }: { params: Params }) {
  await requireStaff();
  const context = await getStaffClub();
  const { id } = await params;
  const detail = await getCourseDetail(id);

  if (!detail) notFound();

  const canEdit =
    context !== null &&
    (context.staff.isSuperadmin ||
      ["owner", "head_pro", "event_manager"].includes(context.staff.role));

  return (
    <CourseEditor
      course={{
        id: detail.id,
        name: detail.name,
        city: detail.city ?? "",
        state: detail.state ?? "",
        country: detail.country,
        holesCount: detail.holesCount,
        nineOption:
          detail.holesCount === 9 &&
          detail.holes.some((h) => h.holeNumber > 9)
            ? "back"
            : "front",
        holes: detail.holes.map((h) => ({
          holeNumber: h.holeNumber,
          par: h.par,
          strokeIndex: h.strokeIndex,
          yards: h.yards,
        })),
        tees: detail.tees.map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color ?? "",
          gender: t.gender,
          courseRating: t.courseRating,
          slopeRating: t.slopeRating,
        })),
      }}
      readOnly={!canEdit}
    />
  );
}
