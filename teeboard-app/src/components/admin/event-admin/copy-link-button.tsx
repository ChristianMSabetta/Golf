"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Copy-to-clipboard for the shareable link rows (M4-T008): the same
 * affordance the publish step presents, extracted so Overview and Settings
 * share one implementation. Shows "Copied!" transiently; a blocked clipboard
 * API still flashes so the user isn't left guessing.
 */
export function CopyLinkButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => setCopied(true),
    );
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={copy}>
      <Copy className="size-3.5" aria-hidden />
      {copied ? "Copied!" : "Copy link"}
    </Button>
  );
}
