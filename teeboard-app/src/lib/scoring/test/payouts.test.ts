/**
 * Payout verification: purse splits, tie handling (a tie combines the
 * spanned positions' amounts and splits them equally — USGA
 * Recommendations to Committees on prize allocation), and
 * largest-remainder cent-splitting that sums back exactly.
 */
import { describe, expect, it } from "vitest";
import {
  computePayouts,
  defaultPayoutConfig,
  PAYOUT_PRESET_50_30_20,
  splitEvenly,
} from "../src";

describe("defaultPayoutConfig / preset", () => {
  it("is the 50/30/20 three-position preset", () => {
    const config = defaultPayoutConfig(30000);
    expect(PAYOUT_PRESET_50_30_20).toEqual([0.5, 0.3, 0.2]);
    expect(config.purse).toBe(30000);
    expect(config.positions.map((p) => p.share)).toEqual([0.5, 0.3, 0.2]);
  });
});

describe("splitEvenly", () => {
  it("splits evenly divisible amounts exactly", () => {
    expect(splitEvenly(1000, 2)).toEqual([500, 500]);
    expect(splitEvenly(900, 3)).toEqual([300, 300, 300]);
  });

  it("uses largest-remainder rounding so shares sum back exactly", () => {
    // 1000 in 3 → 333.33… → [334, 333, 333]
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333]);
    expect(splitEvenly(1000, 3).reduce((a, b) => a + b, 0)).toBe(1000);
    expect(splitEvenly(101, 2)).toEqual([51, 50]);
  });

  it("degenerate counts", () => {
    expect(splitEvenly(500, 1)).toEqual([500]);
    expect(splitEvenly(500, 0)).toEqual([]);
  });
});

describe("computePayouts", () => {
  it("no ties: 50/30/20 pays positions 1–3 exactly", () => {
    const payouts = computePayouts({
      config: defaultPayoutConfig(30000),
      standings: [
        { id: "A", position: 1 },
        { id: "B", position: 2 },
        { id: "C", position: 3 },
      ],
    });
    expect(payouts.entries.map((e) => [e.id, e.amount])).toEqual([
      ["A", 15000],
      ["B", 9000],
      ["C", 6000],
    ]);
    expect(payouts.positions).toBe(3);
  });

  it("tie at 1st: spans slots 1–2, combines 50+30, splits equally", () => {
    const payouts = computePayouts({
      config: defaultPayoutConfig(30000),
      standings: [
        { id: "X", position: 1 },
        { id: "Y", position: 1 },
        { id: "Z", position: 3 },
      ],
    });
    const x = payouts.entries.find((e) => e.id === "X")!;
    expect(x.combinedAmount).toBe(24000);
    expect(x.slots.map((s) => [s.slot, s.amount, s.share])).toEqual([
      [1, 15000, 0.5],
      [2, 9000, 0.3],
    ]);
    expect(x.amount).toBe(12000);
    expect(payouts.entries.find((e) => e.id === "Y")!.amount).toBe(12000);
    expect(payouts.entries.find((e) => e.id === "Z")!.amount).toBe(6000);
  });

  it("tie at the last paid position spills past the purse and splits", () => {
    // Two tied at position 3 span slots 3–4: 20% + 0 → 6000 split 3000.
    const payouts = computePayouts({
      config: defaultPayoutConfig(30000),
      standings: [
        { id: "A", position: 1 },
        { id: "B", position: 2 },
        { id: "C", position: 3 },
        { id: "D", position: 3 },
      ],
    });
    const c = payouts.entries.find((e) => e.id === "C")!;
    expect(c.slots.map((s) => [s.slot, s.amount])).toEqual([
      [3, 6000],
      [4, 0],
    ]);
    expect(c.amount).toBe(3000);
    expect(payouts.entries.find((e) => e.id === "D")!.amount).toBe(3000);
    // The whole purse is distributed: 15000 + 9000 + 3000 + 3000.
    expect(payouts.entries.reduce((sum, e) => sum + e.amount, 0)).toBe(30000);
  });

  it("a three-way tie combines three slots and splits three ways", () => {
    const payouts = computePayouts({
      config: defaultPayoutConfig(30000),
      standings: [
        { id: "A", position: 1 },
        { id: "B", position: 1 },
        { id: "C", position: 1 },
      ],
    });
    // Slots 1–3 = 30000 combined; 10000 each — full purse, split evenly.
    expect(payouts.entries.map((e) => e.amount)).toEqual([10000, 10000, 10000]);
    expect(payouts.entries.reduce((sum, e) => sum + e.amount, 0)).toBe(30000);
  });

  it("a tie group larger than the positions splits the remainder exactly", () => {
    const payouts = computePayouts({
      config: defaultPayoutConfig(1000),
      standings: [
        { id: "A", position: 1 },
        { id: "B", position: 1 },
        { id: "C", position: 1 },
        { id: "D", position: 1 },
      ],
    });
    // Slots 1–4: 500+300+200+0 = 1000; split 4 ways = 250 each.
    expect(payouts.entries.map((e) => e.amount)).toEqual([250, 250, 250, 250]);
  });

  it("odd-cent tie splits with largest remainder and sum back exactly", () => {
    const config = {
      purse: 1000,
      positions: [
        { share: 0.5 },
        { share: 0.3 },
        { share: 0.2 },
      ],
    };
    const payouts = computePayouts({
      config,
      standings: [
        { id: "A", position: 1 },
        { id: "B", position: 1 },
        { id: "C", position: 1 },
        { id: "D", position: 4 },
      ],
    });
    // Slots 1–3 = 1000 combined; three-way split → [334, 333, 333].
    expect(payouts.entries.find((e) => e.id === "A")!.amount).toBe(334);
    expect(payouts.entries.find((e) => e.id === "B")!.amount).toBe(333);
    expect(payouts.entries.find((e) => e.id === "C")!.amount).toBe(333);
    expect(payouts.entries.find((e) => e.id === "D")!.amount).toBe(0);
    expect(payouts.entries.reduce((sum, e) => sum + e.amount, 0)).toBe(1000);
  });

  it("participants outside the paid positions receive nothing", () => {
    const payouts = computePayouts({
      config: defaultPayoutConfig(30000),
      standings: [
        { id: "A", position: 1 },
        { id: "loser", position: 4 },
      ],
    });
    expect(payouts.entries.find((e) => e.id === "loser")?.amount ?? 0).toBe(0);
    expect(payouts.entries.find((e) => e.id === "loser")?.slots).toEqual([
      { slot: 4, amount: 0, share: 0 },
    ]);
  });

  it("empty standings or positions pay nothing", () => {
    expect(computePayouts({ config: defaultPayoutConfig(30000), standings: [] }).entries).toEqual([]);
    expect(
      computePayouts({ config: { purse: 30000, positions: [] }, standings: [{ id: "A", position: 1 }] }).entries,
    ).toEqual([]);
  });

  it("unsorted standings are grouped by position regardless of input order", () => {
    const payouts = computePayouts({
      config: defaultPayoutConfig(30000),
      standings: [
        { id: "Z", position: 3 },
        { id: "X", position: 1 },
        { id: "Y", position: 1 },
      ],
    });
    expect(payouts.entries.find((e) => e.id === "X")!.amount).toBe(12000);
    expect(payouts.entries.find((e) => e.id === "Z")!.position).toBe(3);
  });
});
