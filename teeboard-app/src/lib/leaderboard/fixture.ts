/**
 * The committed static fixture of the seeded event for the Phase 2
 * integration proof (M3-T004). The proof leaderboard consumes this file —
 * and nothing else: no Supabase client, no Realtime channel, no polling.
 *
 * The scores, pars, stroke indices, and tee ratings are seed data; every
 * handicap value and standing is computed through @teeboard/scoring at
 * render time.
 */
import type { Course, FormatPlayer } from "@/lib/scoring";

/** The seeded championship course (par 72, 18 holes, four tees). */
export const SEEDED_COURSE: Course = {
  holes: 18,
  par: 72,
  holeList: [
    { holeNumber: 1, par: 4, strokeIndex: 7 },
    { holeNumber: 2, par: 5, strokeIndex: 3 },
    { holeNumber: 3, par: 4, strokeIndex: 11 },
    { holeNumber: 4, par: 3, strokeIndex: 13 },
    { holeNumber: 5, par: 4, strokeIndex: 1 },
    { holeNumber: 6, par: 4, strokeIndex: 17 },
    { holeNumber: 7, par: 3, strokeIndex: 15 },
    { holeNumber: 8, par: 5, strokeIndex: 5 },
    { holeNumber: 9, par: 4, strokeIndex: 9 },
    { holeNumber: 10, par: 4, strokeIndex: 8 },
    { holeNumber: 11, par: 3, strokeIndex: 16 },
    { holeNumber: 12, par: 5, strokeIndex: 2 },
    { holeNumber: 13, par: 4, strokeIndex: 14 },
    { holeNumber: 14, par: 4, strokeIndex: 10 },
    { holeNumber: 15, par: 3, strokeIndex: 18 },
    { holeNumber: 16, par: 4, strokeIndex: 6 },
    { holeNumber: 17, par: 5, strokeIndex: 12 },
    { holeNumber: 18, par: 4, strokeIndex: 4 },
  ],
  tees: {
    white: { courseRating: 71.2, slopeRating: 128 },
    blue: { courseRating: 73.5, slopeRating: 140 },
    red: { courseRating: 68.4, slopeRating: 118 },
    gold: { courseRating: 69.5, slopeRating: 113 },
  },
};

/** The tee the seeded event plays: the white championship tees. */
export const SEEDED_TEE_NAME = "white";

/** Display name of the seeded event. */
export const SEEDED_EVENT_NAME = "Founders Cup Invitational";

/** A seeded player of the event. */
export interface SeededPlayer extends FormatPlayer {
  /** Display name of the player. */
  name: string;
  /** 1-based starting hole (shotgun start: 1, 4, 7, or 10). */
  startHole: number;
  /** Group label the player starts with. */
  groupLabel: string;
}

/**
 * The seeded field. Handicap indices span scratch to a 20.8 — including a
 * plus (better-than-scratch) player — so the fixture exercises the full
 * WHS range the package handles.
 */
export const SEEDED_PLAYERS: SeededPlayer[] = [
  {
    id: "p1",
    name: "Marta Sullivan",
    handicapIndex: 12.4,
    startHole: 1,
    groupLabel: "Group A",
    scores: {
      1: 5, 2: 6, 3: 5, 4: 3, 5: 4, 6: 4, 7: 3, 8: 5, 9: 4,
      10: 4, 11: 3, 12: 5, 13: 4, 14: 4, 15: 3, 16: 4, 17: 5, 18: 4,
    },
  },
  {
    id: "p2",
    name: "Devon Clarke",
    handicapIndex: 8.2,
    startHole: 1,
    groupLabel: "Group A",
    scores: {
      1: 4, 2: 6, 3: 4, 4: 4, 5: 5, 6: 4, 7: 4, 8: 6, 9: 4,
      10: 5, 11: 3, 12: 6, 13: 5, 14: 4, 15: 4, 16: 4, 17: 6, 18: 5,
    },
  },
  {
    id: "p3",
    name: "Rafael Ibarra",
    handicapIndex: 20.8,
    startHole: 4,
    groupLabel: "Group B",
    scores: {
      1: 5, 2: 8, 3: 6, 4: 4, 5: 6, 6: 5, 7: 4, 8: 7, 9: 5,
      10: 6, 11: 4, 12: 8, 13: 6, 14: 6, 15: 4, 16: 6, 17: 8, 18: 6,
    },
  },
  {
    id: "p4",
    name: "Elena Whitfield",
    handicapIndex: 15.6,
    startHole: 4,
    groupLabel: "Group B",
    scores: {
      1: 5, 2: 7, 3: 5, 4: 4, 5: 5, 6: 5, 7: 4, 8: 7, 9: 5,
      10: 5, 11: 4, 12: 7, 13: 5, 14: 5, 15: 4, 16: 5, 17: 7, 18: 5,
    },
  },
  {
    id: "p5",
    name: "Theo Nakamura",
    handicapIndex: -1.4,
    startHole: 7,
    groupLabel: "Group C",
    scores: {
      1: 4, 2: 4, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 4, 9: 3,
      10: 3, 11: 2, 12: 4, 13: 3, 14: 3, 15: 2, 16: 3, 17: 4, 18: 3,
    },
  },
  {
    id: "p6",
    name: "Priya Raghavan",
    handicapIndex: 10.9,
    startHole: 7,
    groupLabel: "Group C",
    scores: {
      1: 4, 2: 6, 3: 4, 4: 3, 5: 4, 6: 4, 7: 4, 8: 5, 9: 4,
      10: 5, 11: 3, 12: 6, 13: 5, 14: 6, 15: 4, 16: 4, 17: 7, 18: 4,
    },
  },
  {
    id: "p7",
    name: "Cole Bergstrom",
    handicapIndex: 4.7,
    startHole: 10,
    groupLabel: "Group D",
    scores: {
      1: 4, 2: 5, 3: 4, 4: 3, 5: 4, 6: 4, 7: 3, 8: 5, 9: 4,
      10: 4, 11: 3, 12: 6, 13: 4, 14: 4, 15: 3, 16: 4, 17: 6, 18: 4,
    },
  },
  {
    id: "p8",
    name: "Ada Kowalczyk",
    handicapIndex: 18.3,
    startHole: 10,
    groupLabel: "Group D",
    scores: {
      1: 5, 2: 7, 3: 5, 4: 4, 5: 5, 6: 5, 7: 4, 8: 6, 9: 5,
      10: 5, 11: 4, 12: 6, 13: 6, 14: 5, 15: 4, 16: 5, 17: 7, 18: 5,
    },
  },
  {
    id: "p9",
    name: "Jonah Ferreira",
    handicapIndex: 6.1,
    startHole: 13,
    groupLabel: "Group E",
    scores: {
      1: 4, 2: 5, 3: 4, 4: 3, 5: 4, 6: 4, 7: 3, 8: 5, 9: 4,
      10: 4, 11: 3, 12: 5, 13: 4, 14: 4, 15: 3, 16: 4, 17: 5, 18: 4,
    },
  },
];

/** The groups of the seeded event, in start order. */
export const SEEDED_GROUPS: {
  label: string;
  startHole: number;
  playerIds: string[];
}[] = [
  { label: "Group A", startHole: 1, playerIds: ["p1", "p2"] },
  { label: "Group B", startHole: 4, playerIds: ["p3", "p4"] },
  { label: "Group C", startHole: 7, playerIds: ["p5", "p6"] },
  { label: "Group D", startHole: 10, playerIds: ["p7", "p8"] },
  { label: "Group E", startHole: 13, playerIds: ["p9"] },
];

/**
 * The fixture as the proof page consumes it: everything the standings
 * computation needs in one frozen value.
 */
export const SEEDED_EVENT = {
  name: SEEDED_EVENT_NAME,
  course: SEEDED_COURSE,
  teeName: SEEDED_TEE_NAME,
  tee: SEEDED_COURSE.tees[SEEDED_TEE_NAME],
  players: SEEDED_PLAYERS,
  groups: SEEDED_GROUPS,
} as const;

/**
 * The simulated score update the proof applies in memory: player p2
 * (Devon Clarke) posts 3 on hole 18 instead of 5 — a closing birdie that
 * recomputes the whole standings table and proves the movement arrows.
 */
export const SIMULATED_UPDATE: { playerId: string; holeNumber: number; strokes: number } = {
  playerId: "p2",
  holeNumber: 18,
  strokes: 3,
};

/** Pure data transform: apply a score update to a copy of the fixture. */
export function applySimulatedUpdate(
  players: readonly SeededPlayer[],
  update: { playerId: string; holeNumber: number; strokes: number },
): SeededPlayer[] {
  return players.map((player) =>
    player.id === update.playerId
      ? {
          ...player,
          scores: {
            ...player.scores,
            [update.holeNumber]: update.strokes,
          },
        }
      : player,
  );
}

/** The seeded fixture with the simulated update already applied. */
export const UPDATED_PLAYERS: SeededPlayer[] = applySimulatedUpdate(
  SEEDED_PLAYERS,
  SIMULATED_UPDATE,
);
