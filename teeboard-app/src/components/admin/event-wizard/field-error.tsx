"use client";

import { cn } from "@/lib/utils";

/** A field-level error message, matching the course editor's pattern. */
export function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className={cn(
        "text-xs font-medium text-destructive",
        "mt-1",
      )}
    >
      {message}
    </p>
  );
}
