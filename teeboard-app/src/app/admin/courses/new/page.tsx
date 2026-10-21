import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth/authorization";
import { getStaffClub } from "@/lib/club/server";
import { CourseEditor } from "@/components/admin/course-editor/course-editor";

export const metadata: Metadata = {
  title: "New course",
};

// Session-dependent: never prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * New-course editor (M4-T001): starts as a default 18-hole par-72 grid with
 * one starter tee; the paste-from-scorecard flow fills it from printed text.
 */
export default async function NewCoursePage() {
  await requireStaff();
  const context = await getStaffClub();

  const canEdit =
    context !== null &&
    (context.staff.isSuperadmin ||
      ["owner", "head_pro", "event_manager"].includes(context.staff.role));

  return (
    <CourseEditor
      course={{
        id: undefined,
        name: "",
        city: "",
        state: "",
        country: "US",
        holesCount: 18,
        nineOption: "front",
        holes: Array.from({ length: 18 }, (_, i) => ({
          holeNumber: i + 1,
          par: 4,
          strokeIndex: i + 1,
          yards: null,
        })),
        tees: [
          {
            id: undefined,
            name: "White",
            color: "",
            gender: "mens",
            courseRating: null,
            slopeRating: null,
          },
        ],
      }}
      readOnly={!canEdit}
    />
  );
}
