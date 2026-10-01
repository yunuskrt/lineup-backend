import { matchInPlay } from '@/contract/contract.fixtures.js';
import {
  eraRangeSchema,
  filtersSchema,
  formationSchema,
  matchIdentitySchema,
  matchInPlaySchema,
} from '@/contract/match.js';

describe('formationSchema', () => {
  it.each(['4-4-2', '4-2-3-1', '4-1-2-1-2', '3-5-2'])('accepts %s', (f) => {
    expect(formationSchema.safeParse(f).success).toBe(true);
  });

  it.each([
    ['two lines', '6-4'],
    ['six lines', '2-2-2-2-1-1'],
    ['nine outfield', '4-4-1'],
    ['eleven outfield', '4-4-3'],
    ['an empty line', '4-0-6'],
    ['a double digit', '10-0-0'],
    ['spaces', '4 - 4 - 2'],
  ])('rejects %s', (_, f) => {
    expect(formationSchema.safeParse(f).success).toBe(false);
  });
});

describe('matchIdentitySchema', () => {
  it.each(['2004-05', '2006'])('accepts season %s', (season) => {
    expect(
      matchIdentitySchema.safeParse({ ...matchInPlay, season }).success,
    ).toBe(true);
  });

  it.each(['2004/05', '04-05', '2004-2005'])('rejects season %s', (season) => {
    expect(
      matchIdentitySchema.safeParse({ ...matchInPlay, season }).success,
    ).toBe(false);
  });

  it('rejects a datetime where a date belongs', () => {
    const match = { ...matchInPlay, date: '2005-05-25T20:45:00Z' };
    expect(matchIdentitySchema.safeParse(match).success).toBe(false);
  });

  it('requires nullable fields to be present', () => {
    const { nickname: _, ...withoutNickname } = matchInPlay;
    expect(matchIdentitySchema.safeParse(withoutNickname).success).toBe(false);
    expect(
      matchIdentitySchema.safeParse({ ...matchInPlay, nickname: null }).success,
    ).toBe(true);
  });

  it('rejects a negative score', () => {
    const match = { ...matchInPlay, score: { home: -1, away: 0 } };
    expect(matchIdentitySchema.safeParse(match).success).toBe(false);
  });
});

describe('matchInPlaySchema', () => {
  it('accepts the full match with side and formation', () => {
    expect(matchInPlaySchema.parse(matchInPlay)).toEqual(matchInPlay);
  });

  it('strips any squad a caller tries to attach', () => {
    const leaky = {
      ...matchInPlay,
      squad: [{ id: 'p-9', name: 'Hidden Starter' }],
      lineup: ['p-9'],
    };
    const parsed = matchInPlaySchema.parse(leaky);
    expect(parsed).not.toHaveProperty('squad');
    expect(parsed).not.toHaveProperty('lineup');
  });
});

describe('eraRangeSchema and filtersSchema', () => {
  it('accepts a single season and the full range', () => {
    expect(eraRangeSchema.safeParse({ from: 2010, to: 2010 }).success).toBe(
      true,
    );
    expect(eraRangeSchema.safeParse({ from: 2000, to: 2025 }).success).toBe(
      true,
    );
  });

  it.each([
    ['reversed', { from: 2012, to: 2010 }],
    ['before 2000', { from: 1999, to: 2005 }],
    ['after 2025', { from: 2020, to: 2026 }],
  ])('rejects a %s era', (_, era) => {
    expect(eraRangeSchema.safeParse(era).success).toBe(false);
  });

  it('treats empty id lists as "all"', () => {
    const filters = {
      competitionIds: [],
      clubIds: [],
      era: { from: 2000, to: 2025 },
    };
    expect(filtersSchema.safeParse(filters).success).toBe(true);
  });

  it('rejects an empty id inside a list', () => {
    const filters = {
      competitionIds: [''],
      clubIds: [],
      era: { from: 2000, to: 2025 },
    };
    expect(filtersSchema.safeParse(filters).success).toBe(false);
  });
});
