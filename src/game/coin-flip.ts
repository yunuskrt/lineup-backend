import { FIRST_SEASON_START, LAST_SEASON_START } from '@/contract/constants.js';
import type { Filters } from '@/contract/match.js';
import type { Seat } from '@/game/engine.js';

export type Random = () => number;

export type CoinFlip = { readonly winner: Seat; readonly filters: Filters };

// Stands in for a set never submitted
export const NO_PREFERENCE: Filters = {
  competitionIds: [],
  clubIds: [],
  era: { from: FIRST_SEASON_START, to: LAST_SEASON_START },
};

// One set applied whole, never merged (HC 19)
export function flipFilters(
  sets: readonly [Filters, Filters],
  random: Random,
): CoinFlip {
  const winner: Seat = random() < 0.5 ? 0 : 1;
  return { winner, filters: sets[winner] };
}

// The loser names first: no seat gets both
export function firstSeat(winner: Seat): Seat {
  return winner === 0 ? 1 : 0;
}
