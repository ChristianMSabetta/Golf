import { describe, expect, it } from "vitest";
import {
  EVENT_ADMIN_TABS,
  EVENT_ADMIN_TAB_IDS,
  FORMAT_CHANGE_CONFIRMATION,
  STATUS_LABELS,
  eventSettingsSchema,
  formatChangeNeedsConfirmation,
  formatEventDate,
  isFormatChangeConfirmed,
  tabFromParams,
} from "./admin";

/**
 * Event admin logic tests (M4-T008): the tab registry + resolver, the
 * CHANGE confirmation guard (the mid-event format-edit safeguard), the
 * date formatter, and the Settings-step Zod contract.
 */

const VALID_SETTINGS = {
  name: "Tuesday Stableford",
  startDate: "2026-10-21",
  holesCount: 18,
  nineOption: "front",
  rounds: 1,
  startType: "tee_times",
  format: "stableford",
  teamSize: 1,
  scoringBasis: "both",
  handicapAllowancePct: 95,
  maxScoreRule: "none",
  maxScoreFixedCap: null,
  tiebreakMethod: "card_off",
  welcomeMessage: "Play well!",
  isPublic: true,
} as const;

describe("event admin tab registry", () => {
  it("declares the four tabs in rail order", () => {
    expect(EVENT_ADMIN_TABS.map((tab) => tab.id)).toEqual([
      "overview",
      "players",
      "groups",
      "settings",
    ]);
    expect(EVENT_ADMIN_TAB_IDS).toContain("settings");
  });

  it("resolves tab params with a fallback to overview", () => {
    expect(tabFromParams("players")).toBe("players");
    expect(tabFromParams("groups")).toBe("groups");
    expect(tabFromParams("nonsense")).toBe("overview");
    expect(tabFromParams(undefined)).toBe("overview");
  });
});

describe("the CHANGE confirmation guard", () => {
  it("requires the confirmation exactly", () => {
    expect(isFormatChangeConfirmed("CHANGE")).toBe(true);
    expect(isFormatChangeConfirmed("change")).toBe(false);
    expect(isFormatChangeConfirmed(" CHANGE ")).toBe(true);
    expect(isFormatChangeConfirmed("")).toBe(false);
  });

  it("demands confirmation only on live (published) events", () => {
    expect(formatChangeNeedsConfirmation("draft")).toBe(false);
    expect(formatChangeNeedsConfirmation("scheduled")).toBe(true);
    expect(formatChangeNeedsConfirmation("live")).toBe(true);
    expect(formatChangeNeedsConfirmation("completed")).toBe(true);
    expect(formatChangeNeedsConfirmation("archived")).toBe(true);
  });

  it("labels the confirmation constant", () => {
    expect(FORMAT_CHANGE_CONFIRMATION).toBe("CHANGE");
  });
});

describe("status helpers", () => {
  it("labels every status", () => {
    for (const status of Object.keys(STATUS_LABELS)) {
      expect(STATUS_LABELS[status as keyof typeof STATUS_LABELS]).toBeTruthy();
    }
  });

  it("formats ISO dates as MM/DD/YYYY", () => {
    expect(formatEventDate("2026-10-21")).toBe("10/21/2026");
    expect(formatEventDate("2026-01-05")).toBe("01/05/2026");
  });
});

describe("the settings schema", () => {
  it("accepts a valid settings payload", () => {
    expect(eventSettingsSchema.safeParse(VALID_SETTINGS).success).toBe(true);
  });

  it("coerces numeric string cells (form inputs)", () => {
    expect(
      eventSettingsSchema.safeParse({
        ...VALID_SETTINGS,
        holesCount: "18",
        rounds: "1",
        teamSize: "1",
        handicapAllowancePct: "95",
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown format", () => {
    expect(
      eventSettingsSchema.safeParse({
        ...VALID_SETTINGS,
        format: "match_play",
      }).success,
    ).toBe(false);
  });

  it("rejects an out-of-range allowance", () => {
    const result = eventSettingsSchema.safeParse({
      ...VALID_SETTINGS,
      handicapAllowancePct: "150",
    });
    expect(result.success).toBe(false);
  });

  it("demands the fixed cap when the rule is fixed", () => {
    const missing = eventSettingsSchema.safeParse({
      ...VALID_SETTINGS,
      maxScoreRule: "fixed",
      maxScoreFixedCap: null,
    });
    expect(missing.success).toBe(false);

    const present = eventSettingsSchema.safeParse({
      ...VALID_SETTINGS,
      maxScoreRule: "fixed",
      maxScoreFixedCap: 8,
    });
    expect(present.success).toBe(true);
  });

  it("refuses a fixed cap when the rule is not fixed", () => {
    expect(
      eventSettingsSchema.safeParse({
        ...VALID_SETTINGS,
        maxScoreRule: "none",
        maxScoreFixedCap: 8,
      }).success,
    ).toBe(false);
  });

  it("locks individual formats to team size 1", () => {
    expect(
      eventSettingsSchema.safeParse({
        ...VALID_SETTINGS,
        format: "stroke_play",
        teamSize: 2,
      }).success,
    ).toBe(false);
  });

  it("demands 2+ per team on team formats", () => {
    expect(
      eventSettingsSchema.safeParse({
        ...VALID_SETTINGS,
        format: "scramble",
        teamSize: 1,
      }).success,
    ).toBe(false);
  });

  it("rejects an empty name and a malformed date", () => {
    expect(
      eventSettingsSchema.safeParse({ ...VALID_SETTINGS, name: " " }).success,
    ).toBe(false);
    expect(
      eventSettingsSchema.safeParse({
        ...VALID_SETTINGS,
        startDate: "21-10-2026",
      }).success,
    ).toBe(false);
  });
});
