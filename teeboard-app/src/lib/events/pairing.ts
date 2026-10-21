import { z } from "zod";
import { EVENT_NINE_OPTIONS } from "./schema";

/**
 * Pure Groups & teams step logic (M4-T006): the pairing strategies, the
 * shotgun starting-hole assignment, cart numbering, and the payload shape
 * the step's server action persists. No I/O, no server imports —
 * unit-testable without mocks, identical client/server.
 *
 * Scoring math stays in @/lib/scoring; the only arithmetic here is group
 * sizing and hole/cart sequencing, none of which are WHS/USGA scoring
 * computations.
 */

// ─── Pairing strategies ──────────────────────────────────────────────────────

export const PAIRING_STRATEGIES = [
  "random",
  "handicap_balance",
  "sorted",
  "manual",
] as const;
export type PairingStrategy = (typeof PAIRING_STRATEGIES)[number];

/** A seeded 32-bit PRNG (mulberry32) so regeneration is deterministic and reproducible for a seed while still shuffling. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic Fisher–Yates shuffle driven by the seeded PRNG. */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = out[j]!;
    out[j] = out[i]!;
    out[i] = swap;
  }
  return out;
}

/** One player in the field as the pairing engine sees them. */
export type PairingPlayer = {
  readonly playerId: string;
  readonly fullName: string;
  readonly handicapIndex: number | null;
};

// ─── Shotgun hole assignment ─────────────────────────────────────────────────

/**
 * The holes available to a shotgun start: the full 1–18 for 18-hole play,
 * or the played nine (1–9 front / 10–18 back) for 9-hole play.
 */
export function shotgunHoles(
  holesCount: number,
  nineOption: "front" | "back",
): number[] {
  const holes: number[] = [];
  for (let hole = 1; hole <= holesCount; hole += 1) {
    holes.push(nineOption === "back" ? hole + 9 : hole);
  }
  return holes;
}

// ─── The pairing plan ─────────────────────────────────────────────────────────

/**
 * One planned group: its members (in position order), an optional shotgun
 * starting hole, and an optional cart number. `name` is the staff-facing
 * label ("Group 1").
 */
export type PairingGroupPlan = {
  readonly name: string;
  readonly playerIds: readonly string[];
  readonly startingHole: number | null;
  readonly cartNumber: number | null;
};

/**
 * The full step state: every attached player is either in a group or in
 * the unassigned pool. The plan is the source of truth the editor edits
 * and the server action persists.
 */
export type PairingPlan = {
  readonly groups: readonly PairingGroupPlan[];
  readonly unassigned: readonly string[];
};

export type PairingInput = {
  readonly players: readonly PairingPlayer[];
  readonly teamSize: number;
  readonly strategy: PairingStrategy;
  readonly holesCount: number;
  readonly nineOption: "front" | "back";
  readonly startType: "tee_times" | "shotgun";
  /** Regeneration seed (client state) so repeat clicks shuffle differently. */
  readonly seed?: number;
};

function sortByHandicap(players: readonly PairingPlayer[]): PairingPlayer[] {
  return [...players].sort((a, b) => {
    const ah = a.handicapIndex ?? Number.POSITIVE_INFINITY;
    const bh = b.handicapIndex ?? Number.POSITIVE_INFINITY;
    if (ah !== bh) return ah - bh;
    return a.fullName.localeCompare(b.fullName);
  });
}

/**
 * The serpentine (snake) draft: the handicap-sorted field is dealt one
 * player per team per round, with the dealing direction reversing each
 * round, so every team's field mixes strong and weak hands and each team's
 * total handicap lands near the field average — the club-standard
 * "balanced by handicap" pairing.
 */
function serpentineTeams(
  players: readonly PairingPlayer[],
  teamSize: number,
): string[][] {
  const sorted = sortByHandicap(players);
  if (sorted.length === 0) return [];

  // Count teams so each fills completely before a short remainder team:
  // teamCount = ceil(remaining / teamSize) recomputed as teams fill up.
  const teamCount = Math.max(
    1,
    Math.ceil(sorted.length / teamSize),
  );
  const teams: string[][] = Array.from({ length: teamCount }, () => []);

  // A remainder shorter than a full round is handed to the emptiest teams
  // (the front of the serpentine) so sizes differ by at most one.
  sorted.forEach((player, index) => {
    const round = Math.floor(index / teamCount);
    const slot = index % teamCount;
    const teamIndex = round % 2 === 0 ? slot : teamCount - 1 - slot;
    const team = teams[teamIndex]!;
    if (team.length < teamSize) {
      team.push(player.playerId);
    } else {
      const emptiest = teams.reduce((a, b) =>
        a.length <= b.length ? a : b,
      )!;
      if (emptiest.length < teamSize) {
        emptiest.push(player.playerId);
      }
    }
  });

  return teams.filter((team) => team.length > 0);
}

function groupMembers(
  players: readonly PairingPlayer[],
  strategy: PairingStrategy,
  teamSize: number,
  seed: number,
): string[][] {
  const safeTeamSize = Math.max(1, Math.floor(teamSize));
  if (players.length === 0) return [];

  if (strategy === "sorted") {
    const sorted = sortByHandicap(players);
    return Array.from(
      { length: Math.ceil(sorted.length / safeTeamSize) },
      (_, i) =>
        sorted
          .slice(i * safeTeamSize, (i + 1) * safeTeamSize)
          .map((player) => player.playerId),
    );
  }

  if (strategy === "handicap_balance") {
    return serpentineTeams(players, safeTeamSize);
  }

  const shuffled = shuffle(players, seededRandom(seed));
  return Array.from(
    { length: Math.ceil(shuffled.length / safeTeamSize) },
    (_, i) =>
      shuffled
        .slice(i * safeTeamSize, (i + 1) * safeTeamSize)
        .map((player) => player.playerId),
  );
}

/**
 * Generates a fresh pairing plan: groups of `teamSize` members (the last
 * group absorbs the remainder on odd counts), an unassigned pool for
 * anyone not placed (manual strategy keeps the current assignment and the
 * caller regenerates around existing groups), and shotgun starting holes
 * assigned one per group in order while holes last.
 */
export function generatePairingPlan(input: PairingInput): PairingPlan {
  const {
    players,
    teamSize,
    strategy,
    holesCount,
    nineOption,
    startType,
  } = input;
  const seed = input.seed ?? 1;

  if (players.length === 0) {
    return { groups: [], unassigned: [] };
  }

  if (strategy === "manual") {
    return {
      groups: [],
      unassigned: players.map((player) => player.playerId),
    };
  }

  const teams = groupMembers(players, strategy, teamSize, seed);

  // Shotgun starts: one hole per group while holes last; the rest start on
  // the same holes once the first wave clears them (the staff can reassign
  // by editing a group's hole).
  const holes =
    startType === "shotgun" ? shotgunHoles(holesCount, nineOption) : [];

  const groups: PairingGroupPlan[] = teams.map((playerIds, index) => ({
    name: `Group ${index + 1}`,
    playerIds,
    startingHole:
      startType === "shotgun" && index < holes.length ? holes[index]! : null,
    cartNumber: null,
  }));

  return { groups, unassigned: [] };
}

/**
 * Moves one player between groups (or back to the unassigned pool when
 * `toGroup` is null). Unknown players are ignored — a player who isn't
 * placed anywhere can never be silently invented into a group.
 */
export function movePairingPlayer(
  plan: PairingPlan,
  playerId: string,
  toGroup: number | null,
): PairingPlan {
  const known =
    plan.unassigned.includes(playerId) ||
    plan.groups.some((group) => group.playerIds.includes(playerId));
  if (!known) {
    return normalizePairingPlan(plan);
  }

  const groups = plan.groups.map((group) => ({
    ...group,
    playerIds: group.playerIds.filter((id) => id !== playerId),
  }));
  const inPool = plan.unassigned.filter((id) => id !== playerId);

  if (toGroup === null) {
    return {
      groups: groups.filter((group) => group.playerIds.length > 0),
      unassigned: [...inPool, playerId],
    };
  }

  if (toGroup >= 0 && toGroup < groups.length) {
    const target = groups[toGroup]!;
    groups[toGroup] = {
      ...target,
      playerIds: [...target.playerIds, playerId],
    };
  } else {
    // No such group — drop back to the pool rather than losing the player.
    inPool.push(playerId);
  }

  return {
    groups: groups.filter((group) => group.playerIds.length > 0),
    unassigned: inPool,
  };
}

/** Drops empty groups and renames the survivors in stable order. */
export function normalizePairingPlan(plan: PairingPlan): PairingPlan {
  const groups = plan.groups
    .filter((group) => group.playerIds.length > 0)
    .map((group, index) => ({ ...group, name: `Group ${index + 1}` }));
  return { groups, unassigned: [...plan.unassigned] };
}

// ─── Validation ───────────────────────────────────────────────────────────────

export type PairingIssue = {
  readonly message: string;
};

/**
 * Validates a plan before it can persist: no player in two groups, group
 * sizes never above the configured team size, starting holes unique, and
 * (for shotgun events) starting holes inside the played holes.
 */
export function validatePairingPlan(
  plan: PairingPlan,
  options: {
    readonly teamSize: number;
    readonly startType: "tee_times" | "shotgun";
    readonly holesCount: number;
    readonly nineOption: "front" | "back";
  },
): PairingIssue[] {
  const issues: PairingIssue[] = [];
  const seen = new Set<string>();

  for (const group of plan.groups) {
    if (group.playerIds.length > options.teamSize) {
      issues.push({
        message: `${group.name} has ${group.playerIds.length} players — more than the team size of ${options.teamSize}.`,
      });
    }
    for (const playerId of group.playerIds) {
      if (seen.has(playerId)) {
        issues.push({ message: "A player cannot be in two groups." });
      }
      seen.add(playerId);
    }
  }

  if (options.startType === "shotgun") {
    const holes = new Set(shotgunHoles(options.holesCount, options.nineOption));
    const usedHoles = new Set<number>();
    for (const group of plan.groups) {
      if (group.startingHole === null) {
        issues.push({
          message: `${group.name} has no starting hole — shotgun starts need one.`,
        });
        continue;
      }
      if (!holes.has(group.startingHole)) {
        issues.push({
          message: `Hole ${group.startingHole} isn't in the event's played holes.`,
        });
        continue;
      }
      if (usedHoles.has(group.startingHole)) {
        issues.push({
          message: `Hole ${group.startingHole} starts two groups — give each group its own hole.`,
        });
      }
      usedHoles.add(group.startingHole);
    }
  }

  return issues;
}

// ─── Payload contract ─────────────────────────────────────────────────────────

const nineOptionSchema = z.enum(EVENT_NINE_OPTIONS);

export const pairGroupPayloadSchema = z.object({
  name: z.string().trim().min(1, "Name the group.").max(80),
  playerIds: z
    .array(z.string().min(1))
    .min(1, "A group holds at least one player.")
    .max(99, "A group holds at most 99 players."),
  startingHole: z
    .union([z.number().int().min(1).max(18), z.literal(null)])
    .nullable(),
  cartNumber: z
    .union([z.number().int().min(1).max(99), z.literal(null)])
    .nullable(),
});

export const groupsStepPayloadSchema = z.object({
  eventId: z.string().min(1, "Save the event basics first."),
  teamSize: z.coerce
    .number()
    .int()
    .min(1, "Team size is at least 1 (individual play).")
    .max(4, "Team size is at most 4 per side."),
  startType: z.enum(["tee_times", "shotgun"]),
  holesCount: z.coerce
    .number()
    .int()
    .refine(
      (v): v is 9 | 18 => v === 9 || v === 18,
      "Choose 9 or 18 holes.",
    ),
  nineOption: nineOptionSchema,
  groups: z.array(pairGroupPayloadSchema).max(120, "Use at most 120 groups."),
  unassigned: z.array(z.string().min(1)).max(600),
});

export type GroupsStepPayload = z.output<typeof groupsStepPayloadSchema>;
export type PairGroupPayload = z.output<typeof pairGroupPayloadSchema>;
