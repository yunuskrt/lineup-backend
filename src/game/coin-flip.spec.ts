import type { Filters } from '@/contract/match.js';
import { firstSeat, flipFilters, NO_PREFERENCE } from '@/game/coin-flip.js';

const ONE_CLUB: Filters = {
  competitionIds: ['c-ucl'],
  clubIds: ['mil'],
  era: { from: 2004, to: 2006 },
};

describe('flipFilters', () => {
  it('hands seat 0 the win on a low draw', () => {
    expect(flipFilters([ONE_CLUB, NO_PREFERENCE], () => 0.49)).toEqual({
      winner: 0,
      filters: ONE_CLUB,
    });
  });

  it('hands seat 1 the win on a high draw', () => {
    expect(flipFilters([ONE_CLUB, NO_PREFERENCE], () => 0.5)).toEqual({
      winner: 1,
      filters: NO_PREFERENCE,
    });
  });

  it('applies the winning set whole, never merged', () => {
    const { filters } = flipFilters([NO_PREFERENCE, ONE_CLUB], () => 0.9);
    expect(filters).toBe(ONE_CLUB);
  });

  it('draws once per flip', () => {
    const random = vi.fn(() => 0.2);
    flipFilters([ONE_CLUB, ONE_CLUB], random);
    expect(random).toHaveBeenCalledTimes(1);
  });
});

describe('firstSeat', () => {
  it('lets the flip loser name first', () => {
    expect(firstSeat(0)).toBe(1);
    expect(firstSeat(1)).toBe(0);
  });
});

describe('NO_PREFERENCE', () => {
  it('covers every competition, club and season', () => {
    expect(NO_PREFERENCE).toEqual({
      competitionIds: [],
      clubIds: [],
      era: { from: 2000, to: 2025 },
    });
  });
});
