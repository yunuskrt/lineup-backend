import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { CatalogService } from '@/catalog/catalog.service.js';
import type { Env } from '@/config/env.schema.js';
import {
  type CatalogOverview,
  catalogOverviewSchema,
} from '@/contract/catalog.js';
import { positionForSlot } from '@/game/formation.js';
import { MatchSelectorService } from '@/matches/match-selector.service.js';
import { PlayerKeysService } from '@/matches/player-keys.service.js';
import { LANDING_SHOWCASE, type ShowcaseSpec } from '@/matches/showcase.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { type Tx, useRolledBackDb } from '@test/schema/schema-test-utils.js';

const SLUG = 'test-overview';

describe('GET /catalog/overview (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let overview: CatalogOverview;
  let ids: string[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    await app.init();
    prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer()).get('/catalog/overview');
    expect(res.status).toBe(200);
    overview = catalogOverviewSchema.parse(res.body.data);
    const candidates = await app.get(MatchSelectorService).candidates();
    ids = candidates.map((candidate) => candidate.matchId);
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers with no session and passes the contract', async () => {
    const res = await request(app.getHttpServer()).get('/catalog/overview');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(catalogOverviewSchema.safeParse(res.body.data).success).toBe(true);
    expect(overview.counts.matches).toBeGreaterThan(0);
  });

  // dev has only the seed; the match is on ingest
  it('sends showcase null while its match is not loaded', async () => {
    const loaded = await prisma.match.count({
      where: { slug: LANDING_SHOWCASE.matchSlug },
    });
    expect(loaded).toBe(0);
    expect(overview.showcase).toBeNull();
  });

  it('counts exactly the candidates', async () => {
    const where = { id: { in: ids } };
    const [teams, starters, finals, shootouts, extraTime, goals] =
      await Promise.all([
        prisma.matchTeam.findMany({
          where: { matchId: { in: ids } },
          select: { club: { select: { id: true, kind: true } } },
        }),
        prisma.lineup.findMany({
          where: { matchTeam: { matchId: { in: ids } } },
          select: { playerId: true },
        }),
        prisma.match.count({ where: { ...where, stage: 'Final' } }),
        prisma.match.count({
          where: { ...where, shootoutHome: { not: null } },
        }),
        prisma.match.count({ where: { ...where, extraTime: true } }),
        prisma.matchTeam.aggregate({
          where: { matchId: { in: ids } },
          _sum: { goals: true },
        }),
      ]);
    const sides = (kind: string) =>
      new Set(teams.filter((t) => t.club.kind === kind).map((t) => t.club.id))
        .size;
    // Start years, not season rows: two cups share one
    const seasons = await prisma.season.findMany({
      where: { matches: { some: where } },
      select: { startYear: true },
      distinct: ['startYear'],
    });

    expect(overview.counts).toEqual({
      matches: ids.length,
      players: new Set(starters.map((s) => s.playerId)).size,
      clubs: sides('club'),
      nationalTeams: sides('national_team'),
      seasons: seasons.length,
    });
    expect(overview.highlights).toEqual({
      finals,
      shootouts,
      extraTime,
      goals: goals._sum.goals ?? 0,
    });
  });

  it('lists the filter-options competitions and era', async () => {
    const res = await request(app.getHttpServer()).get(
      '/catalog/filter-options',
    );
    const options = res.body.data;
    expect(overview.competitions.map((c) => c.id)).toEqual(
      options.competitions.map((c: { id: string }) => c.id),
    );
    expect(overview.era).toEqual(options.era);
  });

  it('orders top clubs by pool matches, clubs only', async () => {
    const teams = await prisma.matchTeam.findMany({
      where: { matchId: { in: ids }, club: { kind: 'club' } },
      select: { clubId: true },
    });
    const played = new Map<string, number>();
    for (const { clubId } of teams) {
      played.set(clubId, (played.get(clubId) ?? 0) + 1);
    }
    const counts = overview.topClubs.map((club) => played.get(club.id));
    expect(counts.every((n) => n !== undefined)).toBe(true);
    expect(counts).toEqual([...counts].sort((a, b) => (b ?? 0) - (a ?? 0)));
    expect(overview.topClubs.length).toBe(Math.min(12, played.size));
  });
});

describe('The showcase over a rolled-back match (e2e)', () => {
  const { rolledBack } = useRolledBackDb();
  const env = {
    MATCH_POOL_INCLUDE_UNSCORED: false,
    BETTER_AUTH_SECRET: 'overview-e2e',
  } as Env;
  const SPEC: ShowcaseSpec = {
    matchSlug: `${SLUG}-show`,
    side: 'home',
    reveals: [`${SLUG}-p08`, `${SLUG}-p10`, `${SLUG}-p09`],
    miss: `${SLUG}-p20`,
  };
  const ERA = { from: 2000, to: 2025 };

  // One scored match with both XIs whole
  async function build(tx: Tx) {
    const competition = await tx.competition.create({
      data: { slug: SLUG, kind: 'league', name: 'Overview League' },
    });
    const season = await tx.season.create({
      data: {
        competitionId: competition.id,
        label: '2016-17',
        startYear: 2016,
      },
    });
    const clubs = await Promise.all(
      ['home', 'away'].map((side) =>
        tx.club.create({
          data: {
            slug: `${SLUG}-${side}`,
            kind: 'club',
            name: `Overview ${side}`,
            shortName: side.slice(0, 3).toUpperCase(),
          },
        }),
      ),
    );
    const players = await Promise.all(
      Array.from({ length: 22 }, (_, i) => {
        const n = String(i).padStart(2, '0');
        return tx.player.create({
          data: {
            slug: `${SLUG}-p${n}`,
            name: `Overview Player ${n}`,
            aliases: {
              create: {
                alias: `Overview Player ${n}`,
                normalized: `overview player ${n}`,
              },
            },
          },
        });
      }),
    );
    const formation = '4-3-3';
    const match = await tx.match.create({
      data: {
        slug: SPEC.matchSlug,
        seasonId: season.id,
        date: new Date('2017-04-23'),
        stage: 'Final',
        memorability: {
          create: {
            score: 90,
            signals: {},
            algorithmVersion: 'test',
            computedAt: new Date(),
          },
        },
        teams: {
          create: (['home', 'away'] as const).map((side, s) => ({
            side,
            clubId: clubs[s].id,
            goals: 2 + s,
            formation,
            lineups: {
              create: Array.from({ length: 11 }, (_, slot) => ({
                playerId: players[s * 11 + slot].id,
                slot,
                position: positionForSlot(formation, slot) ?? 'GK',
              })),
            },
          })),
        },
      },
    });
    return { competitionId: competition.id, matchId: match.id };
  }

  function services(tx: Tx, spec: ShowcaseSpec) {
    const db = tx as unknown as PrismaService;
    const selector = new MatchSelectorService(db, env, spec);
    const keys = new PlayerKeysService(env);
    return {
      selector,
      catalog: new CatalogService(selector, db, env, keys, spec, {
        now: () => Date.now(),
      }),
    };
  }

  it('builds the showcase and keeps its match out of the pool', async () => {
    const result = await rolledBack(async (tx) => {
      const built = await build(tx);
      const shown = services(tx, SPEC);
      const served = services(tx, LANDING_SHOWCASE);
      const only = {
        competitionIds: [built.competitionId],
        clubIds: [],
        era: ERA,
      };
      return {
        built,
        overview: await shown.catalog.overview(),
        candidates: await shown.selector.candidates(),
        options: await shown.catalog.filterOptions(),
        check: await shown.selector.check(only),
        served: {
          overview: await served.catalog.overview(),
          candidates: await served.selector.candidates(),
          options: await served.catalog.filterOptions(),
          check: await served.selector.check(only),
        },
      };
    });

    const { showcase } = result.overview;
    expect(showcase).not.toBeNull();
    expect(catalogOverviewSchema.safeParse(result.overview).success).toBe(true);
    expect(showcase?.match).toMatchObject({
      id: result.built.matchId,
      side: 'home',
      formation: '4-3-3',
      stage: 'Final',
      score: { home: 2, away: 3 },
    });
    expect(showcase?.players.map((p) => p.name)).toEqual(
      Array.from(
        { length: 11 },
        (_, i) => `Overview Player ${String(i).padStart(2, '0')}`,
      ),
    );
    expect(showcase?.demo.reveals).toEqual([8, 10, 9]);
    expect(showcase?.demo.miss?.name).toBe('Overview Player 20');

    // Never served: no candidate, no option
    const matchIds = (list: { matchId: string }[]) =>
      list.map((c) => c.matchId);
    expect(matchIds(result.candidates)).not.toContain(result.built.matchId);
    expect(matchIds(result.served.candidates)).toContain(result.built.matchId);
    expect(result.overview.counts.matches).toBe(
      result.served.overview.counts.matches - 1,
    );
    const competitionIds = (options: { competitions: { id: string }[] }) =>
      options.competitions.map((c) => c.id);
    expect(competitionIds(result.options)).not.toContain(
      result.built.competitionId,
    );
    expect(competitionIds(result.served.options)).toContain(
      result.built.competitionId,
    );
    // Empty either way; the blame depends on the rest
    expect(result.check).not.toBeNull();
    expect(result.served.check).toBeNull();
  });

  it('sends null, and the rest, for a miss from the named XI', async () => {
    const overview = await rolledBack(async (tx) => {
      await build(tx);
      const spec = { ...SPEC, miss: `${SLUG}-p01` };
      return services(tx, spec).catalog.overview();
    });
    expect(overview.showcase).toBeNull();
    expect(catalogOverviewSchema.safeParse(overview).success).toBe(true);
  });
});
