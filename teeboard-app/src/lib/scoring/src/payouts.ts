/**
 * Payout calculation: a purse split across payout positions with correct
 * tie handling — a tie *combines the amounts of every position it spans and
 * splits the combined amount equally* (dividing and redistributing per
 * position; never a duplicated payout, which would silently overpay).
 *
 * All amounts are minor-currency integers (cents); equal shares use
 * largest-remainder rounding so a tie's shares always sum back to the
 * combined amount exactly.
 */
import { PAYOUT_PRESET_50_30_20 } from "./constants";
import type { PayoutConfig, PayoutEntry, PayoutSlot, PayoutSummary } from "./types";

/**
 * Default payout configuration: the 50/30/20 preset — three positions at
 * 50%, 30%, and 20% of the purse.
 */
export function defaultPayoutConfig(purse: number): PayoutConfig {
  return {
    purse,
    positions: [...PAYOUT_PRESET_50_30_20].map((share) => ({ share })),
  };
}

/** Amount assigned to a 1-based payout slot (0 beyond the last position). */
function slotAmount(config: PayoutConfig, slot: number): number {
  if (slot < 1 || slot > config.positions.length) {
    return 0;
  }
  return Math.round(config.purse * config.positions[slot - 1].share);
}

/**
 * Split `amount` (minor currency) into `partsCount` equal shares with
 * largest-remainder rounding: shares sum back to exactly `amount` — no
 * cents created or lost by the tie.
 */
export function splitEvenly(amount: number, partsCount: number): number[] {
  if (partsCount <= 0) {
    return [];
  }
  if (partsCount === 1) {
    return [amount];
  }
  const exact = amount / partsCount;
  const shares = Array.from({ length: partsCount }, () => Math.floor(exact));
  let remainder = amount - shares.reduce((sum, s) => sum + s, 0);
  let index = 0;
  while (remainder > 0) {
    shares[index % partsCount] += 1;
    remainder -= 1;
    index += 1;
  }
  return shares;
}

/**
 * Compute payouts for a field.
 *
 * `standings` carries the **competition positions** (1-based): tied
 * participants share one position and the next distinct position skips
 * accordingly (T1, T1, 3 — the standard tournament placing). A tie group
 * at position `p` with `n` participants occupies payout slots
 * `p … p+n−1`: the group's amount is the sum of those slots' amounts,
 * split into `n` equal shares.
 *
 * Participants outside the configured positions receive nothing (no
 * negative amounts, no beyond-purse payouts).
 */
export function computePayouts(input: {
  config: PayoutConfig;
  standings: { id: string; position: number }[];
}): PayoutSummary {
  const { config, standings } = input;
  if (standings.length === 0 || config.positions.length === 0) {
    return { purse: config.purse, positions: config.positions.length, entries: [] };
  }

  const grouped = new Map<number, { ids: string[] }>();
  for (const s of [...standings].sort((a, b) => a.position - b.position)) {
    if (s.position < 1) {
      continue;
    }
    const group = grouped.get(s.position) ?? { ids: [] };
    group.ids.push(s.id);
    grouped.set(s.position, group);
  }

  const entries: PayoutEntry[] = [];
  for (const [position, group] of grouped) {
    const spannedSlots: PayoutSlot[] = [];
    for (let slot = position; slot < position + group.ids.length; slot += 1) {
      spannedSlots.push({
        slot,
        amount: slotAmount(config, slot),
        share:
          slot >= 1 && slot <= config.positions.length
            ? config.positions[slot - 1].share
            : 0,
      });
    }
    const combined = spannedSlots.reduce((sum, s) => sum + s.amount, 0);
    const shares = splitEvenly(combined, group.ids.length);
    group.ids.forEach((id, i) => {
      entries.push({
        id,
        position,
        tieCount: group.ids.length,
        slots: spannedSlots,
        combinedAmount: combined,
        amount: shares[i],
      });
    });
  }

  return {
    purse: config.purse,
    positions: config.positions.length,
    entries,
  };
}
