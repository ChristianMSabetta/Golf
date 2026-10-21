"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteCourse } from "@/lib/course/actions";
import type { CourseActionState } from "@/lib/course/schema";

/**
 * Delete control for a course row. The action re-authorizes server-side;
 * a course referenced by any event is refused with a clear error surfaced
 * on the button's title (and a full revalidation of the list) instead of
 * a database failure.
 */
export function CourseDeleteButton({
  courseId,
  name,
}: {
  courseId: string;
  name: string;
}) {
  const [state, action, pending] = useActionState<
    CourseActionState,
    FormData
  >(deleteCourse, {});

  return (
    <form action={action} className="inline-flex">
      <input type="hidden" name="courseId" value={courseId} />
      <Button
        type="submit"
        variant="destructive"
        size="icon-sm"
        disabled={pending}
        aria-label={`Delete ${name}`}
        title={state.error ?? `Delete ${name}`}
      >
        <Trash2 aria-hidden />
      </Button>
    </form>
  );
}
