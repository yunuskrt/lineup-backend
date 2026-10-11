import { randomUUID } from 'node:crypto';
import type { Env } from '@/config/env.schema.js';
import type { Filters } from '@/contract/match.js';
import type { CompetitionKind } from '@/generated/prisma/client.js';
import { MatchSelectorService } from '@/matches/match-selector.service.js';
import type { PrismaService } from '@/prisma/prisma.service.js';
import { type Tx, useRolledBackDb } from '@test/schema/schema-test-utils.js';

const SLUG = 'test-selector';

type Spec = {
  name: string;
  comp: 'league' | 'ucl' | 'uel';
  clubs: ['a' | 'b' | 'c' | 'd', 'a' | 'b' | 'c' | 'd'];
  score?: number;
  awayStarters?: number;
  homeFormation?: string | null;
};

// Thresholds: league and uel 60, ucl 45
const MATCHES: Spec[] = [
  { name: 'league-hi', comp: 'league', clubs: ['a', 'b'], score: 60 },
  { name: 'league-lo', comp: 'league', clubs: ['a', 'b'], score: 59.9 },
  { name: 'ucl-mid', comp: 'ucl', clubs: ['c', 'd'], score: 45 },
  { name: 'uel-mid', comp: 'uel', clubs: ['c', 'd'], score: 50 },
  { name: 'unscored', comp: 'league', clubs: ['b', 'c'] },
  {
    name: 'short-xi',
    comp: 'league',
    clubs: ['a', 'd'],
    score: 90,
    awayStarters: 10,
  },
  {
    name: 'no-formation',
    comp: 'league',
    clubs: ['a', 'd'],
    score: 90,
    homeFormation: null,
  },
];

const SEASONS = {
  league: { label: '2004-05', startYear: 2004, date: '2005-01-15' },
  ucl: { label: '2010-11', startYear: 2010, date: '2011-05-28' },
  uel: { label: '2020-21', startYear: 2020, date: '2021-05-26' },
} as const;

type Pool = {
  comps: Record<Spec['comp'], string>;
  clubs: Record<Spec['clubs'][number], string>;
  matches: Record<string, string>;
};

async function buildPool(tx: Tx): Promise<Pool> {
  const comps = {} as Pool['comps'];
  const seasons = {} as Record<Spec['comp'], string>;
  for (const kind of ['league', 'ucl', 'uel'] as const) {
    const competition = await tx.competition.create({
      data: {
        slug: `${SLUG}-${kind}`,
        kind: kind as CompetitionKind,
        name: `Selector ${kind}`,
      },
    });
    comps[kind] = competition.id;
    const { label, startYear } = SEASONS[kind];
    const season = await tx.season.create({
      data: { competitionId: competition.id, label, startYear },
    });
    seasons[kind] = season.id;
  }

  const clubs = {} as Pool['clubs'];
  for (const key of ['a', 'b', 'c', 'd'] as const) {
    const club = await tx.club.create({
      data: {
        slug: `${SLUG}-${key}`,
        kind: 'club',
        name: `Selector ${key}`,
        shortName: key.toUpperCase().repeat(3),
      },
    });
    clubs[key] = club.id;
  }

  await tx.player.createMany({
    data: Array.from({ length: 22 }, (_, i) => ({
      slug: `${SLUG}-p${i}`,
      name: `Selector Player ${i}`,
    })),
  });
  const players = await tx.player.findMany({
    where: { slug: { startsWith: `${SLUG}-p` } },
    orderBy: { slug: 'asc' },
    select: { id: true },
  });

  const matches: Record<string, string> = {};
  for (const spec of MATCHES) {
    matches[spec.name] = await addMatch(tx, spec, {
      seasonId: seasons[spec.comp],
      home: clubs[spec.clubs[0]],
      away: clubs[spec.clubs[1]],
      playerIds: players.map((p) => p.id),
    });
  }
  return { comps, clubs, matches };
}

async function addMatch(
  tx: Tx,
  spec: Spec,
  refs: { seasonId: string; home: string; away: string; playerIds: string[] },
): Promise<string> {
  const match = await tx.match.create({
    data: {
      slug: `${SLUG}-${spec.name}`,
      seasonId: refs.seasonId,
      date: new Date(SEASONS[spec.comp].date),
      teams: {
        create: [
          {
            side: 'home',
            clubId: refs.home,
            goals: 1,
            formation:
              spec.homeFormation === undefined ? '4-4-2' : spec.homeFormation,
          },
          { side: 'away', clubId: refs.away, goals: 0, formation: '4-4-2' },
        ],
      },
      ...(spec.score !== undefined && {
        memorability: {
          create: {
            score: spec.score,
            signals: {},
            algorithmVersion: 'test',
            computedAt: new Date(),
          },
        },
      }),
    },
    include: { teams: true },
  });

  const starters = { home: 11, away: spec.awayStarters ?? 11 };
  await tx.lineup.createMany({
    data: match.teams.flatMap((team) =>
      Array.from({ length: starters[team.side] }, (_, slot) => ({
        matchTeamId: team.id,
        playerId: refs.playerIds[(team.side === 'home' ? 0 : 11) + slot],
        slot,
        position: slot === 0 ? ('GK' as const) : ('DF' as const),
      })),
    ),
  });
  return match.id;
}

const selector = (tx: Tx, includeUnscored: boolean) =>
  new MatchSelectorService(
    tx as unknown as PrismaService,
    {
      MATCH_POOL_INCLUDE_UNSCORED: includeUnscored,
    } as Env,
  );

const ALL_ERAS = { from: 2000, to: 2025 };

describe('MatchSelectorService (e2e)', () => {
  const { rolledBack } = useRolledBackDb();

  // Ours only: the dev branch holds the seed too
  async function poolOf(includeUnscored: boolean): Promise<string[]> {
    return rolledBack(async (tx) => {
      const pool = await buildPool(tx);
      const ids = new Map(
        Object.entries(pool.matches).map(([name, id]) => [id, name]),
      );
      const candidates = await selector(tx, includeUnscored).candidates();
      return candidates.flatMap((c) => ids.get(c.matchId) ?? []).sort();
    });
  }

  it('admits scored matches at or above their threshold', async () => {
    // uel-mid is 50: uel keeps the league threshold
    await expect(poolOf(false)).resolves.toEqual(['league-hi', 'ucl-mid']);
  });

  it('admits an unscored match only with the flag on', async () => {
    await expect(poolOf(true)).resolves.toEqual([
      'league-hi',
      'ucl-mid',
      'unscored',
    ]);
  });

  it('narrows the pick by each filter', async () => {
    const picks = await rolledBack(async (tx) => {
      const pool = await buildPool(tx);
      const service = selector(tx, false);
      const ours = Object.values(pool.comps);
      const run = (filters: Filters) => service.select(filters);
      return {
        byComp: await run({
          competitionIds: [pool.comps.ucl],
          clubIds: [],
          era: ALL_ERAS,
        }),
        byClub: await run({
          competitionIds: ours,
          clubIds: [pool.clubs.a],
          era: ALL_ERAS,
        }),
        byEra: await run({
          competitionIds: ours,
          clubIds: [],
          era: { from: 2010, to: 2010 },
        }),
        expected: pool.matches,
      };
    });
    expect(picks.byComp).toEqual({ matchId: picks.expected['ucl-mid'] });
    expect(picks.byClub).toEqual({ matchId: picks.expected['league-hi'] });
    expect(picks.byEra).toEqual({ matchId: picks.expected['ucl-mid'] });
  });

  it('reaches every emptyBecause value', async () => {
    const reasons = await rolledBack(async (tx) => {
      const pool = await buildPool(tx);
      const service = selector(tx, false);
      const cases: Record<string, Filters> = {
        competition: {
          competitionIds: [pool.comps.uel],
          clubIds: [pool.clubs.c],
          era: ALL_ERAS,
        },
        club: {
          competitionIds: [pool.comps.league],
          clubIds: [randomUUID()],
          era: ALL_ERAS,
        },
        era: {
          competitionIds: [pool.comps.league],
          clubIds: [],
          era: { from: 2020, to: 2025 },
        },
        // Each pool match fails two of the three
        combination: {
          competitionIds: [pool.comps.ucl],
          clubIds: [pool.clubs.a],
          era: { from: 2020, to: 2020 },
        },
      };
      const out: Record<string, unknown> = {};
      for (const [name, filters] of Object.entries(cases)) {
        out[name] = {
          select: await service.select(filters),
          check: await service.check(filters),
        };
      }
      return out;
    });

    for (const reason of ['competition', 'club', 'era', 'combination']) {
      expect(reasons[reason]).toEqual({
        select: { emptyBecause: reason },
        check: reason,
      });
    }
  });
});
