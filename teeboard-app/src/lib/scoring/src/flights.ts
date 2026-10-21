/**
 * Flight assignment for large fields: players are divided into flights by
 * handicap thresholds (Committee-configured), with an open-top flight
 * absorbing everyone above the last threshold. All thresholds are
 * explicit inputs; nothing about a field is assumed.
 */
import type { Flight, FlightAssignment, FlightPlayer } from "./types";

/**
 * Assign players to flights by explicit handicap thresholds. A player
 * belongs to the first flight whose `maxHandicap` (inclusive) covers their
 * handicap; a player above every threshold lands in the last flight as its
 * open top (a flight with `maxHandicap: null` absorbs everyone above).
 * Within a flight, players are sorted by handicap (lowest first) with a
 * stable order by `sortId`.
 */
export function assignFlights(input: {
  players: FlightPlayer[];
  flights: Flight[];
}): FlightAssignment[] {
  const { players, flights } = input;
  if (flights.length === 0) {
    return [];
  }

  const sortedFlights = [...flights].sort((a, b) => {
    const am = a.maxHandicap ?? Number.POSITIVE_INFINITY;
    const bm = b.maxHandicap ?? Number.POSITIVE_INFINITY;
    return am - bm;
  });

  return players
    .map((player) => {
      const flight =
        sortedFlights.find((f) => {
          if (f.maxHandicap === null || f.maxHandicap === undefined) {
            return true;
          }
          return player.handicap <= f.maxHandicap;
        }) ?? sortedFlights[sortedFlights.length - 1];
      return { player, flight };
    })
    .sort((x, y) => {
      const fx = sortedFlights.indexOf(x.flight);
      const fy = sortedFlights.indexOf(y.flight);
      if (fx !== fy) {
        return fx - fy;
      }
      if (x.player.handicap !== y.player.handicap) {
        return x.player.handicap - y.player.handicap;
      }
      return x.player.sortId.localeCompare(y.player.sortId);
    })
    .map(({ player, flight }) => ({
      playerId: player.id,
      flightName: flight.name,
      flightIndex: sortedFlights.indexOf(flight),
    }));
}
