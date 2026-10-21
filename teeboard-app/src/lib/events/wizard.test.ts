import { describe, expect, it } from "vitest";
import {
  CARD_OFF_STAGES,
  DEFAULT_MAX_SCORE_RULE,
  DEFAULT_TEAM_SIZE,
  NET_DOUBLE_BOGEY_OVER_PAR,
  WHS_DEFAULT_ALLOWANCE_PCT,
  basicsStepSchema,
  formatStepSchema,
  formatDefaults,
  WIZARD_STEPS,
  WIZARD_STEP_IDS,
} from "./schema";
import {
  FOUR_BALL_DEFAULT_ALLOWANCE,
  NET_COMPETITION_DEFAULT_ALLOWANCE,
} from "@/lib/scoring";
import {
  canNavigate,
  completedSteps,
  furthestStep,
  toWizardDraft,
  validateBasics,
  validateFormat,
  wizardSteps,
} from "./wizard";

/**
 * Wizard foundation verification (M4-T003): per-step Zod contracts, WHS
 * defaults derived from @teeboard/scoring, navigation gating, and the
 * database-row mappers. Expected values are hand-derived from the WHS
 * rules the scoring package cites — never mirrored from an implementation.
 */

const VALID_BASICS = {
  name: "Saturday Scramble",
  startDate: "2026-10-24",
  courseId: "11111111-1111-4111-8111-111111111111",
  holesCount: 18,
  nineOption: "front",
  rounds: 1,
  startType: "tee_times",
} as const;

const VALID_FORMAT = {
  format: "scramble",
  teamSize: 2,
  scoringBasis: "both",
  handicapAllowancePct: "85",
  maxScoreRule: "none",
  maxScoreFixedCap: "",
  tiebreakMethod: "card_off",
} as const;

// ─── Step registry ───────────────────────────────────────────────────────────

describe("wizard step registry", () => {
  it("lists the five steps in order", () => {
    expect(WIZARD_STEPS.map((step) => step.id)).toEqual([
      "basics",
      "format",
      "players",
      "groups",
      "extras",
    ]);
    expect(WIZARD_STEP_IDS).toHaveLength(5);
  });

  it("marks exactly Basics, Format, Players, and Groups implemented through M4-T006", () => {
    expect(WIZARD_STEPS.filter((step) => step.implemented).map((s) => s.id))
      .toEqual(["basics", "format", "players", "groups"]);
  });
});

// ─── Basics step ─────────────────────────────────────────────────────────────

describe("basics step schema", () => {
  it("accepts a complete basics payload with coerced numbers", () => {
    const parsed = basicsStepSchema.parse({
      ...VALID_BASICS,
      holesCount: "18",
      rounds: "2",
    });
    expect(parsed.holesCount).toBe(18);
    expect(parsed.rounds).toBe(2);
  });

  it("requires every field", () => {
    const result = basicsStepSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects holes counts other than 9 and 18", () => {
    expect(
      basicsStepSchema.safeParse({ ...VALID_BASICS, holesCount: 12 }).success,
    ).toBe(false);
  });

  it("rejects rounds other than 1 and 2", () => {
    expect(
      basicsStepSchema.safeParse({ ...VALID_BASICS, rounds: 3 }).success,
    ).toBe(false);
  });

  it("rejects malformed dates", () => {
    expect(
      basicsStepSchema.safeParse({ ...VALID_BASICS, startDate: "10/24/2026" })
        .success,
    ).toBe(false);
  });

  it("rejects unknown start types", () => {
    expect(
      basicsStepSchema.safeParse({ ...VALID_BASICS, startType: "cannon" })
        .success,
    ).toBe(false);
  });
});

// ─── Format step ─────────────────────────────────────────────────────────────

describe("format step schema", () => {
  it("accepts a complete format payload", () => {
    expect(formatStepSchema.safeParse(VALID_FORMAT).success).toBe(true);
  });

  it("requires a fixed cap when the rule is fixed", () => {
    const result = formatStepSchema.safeParse({
      ...VALID_FORMAT,
      maxScoreRule: "fixed",
      maxScoreFixedCap: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a fixed cap outside the bounds", () => {
    expect(
      formatStepSchema.safeParse({
        ...VALID_FORMAT,
        maxScoreRule: "fixed",
        maxScoreFixedCap: "21",
      }).success,
    ).toBe(false);
  });

  it("rejects a fixed cap set under a non-fixed rule", () => {
    const result = formatStepSchema.safeParse({
      ...VALID_FORMAT,
      maxScoreFixedCap: "10",
    });
    expect(result.success).toBe(false);
  });

  it("rejects out-of-range allowance percentages", () => {
    expect(
      formatStepSchema.safeParse({
        ...VALID_FORMAT,
        handicapAllowancePct: "101",
      }).success,
    ).toBe(false);
  });

  it("rejects more than one decimal place on the allowance", () => {
    expect(
      formatStepSchema.safeParse({
        ...VALID_FORMAT,
        handicapAllowancePct: "95.25",
      }).success,
    ).toBe(false);
  });

  it("keeps individual formats individual", () => {
    expect(
      formatStepSchema.safeParse({
        ...VALID_FORMAT,
        format: "stroke_play",
        teamSize: 2,
      }).success,
    ).toBe(false);
  });

  it("requires team formats to have at least a pair", () => {
    expect(
      formatStepSchema.safeParse({
        ...VALID_FORMAT,
        teamSize: 1,
      }).success,
    ).toBe(false);
  });
});

// ─── WHS defaults ───────────────────────────────────────────────────────────

describe("WHS format defaults", () => {
  it("derives the individual allowance from Rule 5.5 (95%)", () => {
    expect(WHS_DEFAULT_ALLOWANCE_PCT.stroke_play).toBe(
      NET_COMPETITION_DEFAULT_ALLOWANCE * 100,
    );
    expect(WHS_DEFAULT_ALLOWANCE_PCT.stroke_play).toBe(95);
    expect(WHS_DEFAULT_ALLOWANCE_PCT.stableford).toBe(95);
  });

  it("derives the four-ball allowance from Rule 5.5 (85%)", () => {
    expect(WHS_DEFAULT_ALLOWANCE_PCT.best_ball).toBe(
      FOUR_BALL_DEFAULT_ALLOWANCE * 100,
    );
    expect(WHS_DEFAULT_ALLOWANCE_PCT.best_ball).toBe(85);
    expect(WHS_DEFAULT_ALLOWANCE_PCT.scramble).toBe(85);
    expect(WHS_DEFAULT_ALLOWANCE_PCT.shamble).toBe(85);
  });

  it("defaults individual formats to one player", () => {
    expect(DEFAULT_TEAM_SIZE.stroke_play).toBe(1);
    expect(DEFAULT_TEAM_SIZE.stableford).toBe(1);
  });

  it("defaults team formats to pairs", () => {
    expect(DEFAULT_TEAM_SIZE.best_ball).toBe(2);
    expect(DEFAULT_TEAM_SIZE.scramble).toBe(2);
    expect(DEFAULT_TEAM_SIZE.shamble).toBe(2);
  });

  it("applies the WHS net double bogey default where 3.3b applies", () => {
    expect(DEFAULT_MAX_SCORE_RULE.stroke_play).toBe("net_double_bogey");
    expect(DEFAULT_MAX_SCORE_RULE.best_ball).toBe("net_double_bogey");
    expect(DEFAULT_MAX_SCORE_RULE.stableford).toBe("none");
    expect(NET_DOUBLE_BOGEY_OVER_PAR).toBe(2);
  });

  it("surfaces the USGA card-off stages", () => {
    expect([...CARD_OFF_STAGES]).toEqual([9, 6, 3]);
  });

  it("produces a valid draft from every format's defaults", () => {
    for (const format of [
      "stroke_play",
      "scramble",
      "best_ball",
      "stableford",
      "shamble",
    ] as const) {
      const defaults = formatDefaults(format);
      expect(defaults.format).toBe(format);
      expect(
        formatStepSchema.safeParse({
          ...defaults,
          handicapAllowancePct: String(defaults.handicapAllowancePct),
          maxScoreFixedCap: "",
        }).success,
        format,
      ).toBe(true);
    }
  });
});

// ─── Gating & navigation ─────────────────────────────────────────────────────

describe("step gating", () => {
  it("locks everything but Basics before a valid draft exists", () => {
    expect(furthestStep(null, null)).toBe(0);
    expect(furthestStep({}, null)).toBe(0);
  });

  it("unlocks Format once Basics validates", () => {
    expect(furthestStep(VALID_BASICS, null)).toBe(1);
  });

  it("unlocks Players once Format validates too", () => {
    expect(furthestStep(VALID_BASICS, VALID_FORMAT)).toBe(2);
  });

  it("unlocks Groups once players are attached", () => {
    expect(furthestStep(VALID_BASICS, VALID_FORMAT, 4)).toBe(3);
    expect(furthestStep(VALID_BASICS, VALID_FORMAT, 0)).toBe(2);
  });

  it("marks completed steps from validated data", () => {
    expect(completedSteps(null, null)).toEqual([]);
    expect(completedSteps(VALID_BASICS, null)).toEqual(["basics"]);
    expect(completedSteps(VALID_BASICS, VALID_FORMAT)).toEqual([
      "basics",
      "format",
    ]);
    expect(completedSteps(VALID_BASICS, VALID_FORMAT, 2)).toEqual([
      "basics",
      "format",
      "players",
    ]);
  });

  it("allows navigation up to the furthest unlocked step", () => {
    expect(canNavigate("basics", 0, [])).toBe(true);
    expect(canNavigate("format", 1, [])).toBe(true);
    expect(canNavigate("players", 1, [])).toBe(false);
  });

  it("allows revisiting previously visited steps even when locked", () => {
    expect(canNavigate("players", 1, ["players"])).toBe(true);
    expect(canNavigate("format", 0, ["format"])).toBe(true);
  });

  it("renders statuses on the step views", () => {
    const views = wizardSteps(1, ["basics"]);
    expect(views[0]?.status).toBe("complete");
    expect(views[1]?.status).toBe("available");
    expect(views[2]?.status).toBe("locked");
    expect(views).toHaveLength(5);
  });

  it("validates drafts through the same schemas", () => {
    expect(validateBasics(VALID_BASICS)).not.toBeNull();
    expect(validateBasics({ name: "" })).toBeNull();
    expect(validateFormat(VALID_FORMAT)).not.toBeNull();
    expect(validateFormat({ format: "match_play" })).toBeNull();
  });
});

// ─── Database-row mapper ─────────────────────────────────────────────────────

describe("toWizardDraft", () => {
  const eventRow = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Saturday Scramble",
    start_date: "2026-10-24",
    course_id: "11111111-1111-4111-8111-111111111111",
    holes_count: 9,
    nine_option: "back",
    rounds: 2,
    start_type: "shotgun",
  };

  it("maps the events row onto the wizard draft", () => {
    const draft = toWizardDraft(eventRow, null);
    expect(draft.holesCount).toBe(9);
    expect(draft.nineOption).toBe("back");
    expect(draft.rounds).toBe(2);
    expect(draft.startType).toBe("shotgun");
    expect(draft.formatData).toBeNull();
  });

  it("maps the primary event_formats row onto the format data", () => {
    const draft = toWizardDraft(eventRow, {
      format: "scramble",
      is_primary: true,
      team_size: 2,
      scoring_basis: "net",
      handicap_allowance_pct: "85",
      max_score_rule: "fixed",
      max_score_fixed_cap: 10,
      tiebreak_method: "card_off",
    });
    expect(draft.formatData).toEqual({
      format: "scramble",
      teamSize: 2,
      scoringBasis: "net",
      handicapAllowancePct: 85,
      maxScoreRule: "fixed",
      maxScoreFixedCap: 10,
      tiebreakMethod: "card_off",
    });
  });

  it("falls back to wizard defaults on unknown enum-ish values", () => {
    const draft = toWizardDraft(
      { ...eventRow, holes_count: 12, nine_option: "side", start_type: "wave" },
      {
        format: "match_play",
        is_primary: true,
        team_size: 2,
        scoring_basis: "gross",
        handicap_allowance_pct: null,
        max_score_rule: "capped",
        max_score_fixed_cap: null,
        tiebreak_method: "lottery",
      },
    );
    expect(draft.holesCount).toBe(18);
    expect(draft.nineOption).toBe("front");
    expect(draft.startType).toBe("tee_times");
    expect(draft.formatData).toBeNull();
  });
});
