"use client";

import { useActionState, useMemo, useState } from "react";
import {
  BadgeCheck,
  CircleAlert,
  FileUp,
  Search,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldError } from "./field-error";
import {
  saveEventRoster,
  removeEventPlayer,
  type RosterCommitState,
} from "@/lib/players/roster-actions";
import type { PlayersActionState } from "@/lib/players/schema";
import type {
  RosterAttachmentRow,
  RosterPlayerRow,
} from "@/lib/players/server";
import {
  commitPlan,
  csvLineCount,
  mergeRoster,
  rosterFromClub,
  rosterFromCsv,
  rosterFromManual,
  rosterRowKey,
  type RosterEntry,
} from "@/lib/players/roster";

/**
 * Wizard Players step (M4-T005): three input paths — import a CSV/Excel
 * export, pick from the club player database, or add one player by hand —
 * merged into one deduplicated preview with per-row error flags and skip
 * toggles before anything commits. The commit runs the server action,
 * which re-validates every row, upserts players into the club database,
 * and idempotently attaches them to the draft event (players already in
 * the event are skipped, never duplicated). Column mapping is automatic
 * (renamed/shuffled headers map by keyword), so a typical 120-row file
 * needs no manual column fiddling.
 */

const STRING_SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const SOURCE_LABELS: Record<RosterEntry["source"], string> = {
  csv: "CSV import",
  club: "Club database",
  manual: "Added by hand",
};

type ManualFields = {
  fullName: string;
  email: string;
  phone: string;
  gender: string;
  handicapIndex: string;
  whsNumber: string;
};

const EMPTY_MANUAL: ManualFields = {
  fullName: "",
  email: "",
  phone: "",
  gender: "",
  handicapIndex: "",
  whsNumber: "",
};

function formatHi(hi: number | null): string {
  return hi === null ? "—" : String(hi);
}

// ─── Current roster (already attached) ────────────────────────────────────────

function AttachedRow({
  attached,
  eventId,
  readOnly,
}: {
  attached: RosterAttachmentRow;
  eventId: string;
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    PlayersActionState,
    FormData
  >(removeEventPlayer, {});

  return (
    <tr className="border-t">
      <td className="py-1.5 pr-2 font-medium">{attached.fullName}</td>
      <td className="py-1.5 pr-2 text-muted-foreground">{attached.email ?? "—"}</td>
      <td className="py-1.5 pr-2 text-right font-mono text-xs tabular-nums">
        {formatHi(attached.handicapIndex)}
      </td>
      <td className="py-1.5 pl-2 text-right">
        {readOnly ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <form action={formAction} className="inline">
            <input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="playerId" value={attached.playerId} />
            <Button
              type="submit"
              variant="ghost"
              size="icon-xs"
              disabled={pending}
              title={state.error ?? "Remove from this event"}
            >
              <Trash2 className="size-3.5" aria-hidden />
              <span className="sr-only">Remove {attached.fullName}</span>
            </Button>
          </form>
        )}
      </td>
    </tr>
  );
}

// ─── The step ────────────────────────────────────────────────────────────────

export function PlayersStep({
  eventId,
  clubPlayers,
  attached,
  readOnly = false,
}: {
  eventId: string | null;
  clubPlayers: readonly RosterPlayerRow[];
  attached: readonly RosterAttachmentRow[];
  readOnly?: boolean;
}) {
  // ── CSV import state ──
  const [csvText, setCsvText] = useState("");
  const [csvParsed, setCsvParsed] = useState(false);

  // ── Picker state ──
  const [pickSearch, setPickSearch] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  // ── Manual state ──
  const [manual, setManual] = useState<ManualFields>(EMPTY_MANUAL);
  const [manualIssues, setManualIssues] = useState<Record<string, string>>({});

  // ── Staged rows from every path ──
  const [manualEntries, setManualEntries] = useState<readonly RosterEntry[]>([]);

  // ── Skip toggles: keyed by preview entry key ──
  const [skip, setSkip] = useState<ReadonlySet<string>>(new Set());

  const [commit, commitAction, committing] = useActionState<
    RosterCommitState,
    FormData
  >(saveEventRoster, {});

  // ── Parse the CSV text into staged entries (auto column mapping) ──
  const csv = useMemo(() => rosterFromCsv(csvText), [csvText]);

  const attachedKeys = useMemo(
    () => new Set(attached.map((row) => rosterRowKey(row))),
    [attached],
  );

  const pickedEntries = useMemo(() => {
    const chosen = clubPlayers.filter((player) => picked.has(player.id));
    return rosterFromClub(chosen);
  }, [clubPlayers, picked]);

  const csvFlagged = useMemo(() => {
    if (!csvParsed) return [];
    return csv.rejected;
  }, [csv, csvParsed]);

  /**
   * The merged preview: staged CSV rows + picked club rows + manual rows,
   * deduplicated by (name, email). A staged row matching an attached row
   * is reported but stays skippable — attach is idempotent server-side
   * anyway, and the preview says so up front.
   */
  const preview = useMemo(
    () => mergeRoster(csvParsed ? csv.entries : [], pickedEntries, manualEntries),
    [csv, csvParsed, pickedEntries, manualEntries],
  );

  const plan = useMemo(
    () => commitPlan(preview, skip),
    [preview, skip],
  );

  /** Rows not already in the event — already-attached rows attach no-op. */
  const toAttach = useMemo(
    () =>
      plan.attach.filter((row) => !attachedKeys.has(rosterRowKey(row))),
    [plan.attach, attachedKeys],
  );

  function toggleSkip(key: string) {
    setSkip((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleCsvFile(file: File | undefined) {
    if (!file) return;
    void file.text().then((text) => {
      setCsvText(text);
      setCsvParsed(true);
    });
  }

  function changeCsvText(text: string) {
    setCsvText(text);
    setCsvParsed(text.trim() !== "");
  }

  const pickMatches = useMemo(() => {
    const term = pickSearch.trim().toLowerCase();
    if (term === "") return clubPlayers;
    return clubPlayers.filter((player) => {
      const haystack = [
        player.fullName,
        player.email ?? "",
        player.whsNumber ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [clubPlayers, pickSearch]);

  function togglePicked(playerId: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(playerId)) {
        next.delete(playerId);
      } else {
        next.add(playerId);
      }
      return next;
    });
  }

  function addManual(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = rosterFromManual(manual);
    if ("issues" in result) {
      const fields: Record<string, string> = {};
      for (const issue of result.issues) {
        if (!fields[issue.field]) fields[issue.field] = issue.message;
      }
      setManualIssues(fields);
      return;
    }
    setManualIssues({});
    setManualEntries((current) => {
      const key = result.entry.key;
      if (current.some((entry) => entry.key === key)) return current;
      return [...current, result.entry];
    });
    setManual(EMPTY_MANUAL);
  }

  function submitCommit(event: React.FormEvent<HTMLFormElement>) {
    // Empty payloads never submit; a real commit revalidates the wizard
    // server-side (revalidatePath in the action) so the roster reloads.
    if (toAttach.length === 0) {
      event.preventDefault();
    }
  }

  const csvTotal = csvParsed ? csvLineCount(csvText) : 0;
  const csvReady = csvParsed ? csv.entries.length : 0;
  const csvFlaggedCount = csvFlagged.length;
  const duplicateCount = preview.duplicates.length;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Current roster ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4" aria-hidden />
            Players
          </CardTitle>
          <CardDescription>
            Build the field — import a spreadsheet, pick from the club
            database, or add one by hand. Everything lands in a preview you
            confirm before it saves.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium">
              {attached.length > 0
                ? `In the event — ${attached.length} player${attached.length === 1 ? "" : "s"}`
                : "Nobody in the event yet."}
            </p>
            {attached.length > 0 && eventId !== null ? (
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="pb-1 pr-2 font-medium">Name</th>
                    <th className="pb-1 pr-2 font-medium">Email</th>
                    <th className="pb-1 pr-2 text-right font-medium">HI</th>
                    <th className="pb-1 pl-2 text-right font-medium">
                      {readOnly ? "" : "Remove"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {attached.map((row) => (
                    <AttachedRow
                      key={`${row.playerId}`}
                      attached={row}
                      eventId={eventId}
                      readOnly={readOnly}
                    />
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* ── Path 1: CSV/Excel import ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileUp className="size-4" aria-hidden />
            Import CSV / Excel export
          </CardTitle>
          <CardDescription>
            Drop the spreadsheet&apos;s CSV export (from Excel, Google
            Sheets, or your handicap system). Columns are detected
            automatically — shuffled or renamed headers like &quot;Golfer
            Name&quot;, &quot;HI&quot;, or &quot;E-mail&quot; map on their
            own, no manual column matching.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept=".csv,text/csv,text/plain,.txt"
              className="sr-only"
              id="roster-csv-file"
              onChange={(e) => handleCsvFile(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                document.getElementById("roster-csv-file")?.click()
              }
            >
              <Upload className="size-3.5" aria-hidden />
              Choose CSV file
            </Button>
            <span className="text-sm text-muted-foreground">or paste below</span>
          </div>
          <textarea
            value={csvText}
            onChange={(e) => changeCsvText(e.target.value)}
            rows={4}
            placeholder={
              "Golfer Name,HCP,E-mail,WHS #\nDevon Clarke,12.4,devon@example.com,1234567"
            }
            className="w-full rounded-lg border border-input bg-transparent p-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label="CSV text to import"
          />
          {csvParsed ? (
            <p className="text-sm text-muted-foreground">
              Read {csvTotal} line{csvTotal === 1 ? "" : "s"} —{" "}
              <span className="font-medium text-foreground">{csvReady}</span>{" "}
              mapped, {" "}
              <span className="font-medium text-foreground">
                {csvFlaggedCount}
              </span>{" "}
              flagged.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Path 2: pick from the club database ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4" aria-hidden />
            Pick from the club database
          </CardTitle>
          <CardDescription>
            {clubPlayers.length} player{clubPlayers.length === 1 ? "" : "s"} in
            {` ${"the club database"}`}. Search and check the ones joining
            this event.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input
              value={pickSearch}
              onChange={(e) => setPickSearch(e.target.value)}
              placeholder="Search name, email, or WHS #"
              className="pl-8"
              aria-label="Search club players"
            />
          </div>
          {clubPlayers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No players in the club database yet — import a CSV above and
              the rows are saved here as club players too.
            </p>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-input">
              <ul className="divide-y">
                {pickMatches.slice(0, 200).map((player) => {
                  const inEvent = attachedKeys.has(
                    rosterRowKey(player),
                  );
                  return (
                    <li
                      key={player.id}
                      className="flex items-center gap-2 px-3 py-2"
                    >
                      <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={picked.has(player.id)}
                          onChange={() => togglePicked(player.id)}
                          disabled={readOnly}
                          className="accent-[#0F5132]"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {player.fullName}
                          {inEvent ? (
                            <span className="ml-1 text-xs text-primary">
                              · already in
                            </span>
                          ) : null}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {player.email ?? player.whsNumber ?? ""}
                        </span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {formatHi(player.handicapIndex)}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {picked.size > 0 ? (
            <p className="text-sm text-muted-foreground">
              {picked.size} picked — they appear in the preview below.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Path 3: add one by hand ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="size-4" aria-hidden />
            Add one by hand
          </CardTitle>
          <CardDescription>
            The odd addition that&apos;s in nobody&apos;s file — name and
            handicap index are enough; everything else is optional.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={addManual} className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="manual-name">Name</Label>
              <Input
                id="manual-name"
                value={manual.fullName}
                onChange={(e) =>
                  setManual((m) => ({ ...m, fullName: e.target.value }))
                }
                placeholder="Devon Clarke"
                aria-invalid={Boolean(manualIssues.fullName)}
                disabled={readOnly}
              />
              <FieldError message={manualIssues.fullName} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manual-email">Email</Label>
              <Input
                id="manual-email"
                type="email"
                value={manual.email}
                onChange={(e) =>
                  setManual((m) => ({ ...m, email: e.target.value }))
                }
                placeholder="devon@example.com"
                aria-invalid={Boolean(manualIssues.email)}
                disabled={readOnly}
              />
              <FieldError message={manualIssues.email} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manual-hi">Handicap index</Label>
              <Input
                id="manual-hi"
                inputMode="decimal"
                value={manual.handicapIndex}
                onChange={(e) =>
                  setManual((m) => ({ ...m, handicapIndex: e.target.value }))
                }
                placeholder="12.4"
                aria-invalid={Boolean(manualIssues.handicapIndex)}
                disabled={readOnly}
                className="tabular-nums"
              />
              <FieldError message={manualIssues.handicapIndex} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manual-phone">Phone</Label>
              <Input
                id="manual-phone"
                value={manual.phone}
                onChange={(e) =>
                  setManual((m) => ({ ...m, phone: e.target.value }))
                }
                placeholder="512-555-0142"
                aria-invalid={Boolean(manualIssues.phone)}
                disabled={readOnly}
              />
              <FieldError message={manualIssues.phone} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manual-gender">Gender</Label>
              <select
                id="manual-gender"
                value={manual.gender}
                onChange={(e) =>
                  setManual((m) => ({ ...m, gender: e.target.value }))
                }
                disabled={readOnly}
                className={STRING_SELECT_CLASS}
              >
                <option value="">—</option>
                <option value="mens">Mens</option>
                <option value="womens">Womens</option>
              </select>
              <FieldError message={manualIssues.gender} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manual-whs">WHS #</Label>
              <Input
                id="manual-whs"
                value={manual.whsNumber}
                onChange={(e) =>
                  setManual((m) => ({ ...m, whsNumber: e.target.value }))
                }
                placeholder="1234567"
                aria-invalid={Boolean(manualIssues.whsNumber)}
                disabled={readOnly}
              />
              <FieldError message={manualIssues.whsNumber} />
            </div>
            <div className="sm:col-span-3">
              <Button type="submit" variant="outline" size="sm" disabled={readOnly}>
                <UserPlus className="size-3.5" aria-hidden />
                Add to list
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ── Flagged CSV rows (per-row errors) ── */}
      {csvFlaggedCount > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
              <CircleAlert className="size-4" aria-hidden />
              Flagged rows ({csvFlaggedCount})
            </CardTitle>
            <CardDescription>
              These rows can&apos;t be imported as-is — fix them in the
              spreadsheet and paste again, or add the player by hand. Every
              other row imports fine.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-xs">
              {csvFlagged.map((entry) => (
                <li key={entry.key} className="text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {entry.key.replace("csv-line:", "Line ")}:
                  </span>{" "}
                  {entry.issues.map((issue) => issue.message).join(" ")}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Preview + commit ── */}
      {preview.entries.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BadgeCheck className="size-4" aria-hidden />
              Preview ({preview.entries.length})
            </CardTitle>
            <CardDescription>
              What will be added — imported rows are saved to the club
              database and attached to this event. Uncheck anything to skip
              it.
              {duplicateCount > 0
                ? ` ${duplicateCount} duplicate row${duplicateCount === 1 ? "" : "s"} across your inputs were merged.`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="max-h-72 overflow-y-auto rounded-lg border border-input">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="p-2 font-medium">Skip</th>
                    <th className="p-2 font-medium">Name</th>
                    <th className="p-2 font-medium">Email</th>
                    <th className="p-2 text-right font-medium">HI</th>
                    <th className="p-2 font-medium">From</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.entries.map((entry) => {
                    const key = rosterRowKey(entry.row);
                    const inEvent = attachedKeys.has(key);
                    const skipped =
                      skip.has(key) || skip.has(entry.key) || inEvent;
                    return (
                      <tr
                        key={entry.key}
                        className="border-t"
                      >
                        <td className="p-2">
                          <input
                            type="checkbox"
                            checked={skipped}
                            onChange={() => toggleSkip(key)}
                            disabled={readOnly || inEvent}
                            title={
                              inEvent
                                ? "Already in the event"
                                : "Skip this row"
                            }
                            className="accent-[#0F5132]"
                            aria-label={`Skip ${entry.row.fullName}`}
                          />
                        </td>
                        <td className="p-2 font-medium">{entry.row.fullName}</td>
                        <td className="p-2 text-muted-foreground">
                          {entry.row.email ?? "—"}
                        </td>
                        <td className="p-2 text-right font-mono text-xs tabular-nums">
                          {formatHi(entry.row.handicapIndex)}
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {SOURCE_LABELS[entry.source]}
                          {inEvent ? (
                            <span className="ml-1 text-primary">
                              · already in
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {eventId === null ? (
              <p className="text-sm text-muted-foreground">
                Save the Basics step first — players attach to the event
                draft it creates.
              </p>
            ) : (
              <form
                action={commitAction}
                onSubmit={submitCommit}
                className="flex flex-wrap items-center gap-3"
              >
                <input type="hidden" name="eventId" value={eventId} />
                <input
                  type="hidden"
                  name="payload"
                  value={JSON.stringify({
                    eventId,
                    rows: toAttach.map((row) => ({
                      source: row.source,
                      playerId: row.playerId,
                      fullName: row.fullName,
                      email: row.email ?? "",
                      phone: row.phone ?? "",
                      gender: row.gender ?? "",
                      handicapIndex:
                        row.handicapIndex === null
                          ? ""
                          : String(row.handicapIndex),
                      whsNumber: row.whsNumber ?? "",
                    })),
                  })}
                />
                <Button type="submit" disabled={committing || readOnly || toAttach.length === 0}>
                  {committing
                    ? "Adding…"
                    : `Add ${toAttach.length} player${toAttach.length === 1 ? "" : "s"} to the event`}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {plan.skipped.length + (plan.attach.length - toAttach.length) > 0
                    ? `${plan.skipped.length + (plan.attach.length - toAttach.length)} skipped.`
                    : ""}
                </span>
              </form>
            )}

            {commit.error ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {commit.error}
              </p>
            ) : null}
            {commit.message ? (
              <p className="text-sm text-foreground">{commit.message}</p>
            ) : null}
            {commit.report && commit.report.rejected.length > 0 ? (
              <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                {commit.report.rejected.map((row) => (
                  <li key={row.label}>
                    <span className="font-medium text-foreground">
                      {row.label}:
                    </span>{" "}
                    {row.messages.join(" ")}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
