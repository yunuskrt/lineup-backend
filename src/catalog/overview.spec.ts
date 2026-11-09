import {
  type OverviewRow,
  overviewFigures,
  poolCompetitions,
  topClubs,
} from '@/catalog/overview.js';

type Side = {
  id: string;
  goals?: number;
  kind?: 'club' | 'national_team';
  name?: string;
};

const competition = (id: string, name = id) => ({
  id,
  kind: 'league' as const,
  name,
  logoKey: null,
});

function match(
  sides: [Side, Side],
  extra: Partial<Omit<OverviewRow, 'teams'>> = {},
): OverviewRow {
  return {
    stage: null,
    extraTime: false,
    shootoutHome: null,
    season: { startYear: 2010, competition: competition('comp-1') },
    teams: sides.map(({ id, goals = 0, kind = 'club', name = id }) => ({
      goals,
      club: { id, kind, name, shortName: 'CLB', crestKey: null },
    })),
    ...extra,
  };
}

describe('overviewFigures', () => {
  it('gives zeros for no rows', () => {
    expect(overviewFigures([])).toEqual({
      counts: { matches: 0, clubs: 0, nationalTeams: 0, seasons: 0 },
      highlights: { finals: 0, shootouts: 0, extraTime: 0, goals: 0 },
    });
  });

  it('counts each side once and splits clubs from national teams', () => {
    const { counts } = overviewFigures([
      match([{ id: 'a' }, { id: 'b' }]),
      match([{ id: 'b' }, { id: 'c' }]),
      match([
        { id: 'tr', kind: 'national_team' },
        { id: 'br', kind: 'national_team' },
      ]),
    ]);
    expect(counts).toEqual({
      matches: 3,
      clubs: 3,
      nationalTeams: 2,
      seasons: 1,
    });
  });

  it('counts distinct season starts', () => {
    const season = (startYear: number) => ({
      season: { startYear, competition: competition('comp-1') },
    });
    const { counts } = overviewFigures([
      match([{ id: 'a' }, { id: 'b' }], season(2004)),
      match([{ id: 'a' }, { id: 'b' }], season(2004)),
      match([{ id: 'a' }, { id: 'b' }], season(2017)),
    ]);
    expect(counts.seasons).toBe(2);
  });

  it('adds up finals, shootouts, extra time and goals', () => {
    const { highlights } = overviewFigures([
      match(
        [
          { id: 'a', goals: 3 },
          { id: 'b', goals: 3 },
        ],
        {
          stage: 'Final',
          extraTime: true,
          shootoutHome: 3,
        },
      ),
      match(
        [
          { id: 'a', goals: 1 },
          { id: 'b', goals: 0 },
        ],
        {
          stage: 'Semi-final',
          extraTime: true,
        },
      ),
      match(
        [
          { id: 'a', goals: 2 },
          { id: 'b', goals: 2 },
        ],
        {
          stage: 'Quarter-final',
          shootoutHome: 0,
        },
      ),
    ]);
    expect(highlights).toEqual({
      finals: 1,
      shootouts: 2,
      extraTime: 2,
      goals: 11,
    });
  });
});

describe('topClubs', () => {
  it('orders clubs by matches, then by name, national teams left out', () => {
    const rows = [
      match([
        { id: 'z', name: 'Zeta' },
        { id: 'y', name: 'Ypsilon' },
      ]),
      match([
        { id: 'z', name: 'Zeta' },
        { id: 'a', name: 'Alpha' },
      ]),
      match([
        { id: 'tr', kind: 'national_team' },
        { id: 'br', kind: 'national_team' },
      ]),
      match([
        { id: 'tr', kind: 'national_team' },
        { id: 'de', kind: 'national_team' },
      ]),
    ];
    expect(topClubs(rows).map((club) => club.id)).toEqual(['z', 'a', 'y']);
  });

  it('breaks a name tie by id', () => {
    const rows = [
      match([
        { id: 'c2', name: 'United' },
        { id: 'c1', name: 'United' },
      ]),
    ];
    expect(topClubs(rows).map((club) => club.id)).toEqual(['c1', 'c2']);
  });

  it('keeps at most 12', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      match([
        { id: `h${i}`, name: `Home ${i}` },
        { id: `a${i}`, name: `Away ${i}` },
      ]),
    );
    expect(topClubs(rows)).toHaveLength(12);
  });
});

describe('poolCompetitions', () => {
  it('lists each competition once, by name', () => {
    const season = (id: string, name: string) => ({
      season: { startYear: 2010, competition: competition(id, name) },
    });
    const rows = [
      match([{ id: 'a' }, { id: 'b' }], season('c2', 'Zenith Cup')),
      match([{ id: 'a' }, { id: 'b' }], season('c1', 'Ankara League')),
      match([{ id: 'a' }, { id: 'b' }], season('c2', 'Zenith Cup')),
    ];
    expect(poolCompetitions(rows).map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});
