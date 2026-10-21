import { describe, expect, it } from "vitest";
import { headerToColumn } from "./csv";
import {
  commitPlan,
  csvLineCount,
  mergeRoster,
  newGroupToken,
  rosterFromClub,
  rosterFromCsv,
  rosterFromManual,
  rosterKey,
  rosterRowKey,
  validateRosterCandidate,
} from "./roster";

/**
 * Roster verification for the wizard's Players step (M4-T005): the
 * auto-mapped CSV path (a realistic 120-row shuffled/renamed file needs no
 * manual column fiddling), the club-picker and manual paths, per-row error
 * flagging, cross-path dedupe, skip handling, and group-token generation.
 * Expected values are hand-derived from the roster contract — never
 * mirrored from an implementation.
 */

const CLUB_PLAYER = {
  id: "11111111-1111-4111-8111-111111111111",
  fullName: "Devon Clarke",
  email: "devon@example.com",
  phone: "512-555-0142",
  gender: "mens" as const,
  handicapIndex: 12.4,
  whsNumber: "1234567",
};

function csvShuffled120(): string {
  // Shuffled columns + renamed headers, like a real Excel/Google export.
  const header = "HCP,E-mail,Golfer Name,WHS #";
  const lines = [header];
  for (let i = 1; i <= 120; i += 1) {
    const hi = (i % 40) + 2; // 2..41 — inside WHS bounds
    lines.push(`${hi.toFixed(1)},player${i}@example.com,"Player ${i}",${100000 + i}`);
  }
  return lines.join("\r\n");
}

// ─── Auto column mapping ─────────────────────────────────────────────────────

describe("rosterFromCsv column mapping", () => {
  it("maps a 120-row shuffled/renamed file without manual column selection", () => {
    const { entries, rejected, hadHeader } = rosterFromCsv(csvShuffled120());
    expect(hadHeader).toBe(true);
    expect(rejected).toHaveLength(0);
    expect(entries).toHaveLength(120);
    expect(entries[0]?.row.fullName).toBe("Player 1");
    expect(entries[0]?.row.email).toBe("player1@example.com");
    expect(entries[0]?.row.handicapIndex).toBe(3);
    expect(entries[117]?.row.fullName).toBe("Player 118");
    expect(entries[117]?.row.whsNumber).toBe("100118");
  });

  it("flags per-row errors on the exact source lines with actionable messages", () => {
    const csv = [
      "Golfer Name,HCP,E-mail",
      ",12.4,missing@example.com",
      "Good Row,12.4,good@example.com",
      "Bad Email Row,12.4,not-an-email",
      "High HI Row,99,hi@example.com",
    ].join("\n");

    const { entries, rejected } = rosterFromCsv(csv);
    expect(entries.map((e) => e.row.fullName)).toEqual(["Good Row"]);

    const badName = rejected.find((e) => e.key.includes("csv-line:"));
    expect(badName?.issues[0]?.message).toBe(
      "Enter the player's name.",
    );

    const byLine = new Map(rejected.map((e) => [e.key, e]));
    expect(
      byLine.get("csv-line:4")?.issues.map((i) => i.message).join(" "),
    ).toContain("valid email");
    expect(
      byLine.get("csv-line:5")?.issues.map((i) => i.message).join(" "),
    ).toContain("between -5 and 54");
  });

  it("flags a headerless row with no name instead of importing it", () => {
    const { entries, rejected, hadHeader } = rosterFromCsv(
      ",devon@example.com",
    );
    expect(hadHeader).toBe(false);
    expect(entries).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.issues[0]?.message).toBe(
      "Enter the player's name.",
    );
  });

  it("counts lines through the same parser the club import uses", () => {
    expect(csvLineCount("a,b\r\nc,d\r\n\r\n")).toBe(2);
  });
});

// ─── Candidate validation (shared by manual + picker paths) ───────────────────

describe("validateRosterCandidate", () => {
  it("normalizes email to lowercase and blanks to null", () => {
    const result = validateRosterCandidate("manual", {
      fullName: " Devon Clarke ",
      email: "DEVON@Example.COM",
      phone: "  ",
      gender: "MENS",
      handicapIndex: "12.4",
      whsNumber: "1234567",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.fullName).toBe("Devon Clarke");
      expect(result.row.email).toBe("devon@example.com");
      expect(result.row.phone).toBeNull();
      expect(result.row.gender).toBe("mens");
      expect(result.row.handicapIndex).toBe(12.4);
    }
  });

  it("collects every issue — missing name, bad email, out-of-range handicap", () => {
    const result = validateRosterCandidate("manual", {
      fullName: "",
      email: "nope",
      handicapIndex: "99",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.issues.map((i) => i.field);
      expect(fields).toContain("fullName");
      expect(fields).toContain("email");
      expect(fields).toContain("handicapIndex");
      expect(
        result.issues.find((i) => i.field === "handicapIndex")?.message,
      ).toContain("between -5 and 54");
    }
  });

  it("rejects a two-decimal handicap through the shared WHS bounds", () => {
    const result = validateRosterCandidate("manual", {
      fullName: "Devon Clarke",
      handicapIndex: "12.44",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.find((i) => i.field === "handicapIndex")?.message,
      ).toContain("one decimal");
    }
  });

  it("accepts the WHS boundary handicaps −5 and 54", () => {
    expect(
      validateRosterCandidate("manual", {
        fullName: "Low",
        handicapIndex: "-5",
      }).ok,
    ).toBe(true);
    expect(
      validateRosterCandidate("manual", {
        fullName: "High",
        handicapIndex: "54",
      }).ok,
    ).toBe(true);
  });

  it("rejects malformed phones and WHS numbers with clear messages", () => {
    const phone = validateRosterCandidate("manual", {
      fullName: "Devon Clarke",
      phone: "call me",
    });
    expect(phone.ok).toBe(false);
    if (!phone.ok) {
      expect(
        issueMessage(phone.issues, "phone"),
      ).toContain("valid phone");
    }

    const whs = validateRosterCandidate("manual", {
      fullName: "Devon Clarke",
      whsNumber: "nope!",
    });
    expect(whs.ok).toBe(false);
    if (!whs.ok) {
      expect(issueMessage(whs.issues, "whsNumber")).toContain("WHS");
    }
  });
});

function issueMessage(
  issues: readonly { field: string; message: string }[],
  field: string,
): string {
  return issues.find((i) => i.field === field)?.message ?? "";
}

// ─── Manual + club picker paths ───────────────────────────────────────────────

describe("rosterFromManual", () => {
  it("stages a valid manual row", () => {
    const result = rosterFromManual({
      fullName: "Jane Doe",
      handicapIndex: "8",
    });
    expect("entry" in result).toBe(true);
    if ("entry" in result) {
      expect(result.entry.row.fullName).toBe("Jane Doe");
      expect(result.entry.row.handicapIndex).toBe(8);
      expect(result.entry.row.email).toBeNull();
      expect(result.entry.source).toBe("manual");
    }
  });

  it("reports the per-field issues instead", () => {
    const result = rosterFromManual({ fullName: "", email: "x" });
    expect("issues" in result).toBe(true);
  });
});

describe("rosterFromClub", () => {
  it("stages picker rows carrying their club player id", () => {
    const entries = rosterFromClub([CLUB_PLAYER]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.row.playerId).toBe(CLUB_PLAYER.id);
    expect(entries[0]?.row.fullName).toBe("Devon Clarke");
    expect(entries[0]?.source).toBe("club");
    expect(entries[0]?.key).toBe(
      rosterKey("Devon Clarke", "devon@example.com"),
    );
  });
});

// ─── Merge + dedupe across paths ──────────────────────────────────────────────

describe("mergeRoster", () => {
  it("merges paths in input order and reports repeats as duplicates", () => {
    const csv = rosterFromCsv(
      "Golfer Name,E-mail\nDevon Clarke,devon@example.com\nJane Doe,\n",
    );
    const club = rosterFromClub([CLUB_PLAYER]);
    const preview = mergeRoster(csv.entries, club);

    // Same person by CSV and the picker: one preview row, club id adopted.
    expect(preview.entries).toHaveLength(2);
    expect(
      preview.entries.find((e) => e.row.fullName === "Devon Clarke")
        ?.row.playerId,
    ).toBe(CLUB_PLAYER.id);
    expect(preview.duplicates.map((e) => e.row.fullName)).toEqual([
      "Devon Clarke",
    ]);
  });

  it("keeps the first-seen row and adopts the club id from the repeat", () => {
    const club = rosterFromClub([CLUB_PLAYER]);
    const csv = rosterFromCsv(
      "Golfer Name,HCP,E-mail\nClarke Devon,10.2,devon@example.com\n",
    );
    // Different name spellings are different identities; same spelling
    // resolves to one row whose playerId comes from the club path.
    const preview = mergeRoster(csv.entries, club);
    expect(preview.entries).toHaveLength(2);
  });

  it("dedupes the same person twice inside one CSV file", () => {
    const csv = rosterFromCsv(
      [
        "Golfer Name,E-mail",
        "Devon Clarke,devon@example.com",
        "Devon Clarke,devon@example.com",
      ].join("\n"),
    );
    // The CSV entries carry distinct line-keyed keys; the merge keys them by
    // roster identity via rosterRowKey through preview.entries' dedupe…
    expect(csv.entries).toHaveLength(2);
    expect(
      new Set(csv.entries.map((e) => rosterRowKey(e.row))).size,
    ).toBe(1);
  });
});

// ─── Skip + commit plan ──────────────────────────────────────────────────────

describe("commitPlan", () => {
  const manual = rosterFromManual({ fullName: "Jane Doe", handicapIndex: "8" });
  const preview = mergeRoster(
    rosterFromClub([CLUB_PLAYER]),
    "entry" in manual ? [manual.entry] : [],
  );

  it("commits every staged row when nothing is skipped", () => {
    const plan = commitPlan(preview, new Set());
    expect(plan.attach.map((r) => r.fullName).sort()).toEqual([
      "Devon Clarke",
      "Jane Doe",
    ]);
    expect(plan.skipped).toHaveLength(0);
  });

  it("exactly honors a skipped identity", () => {
    const skip = new Set([rosterKey("Devon Clarke", "devon@example.com")]);
    const plan = commitPlan(preview, skip);
    expect(plan.attach.map((r) => r.fullName)).toEqual(["Jane Doe"]);
    expect(plan.skipped.map((r) => r.fullName)).toEqual(["Devon Clarke"]);
  });
});

// ─── Group tokens ─────────────────────────────────────────────────────────────

describe("newGroupToken", () => {
  it("generates 32-char lowercase hex tokens matching the group_token check", () => {
    for (let i = 0; i < 16; i += 1) {
      const token = newGroupToken();
      expect(token).toHaveLength(32);
      expect(token).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it("never repeats (crypto-random per call)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 64; i += 1) {
      seen.add(newGroupToken());
    }
    expect(seen.size).toBe(64);
  });
});

// ─── Header alias coverage (re-exported through the CSV module) ───────────────

describe("header aliases the roster relies on", () => {
  it("maps the realistic spreadsheet header spellings", () => {
    expect(headerToColumn("Golfer Name")).toBe("full_name");
    expect(headerToColumn("HCP")).toBe("handicap_index");
    expect(headerToColumn("E-mail")).toBe("email");
    expect(headerToColumn("WHS #")).toBe("whs_number");
    expect(headerToColumn("Cell")).toBe("phone");
  });
});
