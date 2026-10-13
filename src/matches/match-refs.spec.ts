import {
  clubRefSchema,
  matchIdentitySchema,
  matchInPlaySchema,
} from '@/contract/match.js';
import {
  toClubRef,
  toMatchIdentity,
  toMatchInPlay,
} from '@/matches/match-refs.js';

const CLUB = {
  id: '01900000-0000-7000-8000-000000000001',
  slug: 'yildiz',
  kind: 'club' as const,
  name: 'Yıldız SK',
  shortName: 'YLD',
  crestKey: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('toClubRef', () => {
  it('maps a club to a contract ClubRef', () => {
    const ref = toClubRef(CLUB);

    expect(ref).toEqual({
      id: CLUB.id,
      name: 'Yıldız SK',
      shortName: 'YLD',
      crestUrl: null,
    });
    expect(clubRefSchema.parse(ref)).toEqual(ref);
  });

  it('never sends a bucket key as a URL', () => {
    expect(toClubRef({ ...CLUB, crestKey: 'crests/yildiz.svg' }).crestUrl).toBe(
      null,
    );
  });
});

describe('toMatchIdentity', () => {
  const club = (id: string, name: string, shortName: string) => ({
    id,
    name,
    shortName,
  });
  const MATCH = {
    id: '01900000-0000-7000-8000-0000000000e1',
    date: new Date('2005-05-25T00:00:00.000Z'),
    stage: 'Final',
    nickname: null,
    season: {
      label: '2004-05',
      competition: { id: 'comp-1', kind: 'ucl' as const, name: 'Cup' },
    },
    // Away listed first: sides come from `side`
    teams: [
      { side: 'away' as const, goals: 3, club: club('c-away', 'Away', 'AWY') },
      { side: 'home' as const, goals: 1, club: club('c-home', 'Home', 'HOM') },
    ],
  };

  it('maps a match, sides and scores the right way round', () => {
    const identity = toMatchIdentity(MATCH);

    expect(identity).toEqual({
      id: MATCH.id,
      competition: { id: 'comp-1', kind: 'ucl', name: 'Cup' },
      season: '2004-05',
      date: '2005-05-25',
      stage: 'Final',
      home: { id: 'c-home', name: 'Home', shortName: 'HOM', crestUrl: null },
      away: { id: 'c-away', name: 'Away', shortName: 'AWY', crestUrl: null },
      score: { home: 1, away: 3 },
      nickname: null,
    });
    expect(matchIdentitySchema.parse(identity)).toEqual(identity);
  });

  it('keeps a nickname and a null stage', () => {
    const identity = toMatchIdentity({
      ...MATCH,
      stage: null,
      nickname: 'The Rain Final',
    });

    expect(identity).toMatchObject({ stage: null, nickname: 'The Rain Final' });
  });

  it('refuses a match missing a side', () => {
    expect(() =>
      toMatchIdentity({ ...MATCH, teams: MATCH.teams.slice(0, 1) }),
    ).toThrow(/lacks a side/);
  });

  it('adds the side and formation for play', () => {
    const inPlay = toMatchInPlay(toMatchIdentity(MATCH), 'away', '4-2-3-1');

    expect(inPlay).toMatchObject({ side: 'away', formation: '4-2-3-1' });
    expect(matchInPlaySchema.parse(inPlay)).toEqual(inPlay);
  });
});
