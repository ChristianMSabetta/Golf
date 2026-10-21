import { describe, expect, it } from "vitest";
import {
  PAYOUT_PRESETS,
  PAYOUT_PURSE_MAX,
  SIDE_GAME_LABELS,
  extrasStepSchema,
  defaultFlights,
  flightsFromRows,
  payoutStepFromStored,
  sideGamesFromRows,
  sideGamesToRows,
  sponsorsFromRows,
} from "./extras";

/**
 * Extras & publish contract tests (M4-T007): the Zod contract for flights,
 * side games, payouts, sponsors, the welcome message, and visibility, plus
 * the row ↔ state mappers. Expected values derive from the rules in the
 * task's acceptance criteria — never mirrored from the implementation.
 */

const VALID_EXTRAS = {
  flights: [
    { name: "A Flight", maxHandicap: 10 },
    { name: "B Flight", maxHandicap: null },
  ],
  sideGames: [
    { kind: "skins", holeValue: 5, holeValueText: "5" },
    { kind: "closest_to_pin", holeValue: null, holeValueText: "" },
  ],
  payouts: { presetId: "50_30_20", purse: 300 },
  sponsors: [{ name: "Ace Golf Cars", logoPath: "club/event/logo.png" }],
  welcomeMessage: "Welcome!",
  isPublic: true,
} as const;

describe("extras step schema", () => {
  it("accepts a complete extras payload", () => {
    expect(extrasStepSchema.safeParse(VALID_EXTRAS).success).toBe(true);
  });

  it("allows at most 8 flights", () => {
    const tooMany = Array.from({ length: 9 }, (_, i) => ({
      name: `Flight ${i + 1}`,
      maxHandicap: i === 8 ? null : i + 1,
    }));
    expect(extrasStepSchema.safeParse({ ...VALID_EXTRAS, flights: tooMany }).success).toBe(false);
  });

  it("rejects descending flight thresholds", () => {
    const backwards = [
      { name: "A Flight", maxHandicap: 20 },
      { name: "B Flight", maxHandicap: 10 },
      { name: "C Flight", maxHandicap: null },
    ];
    const result = extrasStepSchema.safeParse({ ...VALID_EXTRAS, flights: backwards });
    expect(result.success).toBe(false);
  });

  it("rejects equal flight thresholds", () => {
    const equal = [
      { name: "A Flight", maxHandicap: 10 },
      { name: "B Flight", maxHandicap: 10 },
      { name: "C Flight", maxHandicap: null },
    ];
    expect(extrasStepSchema.safeParse({ ...VALID_EXTRAS, flights: equal }).success).toBe(false);
  });

  it("rejects an open threshold before the last flight", () => {
    const openMiddle = [
      { name: "A Flight", maxHandicap: null },
      { name: "B Flight", maxHandicap: 10 },
    ];
    expect(
      extrasStepSchema.safeParse({ ...VALID_EXTRAS, flights: openMiddle }).success,
    ).toBe(false);
  });

  it("requires a value on enabled skins", () => {
    const skinsNoValue = [
      { kind: "skins", holeValue: null, holeValueText: "" },
    ];
    const result = extrasStepSchema.safeParse({
      ...VALID_EXTRAS,
      sideGames: skinsNoValue,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("skins value"))).toBe(true);
    }
  });

  it("rejects a value on a measurement game", () => {
    const longDriveWithValue = [
      { kind: "long_drive", holeValue: 5, holeValueText: "5" },
    ];
    expect(
      extrasStepSchema.safeParse({ ...VALID_EXTRAS, sideGames: longDriveWithValue })
        .success,
    ).toBe(false);
  });

  it("rejects a duplicated side game", () => {
    const doubled = [
      { kind: "skins", holeValue: 5, holeValueText: "5" },
      { kind: "skins", holeValue: 5, holeValueText: "5" },
    ];
    expect(extrasStepSchema.safeParse({ ...VALID_EXTRAS, sideGames: doubled }).success).toBe(false);
  });

  it("accepts a decimal skins value", () => {
    const skins = [
      { kind: "skins", holeValue: 5.5, holeValueText: "5.5" },
    ];
    expect(extrasStepSchema.safeParse({ ...VALID_EXTRAS, sideGames: skins }).success).toBe(true);
  });

  it("rejects a negative skins value", () => {
    const skins = [
      { kind: "skins", holeValue: -1, holeValueText: "-1" },
    ];
    expect(extrasStepSchema.safeParse({ ...VALID_EXTRAS, sideGames: skins }).success).toBe(false);
  });

  it("limits the purse to whole numbers within range", () => {
    expect(
      extrasStepSchema.safeParse({
        ...VALID_EXTRAS,
        payouts: { presetId: "50_30_20", purse: 10.5 },
      }).success,
    ).toBe(false);
    expect(
      extrasStepSchema.safeParse({
        ...VALID_EXTRAS,
        payouts: { presetId: "50_30_20", purse: -1 },
      }).success,
    ).toBe(false);
    expect(
      extrasStepSchema.safeParse({
        ...VALID_EXTRAS,
        payouts: { presetId: "50_30_20", purse: 0 },
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown payout preset", () => {
    expect(
      extrasStepSchema.safeParse({
        ...VALID_EXTRAS,
        payouts: { presetId: "winner_takes_all", purse: 100 },
      }).success,
    ).toBe(false);
  });

  it("allows at most 8 sponsors", () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({
      name: `Sponsor ${i + 1}`,
      logoPath: `club/event/logo-${i + 1}.png`,
    }));
    expect(extrasStepSchema.safeParse({ ...VALID_EXTRAS, sponsors: nine }).success).toBe(false);
    const eight = nine.slice(0, 8);
    expect(extrasStepSchema.safeParse({ ...VALID_EXTRAS, sponsors: eight }).success).toBe(true);
  });

  it("caps the welcome message at 2000 characters", () => {
    expect(
      extrasStepSchema.safeParse({ ...VALID_EXTRAS, welcomeMessage: "x".repeat(2001) })
        .success,
    ).toBe(false);
    expect(
      extrasStepSchema.safeParse({ ...VALID_EXTRAS, welcomeMessage: "x".repeat(2000) })
        .success,
    ).toBe(true);
  });
});

// ─── Defaults ────────────────────────────────────────────────────────────────

describe("extras defaults", () => {
  it("suggests the standard two-flight ladder with an open top", () => {
    const flights = defaultFlights();
    expect(flights).toHaveLength(2);
    expect(flights[0]?.name).toBe("A Flight");
    expect(flights[0]?.maxHandicap).not.toBeNull();
    expect(flights[1]?.maxHandicap).toBeNull();
    // and the ladder must itself validate
    expect(
      extrasStepSchema.safeParse({ ...VALID_EXTRAS, flights }).success,
    ).toBe(true);
  });

  it("keeps the payout presets as data with shares summing to 1", () => {
    for (const preset of PAYOUT_PRESETS) {
      expect(
        preset.shares.reduce((sum, share) => sum + share, 0),
        preset.id,
      ).toBeCloseTo(1);
    }
    expect(SIDE_GAME_LABELS.skins).toBe("Skins");
  });
});

// ─── Row mappers ─────────────────────────────────────────────────────────────

describe("extras row mappers", () => {
  it("maps side-game rows to drafts and back, skipping unknown kinds", () => {
    const rows = [
      { id: "1", gameType: "skins", name: "Skins", holeValue: "5.5" },
      { id: "2", gameType: "wolf", name: "Wolf", holeValue: null }, // not ours
    ];
    const drafts = sideGamesFromRows(rows);
    expect(drafts).toEqual([
      { kind: "skins", holeValue: 5.5, holeValueText: "5.5" },
    ]);

    const persisted = sideGamesToRows("event-1", [
      { kind: "skins", holeValue: 5.5, holeValueText: "5.5" },
      { kind: "long_drive", holeValue: null, holeValueText: "" },
    ]);
    expect(persisted).toEqual([
      { event_id: "event-1", game_type: "skins", name: "Skins", hole_value: 5.5 },
      { event_id: "event-1", game_type: "long_drive", name: "Long drive", hole_value: null },
    ]);
  });

  it("maps stored payout columns onto the step state with a safe fallback", () => {
    expect(payoutStepFromStored("60_30_10", 300)).toEqual({
      presetId: "60_30_10",
      purse: 300,
    });
    // unknown/renamed preset falls back to the standard 50/30/20
    expect(payoutStepFromStored("winner_takes_all", 100)).toEqual({
      presetId: "50_30_20",
      purse: 100,
    });
    // legacy rows can never render the step invalid: purse clamped into range
    expect(payoutStepFromStored(null, null)).toEqual({
      presetId: "50_30_20",
      purse: 0,
    });
    expect(payoutStepFromStored("50_30_20", 9_999_999)).toEqual({
      presetId: "50_30_20",
      purse: PAYOUT_PURSE_MAX,
    });
    expect(payoutStepFromStored("50_30_20", -5)).toEqual({
      presetId: "50_30_20",
      purse: 0,
    });
  });

  it("sorts flights and sponsors by their persisted position", () => {
    const flights = flightsFromRows([
      { id: "2", name: "B Flight", maxHandicap: null, position: 1 },
      { id: "1", name: "A Flight", maxHandicap: 10, position: 0 },
    ]);
    expect(flights.map((flight) => flight.name)).toEqual(["A Flight", "B Flight"]);
    expect(flights[1]?.maxHandicap).toBeNull();

    const sponsors = sponsorsFromRows([
      { id: "2", name: "Second", logoPath: "p2", position: 1 },
      { id: "1", name: "First", logoPath: "p1", position: 0 },
    ]);
    expect(sponsors.map((sponsor) => sponsor.name)).toEqual(["First", "Second"]);
  });
});
