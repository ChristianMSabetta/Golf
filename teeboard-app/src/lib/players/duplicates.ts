import type { DuplicateGroup, PlayerRow } from "./schema";

/**
 * Duplicate detection for the club player list (M4-T002): players sharing
 * the same trimmed name AND non-blank email are grouped for one-click
 * merging. Pure — the server module calls it over the aggregated rows.
 */

export function groupDuplicates(
  players: readonly PlayerRow[],
): readonly DuplicateGroup[] {
  const groups = new Map<
    string,
    {
      key: string;
      fullName: string;
      email: string;
      players: PlayerRow[];
    }
  >();

  for (const player of players) {
    if (player.email === null) continue;
    const name = player.fullName.trim().toLowerCase();
    const email = player.email.trim().toLowerCase();
    if (name === "" || email === "") continue;

    const key = `${name}|${email}`;
    const group = groups.get(key) ?? {
      key,
      fullName: player.fullName,
      email: player.email,
      players: [],
    };
    group.players.push(player);
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter((group) => group.players.length > 1)
    .map((group) => Object.freeze({ ...group, players: Object.freeze(group.players) }));
}

/**
 * The keeper for a merge: the row with the most event entries (ties break
 * on earliest created history — stable by input order).
 */
export function pickMergeKeeper(
  group: DuplicateGroup,
): PlayerRow {
  return [...group.players].sort((a, b) => {
    if (b.eventCount !== a.eventCount) return b.eventCount - a.eventCount;
    return a.id < b.id ? -1 : 1;
  })[0]!;
}
