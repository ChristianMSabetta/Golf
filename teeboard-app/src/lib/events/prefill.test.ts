import { describe, expect, it } from "vitest";
import { prefillAwareBasics, prefillAwareFormat } from "./prefill";
import { formatDefaults } from "./schema";
import type { WizardDraftData } from "./wizard";

/**
 * AI-prefill merge verification (M4-T004): precedence is prefill → draft →
 * WHS defaults, and a prefilled format switches the defaults to that
 * format. Expected values derive from the wizard schema and
 * @teeboard/scoring's WHS constants — never mirrored from an
 * implementation.
 */

const TODAY = "2026-10-21";
const FALLBACK_COURSE = "11111111-1111-4111-8111-111111111111";

const DRAFT: WizardDraftData = {
  eventId: "22222222-2222-4222-8222-222222222222",
  name: "Saved Draft",
  startDate: "2026-11-01",
  courseId: "33333333-3333-4333-8333-333333333333",
  holesCount: 9,
  nineOption: "back",
  rounds: 2,
  startType: "tee_times",
  formatData: {
    format: "best_ball",
    teamSize: 2,
    scoringBasis: "both",
    handicapAllowancePct: 85,
    maxScoreRule: "net_double_bogey",
    maxScoreFixedCap: null,
    tiebreakMethod: "card_off",
  },
};

describe("prefillAwareBasics", () => {
  it("falls back to the draft, then the defaults, with no prefill", () => {
    const state = prefillAwareBasics(DRAFT, null, TODAY, FALLBACK_COURSE);
    expect(state).toEqual({
      name: "Saved Draft",
      startDate: "2026-11-01",
      courseId: "33333333-3333-4333-8333-333333333333",
      holesCount: 9,
      nineOption: "back",
      rounds: 2,
      startType: "tee_times",
    });
  });

  it("uses fresh defaults when no draft and no prefill exist", () => {
    const state = prefillAwareBasics(null, null, TODAY, FALLBACK_COURSE);
    expect(state.name).toBe("");
    expect(state.startDate).toBe(TODAY);
    expect(state.courseId).toBe(FALLBACK_COURSE);
    expect(state.holesCount).toBe(18);
    expect(state.nineOption).toBe("front");
    expect(state.rounds).toBe(1);
    expect(state.startType).toBe("tee_times");
  });

  it("lets the prefill win over the draft per field", () => {
    const state = prefillAwareBasics(
      DRAFT,
      { holesCount: 18, startType: "shotgun" },
      TODAY,
      FALLBACK_COURSE,
    );
    expect(state.name).toBe("Saved Draft");
    expect(state.holesCount).toBe(18);
    expect(state.startType).toBe("shotgun");
    expect(state.nineOption).toBe("back");
    expect(state.rounds).toBe(2);
  });

  it("never lets the AI pick the course", () => {
    const state = prefillAwareBasics(null, { name: "AI only" }, TODAY, FALLBACK_COURSE);
    expect(state.courseId).toBe(FALLBACK_COURSE);
  });
});

describe("prefillAwareFormat", () => {
  it("keeps the saved format when no prefill states one", () => {
    const format = prefillAwareFormat(DRAFT, null);
    expect(format).toEqual(DRAFT.formatData);
  });

  it("starts from stroke play defaults with nothing saved or prefilled", () => {
    const format = prefillAwareFormat(null, null);
    const defaults = formatDefaults("stroke_play");
    expect(format.format).toBe("stroke_play");
    expect(format.handicapAllowancePct).toBe(defaults.handicapAllowancePct);
    expect(format.maxScoreRule).toBe("net_double_bogey");
    expect(format.teamSize).toBe(1);
    expect(format.tiebreakMethod).toBe("card_off");
    expect(format.maxScoreFixedCap).toBeNull();
  });

  it("switches the WHS defaults to a prefilled format", () => {
    const format = prefillAwareFormat(DRAFT, { format: "stableford" });
    expect(format.format).toBe("stableford");
    expect(format.teamSize).toBe(1);
    expect(format.handicapAllowancePct).toBe(
      formatDefaults("stableford").handicapAllowancePct,
    );
    expect(format.maxScoreRule).toBe("none");
  });

  it("lets per-field prefill override the saved format data", () => {
    const format = prefillAwareFormat(DRAFT, {
      format: "scramble",
      teamSize: 4,
      handicapAllowancePct: 80,
    });
    expect(format.format).toBe("scramble");
    expect(format.teamSize).toBe(4);
    expect(format.handicapAllowancePct).toBe(80);
    expect(format.scoringBasis).toBe("both");
    expect(format.tiebreakMethod).toBe("card_off");
  });

  it("carries a prefilled fixed cap through", () => {
    const format = prefillAwareFormat(DRAFT, {
      maxScoreRule: "fixed",
      maxScoreFixedCap: 8,
    });
    expect(format.maxScoreRule).toBe("fixed");
    expect(format.maxScoreFixedCap).toBe(8);
  });
});
