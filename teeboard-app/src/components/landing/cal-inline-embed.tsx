"use client";

import { useEffect, useRef } from "react";
import { loadCalEmbed } from "@/lib/cal-embed/loader";

const EMBED_CONTAINER_ID = "cal-inline-embed";

type CalInlineEmbedProps = {
  calLink: string;
};

export function CalInlineEmbed({ calLink }: CalInlineEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const Cal = loadCalEmbed();
    Cal("inline", {
      calLink,
      elementOrSelector: `#${EMBED_CONTAINER_ID}`,
    });

    // The embed appends its iframe into the container; clearing it on
    // unmount lets a remount create a fresh embed instead of a duplicate.
    return () => {
      container?.replaceChildren();
    };
  }, [calLink]);

  return (
    <div
      id={EMBED_CONTAINER_ID}
      ref={containerRef}
      data-cal-embed=""
      className="mx-auto h-[620px] w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-card"
    />
  );
}
