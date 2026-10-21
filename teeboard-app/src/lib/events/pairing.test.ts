import { describe, expect, it } from "vitest";
import {
  generatePairingPlan,
  movePairingPlayer,
  normalizePairingPlan,
  shotgunHoles,
  validatePairingPlan,
  PAIRING_STRATEGIES,
  groupsStepPayloadSchema,
} from "./pairing";

/**
 * Groups & teams step verification (M4-T006): pairing strategies, team-size
 * respect, shotgun hole assignment, cart handling, drag-and-drop move
 * semantics, and the payload contract — expected values hand-derived.
 */

function field(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    playerId: `p${i + 1}`,
    fullName: `Player ${i + 1}`,
    handicapIndex: [4.2, 11.7, 2.1, 17.9, 8.4, 14.3, 6.5, 21.0, 0.5, 10.1][
      i % 10
    ],
  }));
}

const BASE = {
  teamSize: 2,
  holesCount: 18,
  nineOption: "front" as const,
  startType: "shotgun" as const,
};

// ─── Shotgun hole assignment ──────────────────────────────────────────────────

describe("shotgun holes", () => {
  it("plays the full 1–18 on an 18-hole event", () => {
    expect(shotgunHoles(18, "front")).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
  });

  it("plays 1–9 on a front-nine event", () => {
    expect(shotgunHoles(9, "front")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("plays 10–18 on a back-nine event", () => {
    expect(shotgunHoles(9, "back")).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
  });
});

// ─── Pairing strategies ───────────────────────────────────────────────────────

describe("generatePairingPlan", () => {
  it("respects the configured team size on every strategy", () => {
    for (const strategy of PAIRING_STRATEGIES) {
      if (strategy === "manual") continue;
      const plan = generatePairingPlan({
        ...BASE,
        players: field(17),
        strategy,
      });
      const sizes = plan.groups.map((group) => group.playerIds.length);
      expect(sizes.reduce((a, b) => a + b, 0), strategy).toBe(17);
      // 17 players in teams of 2 → one team short; never over the size.
      expect(sizes.every((size) => size <= 2), strategy).toBe(true);
      expect(
        Math.max(...sizes) - Math.min(...sizes) <= 1,
        strategy,
      ).toBe(true);
    }
  });

  it("places every player exactly once", () => {
    const players = field(13);
    const plan = generatePairingPlan({ ...BASE, players, strategy: "random" });
    const placed = plan.groups.flatMap((group) => group.playerIds);
    expect(placed).toHaveLength(13);
    expect(new Set(placed).size).toBe(13);
    expect(plan.unassigned).toEqual([]);
  });

  it("handles the empty field", () => {
    expect(generatePairingPlan({ ...BASE, players: [], strategy: "random" }))
      .toEqual({ groups: [], unassigned: [] });
  });

  it("pools everyone under manual", () => {
    const plan = generatePairingPlan({
      ...BASE,
      players: field(5),
      strategy: "manual",
    });
    expect(plan.groups).toEqual([]);
    expect(plan.unassigned).toHaveLength(5);
  });

  it("assigns unique starting holes in order on a shotgun start", () => {
    const plan = generatePairingPlan({
      ...BASE,
      players: field(10),
      strategy: "random",
    });
    const holes = plan.groups
      .map((group) => group.startingHole)
      .filter((hole): hole is number => hole !== null);
    expect(holes).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(holes).size).toBe(5);
  });

  it("stops assigning holes once the holes run out", () => {
    const plan = generatePairingPlan({
      ...BASE,
      holesCount: 9,
      nineOption: "front",
      players: field(40),
      strategy: "sorted",
    });
    expect(plan.groups).toHaveLength(20);
    const holes = plan.groups.map((group) => group.startingHole);
    expect(holes.filter((hole) => hole === null)).toHaveLength(11);
  });

  it("leaves starting holes unset on a tee-times event", () => {
    const plan = generatePairingPlan({
      ...BASE,
      startType: "tee_times",
      players: field(8),
      strategy: "random",
    });
    expect(
      plan.groups.every((group) => group.startingHole === null),
    ).toBe(true);
  });

  it("shuffles differently across seeds", () => {
    const a = generatePairingPlan({
      ...BASE,
      players: field(12),
      strategy: "random",
      seed: 1,
    });
    const b = generatePairingPlan({
      ...BASE,
      players: field(12),
      strategy: "random",
      seed: 2,
    });
    const flat = (plan: typeof a) =>
      plan.groups.flatMap((group) => group.playerIds).join(",");
    expect(flat(a)).not.toEqual(flat(b));
  });

  it("is deterministic for one seed", () => {
    const a = generatePairingPlan({
      ...BASE,
      players: field(12),
      strategy: "random",
      seed: 7,
    });
    const b = generatePairingPlan({
      ...BASE,
      players: field(12),
      strategy: "random",
      seed: 7,
    });
    expect(a).toEqual(b);
  });

  it("balances by handicap: team i pairs the i-th lowest with the i-th highest", () => {
    const players = field(12);
    const plan = generatePairingPlan({
      ...BASE,
      players,
      strategy: "handicap_balance",
      teamSize: 2,
    });
    const handicapOf = (playerId: string) =>
      players.find((player) => player.playerId === playerId)!
        .handicapIndex ?? 0;
    const sortedHandicaps = players
      .map((player) => player.handicapIndex ?? 0)
      .sort((a, b) => a - b);
    const n = sortedHandicaps.length;
    // The snake: team 0 holds the lowest + the highest, team 1 the
    // 2nd-lowest + 2nd-highest, … so no team lands with the extremes.
    const totals = plan.groups.map((group) =>
      group.playerIds.reduce((total, id) => total + handicapOf(id), 0),
    );
    const first = plan.groups.map((group) => handicapOf(group.playerIds[0]!));
    const second = plan.groups.map((group) => handicapOf(group.playerIds[1]!));
    expect(first[0]).toBe(sortedHandicaps[0]);
    expect(second[0]).toBe(sortedHandicaps[n - 1]);
    expect(first[1]).toBe(sortedHandicaps[1]);
    expect(second[1]).toBe(sortedHandicaps[n - 2]);
    // Every team total sits inside the lowest+highest envelope.
    const envelope = sortedHandicaps[0]! + sortedHandicaps[n - 1]!;
    expect(totals.every((total) => total <= envelope + 3)).toBe(true);
  });

  it("handles a remainder without exceeding the team size", () => {
    const plan = generatePairingPlan({
      ...BASE,
      players: field(17),
      strategy: "handicap_balance",
      teamSize: 2,
    });
    const sizes = plan.groups.map((group) => group.playerIds.length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(17);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("sorts by handicap into consecutive, non-mixing teams", () => {
    const players = field(12);
    const plan = generatePairingPlan({
      ...BASE,
      players,
      strategy: "sorted",
      teamSize: 2,
    });
    const handicapOf = (playerId: string) =>
      players.find((player) => player.playerId === playerId)!
        .handicapIndex ?? 0;
    const sortedHandicaps = players
      .map((player) => player.handicapIndex ?? 0)
      .sort((a, b) => a - b);
    const flat = plan.groups.flatMap((group) =>
      group.playerIds.map((playerId) => handicapOf(playerId)),
    );
    // Consecutive bands: the flattened member order IS the field order.
    expect(flat).toEqual(sortedHandicaps);
    expect(plan.groups).toHaveLength(6);
    expect(plan.groups.every((group) => group.playerIds.length === 2)).toBe(
      true,
    );
  });
});

// ─── Moving players ────────────────────────────────────────────────────────────

describe("movePairingPlayer", () => {
  const plan = {
    groups: [
      { name: "Group 1", playerIds: ["a", "b"], startingHole: 1, cartNumber: null },
      { name: "Group 2", playerIds: ["c", "d"], startingHole: 2, cartNumber: null },
    ],
    unassigned: ["e"],
  } as const;

  it("moves a player between groups without duplicating", () => {
    const moved = movePairingPlayer(plan, "b", 1);
    expect(moved.groups[0]!.playerIds).toEqual(["a"]);
    expect(moved.groups[1]!.playerIds).toEqual(["c", "d", "b"]);
    expect(moved.unassigned).toEqual(["e"]);
  });

  it("returns a player to the unassigned pool", () => {
    const moved = movePairingPlayer(plan, "b", null);
    expect(moved.groups[0]!.playerIds).toEqual(["a"]);
    expect(moved.unassigned).toEqual(["e", "b"]);
  });

  it("ignores an unknown player instead of inventing one into a group", () => {
    const moved = movePairingPlayer(plan, "zzz", 0);
    expect(moved.groups[0]!.playerIds).toEqual(["a", "b"]);
    expect(moved.groups[1]!.playerIds).toEqual(["c", "d"]);
    expect(moved.unassigned).toEqual(["e"]);
  });

  it("drops a player back to the pool when the target group index is out of range", () => {
    const moved = movePairingPlayer(plan, "a", 99);
    expect(moved.groups[0]!.playerIds).toEqual(["b"]);
    expect(moved.unassigned).toContain("a");
  });
});

describe("normalizePairingPlan", () => {
  it("drops empty groups and renumbers the names", () => {
    const normalized = normalizePairingPlan({
      groups: [
        { name: "Group 1", playerIds: ["a"], startingHole: 1, cartNumber: null },
        { name: "Group 2", playerIds: [], startingHole: 2, cartNumber: null },
        { name: "Group 3", playerIds: ["b"], startingHole: 3, cartNumber: null },
      ],
      unassigned: [],
    });
    expect(normalized.groups.map((group) => group.name)).toEqual([
      "Group 1",
      "Group 2",
    ]);
  });
});

// ─── Plan validation ──────────────────────────────────────────────────────────

describe("validatePairingPlan", () => {
  const valid = () => ({
    groups: [
      { name: "Group 1", playerIds: ["a", "b"], startingHole: 1, cartNumber: 1 },
      { name: "Group 2", playerIds: ["c", "d"], startingHole: 2, cartNumber: 2 },
    ],
    unassigned: [],
  });

  it("accepts a sound shotgun plan", () => {
    expect(validatePairingPlan(valid(), { ...BASE, teamSize: 2 })).toEqual([]);
  });

  it("flags oversized groups against the team size", () => {
    const issues = validatePairingPlan(
      {
        groups: [
          { name: "Group 1", playerIds: ["a", "b", "c"], startingHole: 1, cartNumber: null },
        ],
        unassigned: [],
      },
      { ...BASE, teamSize: 2 },
    );
    expect(issues[0]!.message).toContain("team size of 2");
  });

  it("flags a player in two groups", () => {
    const issues = validatePairingPlan(
      {
        groups: [
          { name: "Group 1", playerIds: ["a", "b"], startingHole: 1, cartNumber: null },
          { name: "Group 2", playerIds: ["b", "c"], startingHole: 2, cartNumber: null },
        ],
        unassigned: [],
      },
      { ...BASE, teamSize: 2 },
    );
    expect(issues.some((issue) => issue.message.includes("two groups"))).toBe(
      true,
    );
  });

  it("flags duplicate starting holes on a shotgun start", () => {
    const issues = validatePairingPlan(
      {
        groups: [
          { name: "Group 1", playerIds: ["a"], startingHole: 5, cartNumber: null },
          { name: "Group 2", playerIds: ["b"], startingHole: 5, cartNumber: null },
        ],
        unassigned: [],
      },
      { ...BASE, teamSize: 2 },
    );
    expect(issues.some((issue) => issue.message.includes("starts two groups")))
      .toBe(true);
  });

  it("flags a starting hole outside the played nine", () => {
    const issues = validatePairingPlan(
      {
        groups: [
          { name: "Group 1", playerIds: ["a"], startingHole: 12, cartNumber: null },
        ],
        unassigned: [],
      },
      { ...BASE, teamSize: 2, holesCount: 9, nineOption: "front" },
    );
    expect(issues[0]!.message).toContain("played holes");
  });

  it("flags missing starting holes on a shotgun start", () => {
    const issues = validatePairingPlan(
      {
        groups: [
          { name: "Group 1", playerIds: ["a"], startingHole: null, cartNumber: null },
        ],
        unassigned: [],
      },
      { ...BASE, teamSize: 2 },
    );
    expect(issues[0]!.message).toContain("no starting hole");
  });

  it("ignores starting holes on a tee-times event", () => {
    const issues = validatePairingPlan(valid(), {
      ...BASE,
      teamSize: 2,
      startType: "tee_times",
    });
    expect(issues).toEqual([]);
  });
});

// ─── Payload contract ─────────────────────────────────────────────────────────

describe("groupsStepPayloadSchema", () => {
  const payload = () => ({
    eventId: "e1",
    teamSize: "2",
    startType: "shotgun" as const,
    holesCount: "18",
    nineOption: "front" as const,
    groups: [
      {
        name: "Group 1",
        playerIds: ["a", "b"],
        startingHole: 1,
        cartNumber: 3,
      },
    ],
    unassigned: [],
  });

  it("accepts a complete payload with coerced numbers", () => {
    const parsed = groupsStepPayloadSchema.parse(payload());
    expect(parsed.teamSize).toBe(2);
    expect(parsed.holesCount).toBe(18);
    expect(parsed.groups[0]!.startingHole).toBe(1);
  });

  it("requires an eventId", () => {
    expect(
      groupsStepPayloadSchema.safeParse({ ...payload(), eventId: "" }).success,
    ).toBe(false);
  });

  it("caps the team size at 4 per side", () => {
    expect(
      groupsStepPayloadSchema.safeParse({ ...payload(), teamSize: "5" })
        .success,
    ).toBe(false);
  });

  it("caps cart numbers at 99", () => {
    expect(
      groupsStepPayloadSchema.safeParse({
        ...payload(),
        groups: [{ ...payload().groups[0]!, cartNumber: 100 }],
      }).success,
    ).toBe(false);
  });

  it("caps starting holes at 18", () => {
    expect(
      groupsStepPayloadSchema.safeParse({
        ...payload(),
        groups: [{ ...payload().groups[0]!, startingHole: 19 }],
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown start type", () => {
    expect(
      groupsStepPayloadSchema.safeParse({ ...payload(), startType: "cannon" })
        .success,
    ).toBe(false);
  });
});
