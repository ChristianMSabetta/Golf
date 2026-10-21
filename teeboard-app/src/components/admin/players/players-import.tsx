"use client";

import { useActionState, useRef, useState } from "react";
import { FileUp, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { exportPlayers, importPlayers } from "@/lib/players/actions";
import type { ImportActionState } from "@/lib/players/actions";

/**
 * CSV import/export panel (M4-T002). Import parses the pasted/selected
 * file client-side with the shared schema for a per-row preview before
 * submitting, then runs the server action which re-validates and upserts
 * — rows that fail either layer are flagged by source line number.
 * Export calls the RLS-respecting server action and downloads the blob.
 */

const SAMPLE_CSV_HEADER =
  "full_name,email,phone,gender,handicap_index,whs_number";

export function PlayersImport() {
  const [text, setText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, action, pending] = useActionState<
    ImportActionState,
    FormData
  >(importPlayers, {});

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const content = await file.text();
    setText(content);
  }

  async function handleExport() {
    const result = await exportPlayers();
    if (!result.ok) return;
    const blob = new Blob([result.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileUp className="size-4" aria-hidden />
          Import &amp; export players
        </CardTitle>
        <CardDescription>
          CSV columns: {SAMPLE_CSV_HEADER}. Headers are auto-detected and
          renamed columns map automatically; every row is validated before
          anything saves, with per-row errors flagged by line.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="csv" value={text} />
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose CSV file
            </Button>
            <span className="text-sm text-muted-foreground">or paste below</span>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={`${SAMPLE_CSV_HEADER}\n"Devon Clarke",devon@example.com,,mens,12.4,1234567`}
            className="w-full rounded-lg border border-input bg-transparent p-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label="CSV text to import"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={pending || text.trim() === ""}>
              <Upload className="size-3.5" aria-hidden />
              {pending ? "Importing…" : "Import CSV"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handleExport()}
            >
              Export CSV
            </Button>
          </div>
        </form>

        {state.error ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
        {state.message ? (
          <p className="text-sm text-foreground">{state.message}</p>
        ) : null}
        {state.report && state.report.rejected.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              {state.report.rejected.length} row(s) skipped:
            </p>
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {state.report.rejected.map((row) => (
                <li key={row.rowNumber}>
                  <span className="font-medium text-foreground">
                    Line {row.rowNumber}:
                  </span>{" "}
                  {row.messages.join(" ")}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
