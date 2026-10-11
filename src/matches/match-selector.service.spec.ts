import type { Env } from '@/config/env.schema.js';
import type { Filters } from '@/contract/match.js';
import {
  MatchSelectorService,
  poolWhere,
} from '@/matches/match-selector.service.js';
import { POOL_THRESHOLD, TOURNAMENT_KINDS } from '@/matches/pool-rules.js';
import type { PrismaService } from '@/prisma/prisma.service.js';

const ALL: Filters = {
  competitionIds: [],
  clubIds: [],
  era: { from: 2000, to: 2025 },
};

const team = (
  clubId: string,
  lineups = 11,
  formation: string | null = '4-4-2',
) => ({
  clubId,
  formation,
  _count: { lineups },
});

const row = (id: string, teams = [team('home'), team('away')]) => ({
  id,
  season: { competitionId: 'comp-1', startYear: 2004 },
  teams,
});

function serviceWith(includeUnscored: boolean) {
  const prisma = { match: { findMany: vi.fn().mockResolvedValue([]) } };
  const env = { MATCH_POOL_INCLUDE_UNSCORED: includeUnscored } as Env;
  const service = new MatchSelectorService(
    prisma as unknown as PrismaService,
    env,
  );
  return { prisma, service };
}

describe('poolWhere', () => {
  const kinds = [...TOURNAMENT_KINDS];
  const scored = [
    {
      season: { competition: { kind: { in: kinds } } },
      memorability: { is: { score: { gte: POOL_THRESHOLD.tournament } } },
    },
    {
      season: { competition: { kind: { notIn: kinds } } },
      memorability: { is: { score: { gte: POOL_THRESHOLD.league } } },
    },
  ];

  it('applies the threshold by competition kind', () => {
    expect(poolWhere(false)).toEqual({ OR: scored });
  });

  it('adds only the unscored branch with the flag on', () => {
    expect(poolWhere(true)).toEqual({
      OR: [...scored, { memorability: { is: null } }],
    });
  });

  it('gives tournaments the lower threshold', () => {
    expect(POOL_THRESHOLD.tournament).toBeLessThan(POOL_THRESHOLD.league);
    expect(TOURNAMENT_KINDS).toEqual(['world_cup', 'euro', 'ucl']);
  });
});

describe('MatchSelectorService', () => {
  it('reads the pool with the flag from the env', async () => {
    const { prisma, service } = serviceWith(true);
    await service.candidates();
    expect(prisma.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: poolWhere(true),
        orderBy: { id: 'asc' },
      }),
    );
  });

  it('orders matches by id and teams home first', async () => {
    const { prisma, service } = serviceWith(false);
    await service.candidates();
    const { orderBy, select } = prisma.match.findMany.mock.calls[0][0];
    expect(orderBy).toEqual({ id: 'asc' });
    expect(select.teams.orderBy).toEqual({ side: 'asc' });
  });

  it('selects no lineup row and no score', async () => {
    const { prisma, service } = serviceWith(false);
    await service.candidates();
    const { select } = prisma.match.findMany.mock.calls[0][0];
    expect(select).not.toHaveProperty('memorability');
    expect(select.teams.select).not.toHaveProperty('lineups');
    expect(select.teams.select._count).toEqual({ select: { lineups: true } });
  });

  it('maps a complete match to a candidate', async () => {
    const { prisma, service } = serviceWith(false);
    prisma.match.findMany.mockResolvedValue([row('m1')]);
    await expect(service.candidates()).resolves.toEqual([
      {
        matchId: 'm1',
        competitionId: 'comp-1',
        seasonStart: 2004,
        clubIds: ['home', 'away'],
      },
    ]);
  });

  it.each([
    ['10 starters on one side', [team('home'), team('away', 10)]],
    ['a null formation', [team('home'), team('away', 11, null)]],
    ['a missing side', [team('home')]],
  ])('drops a match with %s', async (_, teams) => {
    const { prisma, service } = serviceWith(false);
    prisma.match.findMany.mockResolvedValue([row('bad', teams), row('m1')]);
    const candidates = await service.candidates();
    expect(candidates.map((c) => c.matchId)).toEqual(['m1']);
  });

  it('selects from the pool', async () => {
    const { prisma, service } = serviceWith(false);
    prisma.match.findMany.mockResolvedValue([row('m1')]);
    await expect(service.select(ALL, () => 0)).resolves.toEqual({
      matchId: 'm1',
    });
  });

  it('reports an empty pool from select and check', async () => {
    const { service } = serviceWith(false);
    await expect(service.select(ALL)).resolves.toEqual({
      emptyBecause: 'combination',
    });
    await expect(service.check(ALL)).resolves.toBe('combination');
  });

  it('blames the filter in check', async () => {
    const { prisma, service } = serviceWith(false);
    prisma.match.findMany.mockResolvedValue([row('m1')]);
    await expect(service.check(ALL)).resolves.toBeNull();
    await expect(
      service.check({ ...ALL, era: { from: 2020, to: 2025 } }),
    ).resolves.toBe('era');
  });
});
