import { describe, expect, it } from "vitest";
import {
  HANDICAP_INDEX_MAX,
  HANDICAP_INDEX_MIN,
  PLAYER_SORT_FIELDS,
  csvRowSchema,
  handicapEditSchema,
  playerListParamsSchema,
} from "./schema";
import {
  headerToColumn,
  isHeaderRow,
  parseCsvText,
  parsePlayersCsv,
  serializePlayersCsv,
} from "./csv";
import { groupDuplicates, pickMergeKeeper } from "./duplicates";

// ─── handicap cell validation ─────────────────────────────────────────────────

describe("handicapEditSchema", () => {
  it("accepts a valid one-decimal handicap", () => {
    const result = handicapEditSchema.safeParse({
      playerId: "uuid",
      handicapIndex: "12.4",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.handicapIndex).toBe(12.4);
    }
  });

  it("accepts the boundary values -5 and 54", () => {
    expect(
      handicapEditSchema.safeParse({ playerId: "u", handicapIndex: "-5" }).success,
    ).toBe(true);
    expect(
      handicapEditSchema.safeParse({ playerId: "u", handicapIndex: "54" }).success,
    ).toBe(true);
    expect(HANDICAP_INDEX_MIN).toBe(-5);
    expect(HANDICAP_INDEX_MAX).toBe(54);
  });

  it("rejects values outside the WHS bounds", () => {
    const low = handicapEditSchema.safeParse({
      playerId: "u",
      handicapIndex: "-5.1",
    });
    const high = handicapEditSchema.safeParse({
      playerId: "u",
      handicapIndex: "54.1",
    });
    expect(low.success).toBe(false);
    expect(high.success).toBe(false);
    if (!high.success) {
      expect(high.error.issues[0]?.message).toContain(
        "between -5 and 54",
      );
    }
  });

  it("rejects two decimal places and non-numeric text", () => {
    expect(
      handicapEditSchema.safeParse({ playerId: "u", handicapIndex: "12.44" }).success,
    ).toBe(false);
    expect(
      handicapEditSchema.safeParse({ playerId: "u", handicapIndex: "abc" }).success,
    ).toBe(false);
  });
});

// ─── list params ───────────────────────────────────────────────────────────────

describe("playerListParamsSchema", () => {
  it("defaults search/sort/direction", () => {
    const parsed = playerListParamsSchema.parse({});
    expect(parsed.search).toBe("");
    expect(parsed.sort).toBe("full_name");
    expect(parsed.direction).toBe("asc");
  });

  it("keeps a recognized sort field and rejects unknown ones", () => {
    expect(
      playerListParamsSchema.safeParse({ sort: "event_count", direction: "desc" })
        .success,
    ).toBe(true);
    expect(
      playerListParamsSchema.safeParse({ sort: "made_up" }).success,
    ).toBe(false);
    expect(PLAYER_SORT_FIELDS).toContain("event_count");
  });
});

// ─── CSV row schema ────────────────────────────────────────────────────────────

describe("csvRowSchema", () => {
  const validRow = {
    rowNumber: 2,
    fullName: "Devon Clarke",
    email: "devon@example.com",
    phone: "512-555-0142",
    gender: "mens",
    handicapIndex: "12.4",
    whsNumber: "1234567",
  };

  it("normalizes email to lowercase and parses the handicap", () => {
    const result = csvRowSchema.safeParse({
      ...validRow,
      email: "DEVON@Example.COM",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("devon@example.com");
      expect(result.data.handicapIndex).toBe(12.4);
    }
  });

  it("rejects an invalid email with a clear message", () => {
    const result = csvRowSchema.safeParse({
      ...validRow,
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("valid email");
    }
  });

  it("rejects a missing name with a clear message", () => {
    const result = csvRowSchema.safeParse({ ...validRow, fullName: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Enter the player's name.");
    }
  });

  it("rejects a malformed phone and an unknown gender", () => {
    expect(
      csvRowSchema.safeParse({ ...validRow, phone: "call me" }).success,
    ).toBe(false);
    const gender = csvRowSchema.safeParse({ ...validRow, gender: "attack helicopter" });
    expect(gender.success).toBe(false);
  });

  it("treats blanks as null and keeps a valid row minimal", () => {
    const result = csvRowSchema.safeParse({
      rowNumber: 3,
      fullName: "Jane Doe",
      email: "",
      phone: "",
      gender: "",
      handicapIndex: "",
      whsNumber: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBeNull();
      expect(result.data.handicapIndex).toBeNull();
      expect(result.data.gender).toBeNull();
    }
  });
});

// ─── header mapping ────────────────────────────────────────────────────────────

describe("header detection", () => {
  it("maps canonical and common renamed headers", () => {
    expect(headerToColumn("Full Name")).toBe("full_name");
    expect(headerToColumn("PLAYER")).toBe("full_name");
    expect(headerToColumn("Golfer Name")).toBe("full_name");
    expect(headerToColumn("E-mail")).toBe("email");
    expect(headerToColumn("HI")).toBe("handicap_index");
    expect(headerToColumn("HCP")).toBe("handicap_index");
    expect(headerToColumn("WHS #")).toBe("whs_number");
    expect(headerToColumn("Cell")).toBe("phone");
  });

  it("recognizes a header row and ignores junk columns", () => {
    expect(isHeaderRow(["Full Name", "Email", "HCP"])).toBe(true);
    expect(isHeaderRow(["Devon Clarke", "devon@example.com", "12.4"])).toBe(
      false,
    );
    expect(headerToColumn("Notes")).toBeNull();
  });
});

// ─── CSV parsing ───────────────────────────────────────────────────────────────

describe("parseCsvText", () => {
  it("handles quoted fields with embedded separators and newlines", () => {
    const rows = parseCsvText(
      '"Clarke, Devon",devon@example.com\n"multi\nline",x',
    );
    expect(rows[0]).toEqual(["Clarke, Devon", "devon@example.com"]);
    expect(rows[1]).toEqual(["multi\nline", "x"]);
  });

  it("handles CRLF and semicolons and skips blank lines", () => {
    const rows = parseCsvText("a;b\r\nc;d\r\n\r\n");
    expect(rows).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

describe("parsePlayersCsv", () => {
  it("round-trips a header file, flagging per-row errors by line", () => {
    const csv = [
      "full_name,email,phone,gender,handicap_index,whs_number",
      '"Devon Clarke",devon@example.com,512-555-0142,mens,12.4,1234567',
      "Jane Doe,jane@example.com",
      "Bad Row,not-an-email",
    ].join("\r\n");

    const result = parsePlayersCsv(csv);
    expect(result.hadHeader).toBe(true);
    expect(result.parsed.map((p) => p.rowNumber)).toEqual([2, 3]);
    expect(result.parsed[0]?.row.fullName).toBe("Devon Clarke");
    expect(result.parsed[0]?.row.handicapIndex).toBe(12.4);
    expect(result.parsed[1]?.row.email).toBe("jane@example.com");
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.rowNumber).toBe(4);
    expect(result.rejected[0]?.messages.join(" ")).toContain("valid email");
  });

  it("maps shuffled/renamed header columns", () => {
    const csv = [
      "Golfer Name,HCP,E-mail",
      "Devon Clarke,12.4,devon@example.com",
    ].join("\n");
    const result = parsePlayersCsv(csv);
    expect(result.parsed).toHaveLength(1);
    expect(result.parsed[0]?.row.fullName).toBe("Devon Clarke");
    expect(result.parsed[0]?.row.handicapIndex).toBe(12.4);
    expect(result.parsed[0]?.row.email).toBe("devon@example.com");
  });

  it("falls back to positional columns without a header", () => {
    const csv = "Devon Clarke,devon@example.com,,mens,12.4,1234567";
    const result = parsePlayersCsv(csv);
    expect(result.hadHeader).toBe(false);
    expect(result.parsed[0]?.row.fullName).toBe("Devon Clarke");
    expect(result.parsed[0]?.row.email).toBe("devon@example.com");
    expect(result.parsed[0]?.row.gender).toBe("mens");
  });

  it("flags an out-of-range handicap on the exact row", () => {
    const csv = [
      "full_name,email,handicap_index",
      "Devon Clarke,devon@example.com,99",
    ].join("\n");
    const result = parsePlayersCsv(csv);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.rowNumber).toBe(2);
    expect(result.rejected[0]?.messages.join(" ")).toContain(
      "between -5 and 54",
    );
  });
});

// ─── CSV export ────────────────────────────────────────────────────────────────

describe("serializePlayersCsv", () => {
  it("emits the canonical headers and escapes special characters", () => {
    const csv = serializePlayersCsv([
      {
        fullName: "Clarke, Devon",
        email: "devon@example.com",
        phone: "512-555-0142",
        gender: "mens",
        handicapIndex: 12.4,
        whsNumber: "1234567",
      },
      {
        fullName: "Jane Doe",
        email: null,
        phone: null,
        gender: null,
        handicapIndex: null,
        whsNumber: null,
      },
    ]);

    expect(csv.split("\r\n")[0]).toBe(
      "full_name,email,phone,gender,handicap_index,whs_number",
    );
    expect(csv.split("\r\n")[1]).toBe(
      '"Clarke, Devon",devon@example.com,512-555-0142,mens,12.4,1234567',
    );
    expect(csv.split("\r\n")[2]).toBe("Jane Doe,,,,,");

    // The export header round-trips through the import parser.
    const round = parsePlayersCsv(csv);
    expect(round.parsed).toHaveLength(2);
    expect(round.parsed[0]?.row.fullName).toBe("Clarke, Devon");
    expect(round.parsed[1]?.row.email).toBeNull();
  });
});

// ─── duplicate grouping & merge keeper ────────────────────────────────────────

describe("groupDuplicates", () => {
  it("groups players sharing name AND email, ignoring case/whitespace", () => {
    const players = [
      {
        id: "1",
        fullName: "Devon Clarke",
        email: "DEVON@Example.com",
        phone: null,
        gender: null,
        handicapIndex: null,
        whsNumber: null,
        eventCount: 3,
        lastEventDate: null,
      },
      {
        id: "2",
        fullName: " devon clarke ",
        email: "devon@example.com",
        phone: null,
        gender: null,
        handicapIndex: null,
        whsNumber: null,
        eventCount: 1,
        lastEventDate: null,
      },
      {
        id: "3",
        fullName: "Devon Clarke",
        email: "other@example.com",
        phone: null,
        gender: null,
        handicapIndex: null,
        whsNumber: null,
        eventCount: 0,
        lastEventDate: null,
      },
      {
        id: "4",
        fullName: "Jane Doe",
        email: null,
        phone: null,
        gender: null,
        handicapIndex: null,
        whsNumber: null,
        eventCount: 0,
        lastEventDate: null,
      },
    ];

    const groups = groupDuplicates(players);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.players.map((p) => p.id)).toEqual(["1", "2"]);
  });

  it("never flags rows without a matching email", () => {
    const groups = groupDuplicates([
      {
        id: "1",
        fullName: "Same Name",
        email: null,
        phone: null,
        gender: null,
        handicapIndex: null,
        whsNumber: null,
        eventCount: 0,
        lastEventDate: null,
      },
      {
        id: "2",
        fullName: "Same Name",
        email: null,
        phone: null,
        gender: null,
        handicapIndex: null,
        whsNumber: null,
        eventCount: 0,
        lastEventDate: null,
      },
    ]);
    expect(groups).toHaveLength(0);
  });
});

describe("pickMergeKeeper", () => {
  it("picks the row with the most event history as the merge keeper", () => {
    const groups = groupDuplicates([
      {
        id: "keeper",
        fullName: "Devon Clarke",
        email: "devon@example.com",
        phone: null,
        gender: null,
        handicapIndex: null,
        whsNumber: null,
        eventCount: 5,
        lastEventDate: "2026-01-10",
      },
      {
        id: "merge",
        fullName: "Devon Clarke",
        email: "devon@example.com",
        phone: "512-555-0142",
        gender: null,
        handicapIndex: 8.1,
        whsNumber: null,
        eventCount: 1,
        lastEventDate: "2025-06-01",
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(pickMergeKeeper(groups[0]!).id).toBe("keeper");
  });
});
