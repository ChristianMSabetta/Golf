import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/authorization";
import { getStaffClub } from "@/lib/club/server";
import { listCourses } from "@/lib/course/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CourseDeleteButton } from "@/components/admin/course-editor/course-delete-button";

export const metadata: Metadata = {
  title: "Courses",
};

// Session-dependent: never prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * Course management list (M4-T001). Server-rendered through the request-bound
 * client so RLS applies — only the signed-in club's courses are ever visible.
 */
export default async function CoursesPage() {
  const staff = await requireStaff();
  const context = await getStaffClub();

  if (!context) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Courses
        </h1>
        <p className="text-sm text-muted-foreground">
          {staff.isSuperadmin
            ? "Super admin tools arrive in a later phase."
            : "No club is linked to your account yet — ask your club owner to invite you."}
        </p>
      </div>
    );
  }

  const courses = await listCourses(context.club.id);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Courses
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Scorecards, tees, and ratings for {context.club.name}&apos;s
            courses. Events play 9 or 18 holes from here.
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/admin/courses/new">New course</Link>
        </Button>
      </div>

      {courses.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No courses yet</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Set up your first scorecard — par, stroke indexes, yards per
            hole, and tees with ratings and slopes. You can paste straight
            from a printed scorecard.
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {courses.map((course) => (
            <li key={course.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-0">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/courses/${course.id}`}
                      className="font-heading text-base font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {course.name}
                    </Link>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {course.holesCount} holes
                      {course.city ? ` · ${course.city}` : ""}
                      {course.state ? `, ${course.state}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button asChild variant="outline">
                      <Link href={`/admin/courses/${course.id}`}>Edit</Link>
                    </Button>
                    <CourseDeleteButton courseId={course.id} name={course.name} />
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
