import {
  catalogOverviewSchema,
  directoryPlayerSchema,
  playerDirectorySchema,
  showcaseSchema,
} from '@/contract/catalog.js';
import {
  club,
  matchInPlay,
  revealedPlayer,
} from '@/contract/contract.fixtures.js';

const KEY = 'AbCdEfGhIjKlMnOpQrStUv';

const PLAYER = {
  key: KEY,
  name: 'Oğuzhan Şimşek',
  imageUrl: null,
  terms: ['oguzhan simsek', 'simsek'],
};

describe('directoryPlayerSchema', () => {
  it('accepts a player with a key, a name and terms', () => {
    expect(directoryPlayerSchema.safeParse(PLAYER).success).toBe(true);
  });

  it.each([
    ['no terms', { terms: [] }],
    ['an empty term', { terms: [''] }],
    ['an empty name', { name: '' }],
    ['a short key', { key: 'abc' }],
    ['a bare image key', { imageUrl: 'players/x.webp' }],
  ])('rejects %s', (_, change) => {
    expect(
      directoryPlayerSchema.safeParse({ ...PLAYER, ...change }).success,
    ).toBe(false);
  });

  it('drops any field outside the four', () => {
    const parsed = playerDirectorySchema.parse({
      players: [{ ...PLAYER, id: 'p-1', slug: 'x' }],
    });
    expect(Object.keys(parsed.players[0] ?? {}).sort()).toEqual([
      'imageUrl',
      'key',
      'name',
      'terms',
    ]);
  });
});

const XI = Array.from({ length: 11 }, (_, slot) => ({
  ...revealedPlayer,
  id: `p-${slot}`,
  slot,
}));

const SHOWCASE = {
  match: matchInPlay,
  players: XI,
  demo: {
    reveals: [8, 10, 9, 6, 5],
    miss: { name: 'Away Star', imageUrl: null, directoryKey: KEY },
  },
};

const OVERVIEW = {
  counts: { matches: 2, players: 40, clubs: 3, nationalTeams: 0, seasons: 2 },
  era: { from: 2004, to: 2017 },
  highlights: { finals: 1, shootouts: 0, extraTime: 1, goals: 7 },
  competitions: [matchInPlay.competition],
  topClubs: [club('mil'), club('liv')],
  showcase: SHOWCASE,
};

describe('showcaseSchema', () => {
  it('accepts a whole XI with its reveals and miss', () => {
    expect(showcaseSchema.safeParse(SHOWCASE).success).toBe(true);
  });

  it('accepts a demo with no miss', () => {
    const demo = { ...SHOWCASE.demo, miss: null };
    expect(showcaseSchema.safeParse({ ...SHOWCASE, demo }).success).toBe(true);
  });

  it.each([
    ['10 players', { players: XI.slice(1) }],
    ['a repeated slot', { players: [...XI.slice(0, 10), XI[0]] }],
    ['no reveals', { demo: { ...SHOWCASE.demo, reveals: [] } }],
    ['a repeated reveal', { demo: { ...SHOWCASE.demo, reveals: [8, 8] } }],
    ['a reveal past the XI', { demo: { ...SHOWCASE.demo, reveals: [11] } }],
    [
      'a miss without a key',
      { demo: { ...SHOWCASE.demo, miss: { name: 'X', imageUrl: null } } },
    ],
  ])('rejects %s', (_, change) => {
    expect(showcaseSchema.safeParse({ ...SHOWCASE, ...change }).success).toBe(
      false,
    );
  });
});

describe('catalogOverviewSchema', () => {
  it('accepts an overview with or without a showcase', () => {
    expect(catalogOverviewSchema.safeParse(OVERVIEW).success).toBe(true);
    expect(
      catalogOverviewSchema.safeParse({ ...OVERVIEW, showcase: null }).success,
    ).toBe(true);
  });

  it('takes 12 top clubs and refuses 13', () => {
    const clubs = (n: number) =>
      Array.from({ length: n }, (_, i) => club(`c${i}`));
    expect(
      catalogOverviewSchema.safeParse({ ...OVERVIEW, topClubs: clubs(12) })
        .success,
    ).toBe(true);
    expect(
      catalogOverviewSchema.safeParse({ ...OVERVIEW, topClubs: clubs(13) })
        .success,
    ).toBe(false);
  });

  it.each([
    ['a negative count', { counts: { ...OVERVIEW.counts, players: -1 } }],
    [
      'a fractional goal total',
      { highlights: { ...OVERVIEW.highlights, goals: 1.5 } },
    ],
  ])('rejects %s', (_, change) => {
    expect(
      catalogOverviewSchema.safeParse({ ...OVERVIEW, ...change }).success,
    ).toBe(false);
  });

  it('strips a field outside the contract', () => {
    const parsed = catalogOverviewSchema.parse({ ...OVERVIEW, score: 99 });
    expect(parsed).not.toHaveProperty('score');
  });
});
