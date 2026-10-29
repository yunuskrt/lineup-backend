import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { CatalogService } from '@/catalog/catalog.service.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import { filterOptionsSchema } from '@/contract/catalog.js';
import { MatchSelectorService } from '@/matches/match-selector.service.js';
import { poolCoverage } from '@/matches/pool-rules.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { type Tx, useRolledBackDb } from '@test/schema/schema-test-utils.js';

const SLUG = 'test-catalog';

describe('GET /catalog/filter-options (e2e)', () => {
  let app: INestApplication<App>;
  let env: Env;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    await app.init();
    env = app.get<Env>(ENV);
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers with no session and passes the contract', async () => {
    const res = await http().get('/catalog/filter-options');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(filterOptionsSchema.safeParse(res.body.data).success).toBe(true);
  });

  it('lists exactly what the pool covers', async () => {
    const res = await http().get('/catalog/filter-options');
    const coverage = poolCoverage(
      await app.get(MatchSelectorService).candidates(),
    );
    const ids = (refs: { id: string }[]) => refs.map((ref) => ref.id).sort();
    expect(ids(res.body.data.competitions)).toEqual(
      [...coverage.competitionIds].sort(),
    );
    expect(ids(res.body.data.clubs)).toEqual([...coverage.clubIds].sort());
    expect(res.body.data.era).toEqual(coverage.era);
  });

  it('includes the seeded mock data when the dev flag is on', async () => {
    if (!env.MATCH_POOL_INCLUDE_UNSCORED) {
      throw new Error('E2E expects MATCH_POOL_INCLUDE_UNSCORED=true in .env');
    }
    const prisma = app.get(PrismaService);
    const seeded = await prisma.match.findMany({
      where: { NOT: { slug: { startsWith: 'test-' } } },
      select: {
        season: { select: { competitionId: true, startYear: true } },
        teams: { select: { clubId: true } },
      },
    });
    const res = await http().get('/catalog/filter-options');
    const listed = {
      competitions: res.body.data.competitions.map((c: { id: string }) => c.id),
      clubs: res.body.data.clubs.map((c: { id: string }) => c.id),
    };

    for (const match of seeded) {
      expect(listed.competitions).toContain(match.season.competitionId);
      for (const team of match.teams) {
        expect(listed.clubs).toContain(team.clubId);
      }
    }
    const starts = seeded.map((match) => match.season.startYear);
    expect(res.body.data.era.from).toBeLessThanOrEqual(Math.min(...starts));
    expect(res.body.data.era.to).toBeGreaterThanOrEqual(Math.max(...starts));
  });
});

describe('CatalogService over a rolled-back pool (e2e)', () => {
  const { rolledBack } = useRolledBackDb();

  // `in` has a complete scored match; `out` none
  async function build(tx: Tx) {
    const [inComp, outComp] = await Promise.all(
      ['in', 'out'].map((tag) =>
        tx.competition.create({
          data: { slug: `${SLUG}-${tag}`, kind: 'league', name: `Cat ${tag}` },
        }),
      ),
    );
    const [inSeason, outSeason] = await Promise.all(
      [inComp, outComp].map((comp) =>
        tx.season.create({
          data: { competitionId: comp.id, label: '2006-07', startYear: 2006 },
        }),
      ),
    );
    const clubs = await Promise.all(
      ['a', 'b'].map((key) =>
        tx.club.create({
          data: {
            slug: `${SLUG}-${key}`,
            kind: 'club',
            name: `Cat ${key}`,
            shortName: `CT${key.toUpperCase()}`,
          },
        }),
      ),
    );
    await tx.player.createMany({
      data: Array.from({ length: 22 }, (_, i) => ({
        slug: `${SLUG}-p${String(i).padStart(2, '0')}`,
        name: `Cat Player ${i}`,
      })),
    });
    const players = await tx.player.findMany({
      where: { slug: { startsWith: `${SLUG}-p` } },
      orderBy: { slug: 'asc' },
    });

    const teams = (withLineups: boolean) => ({
      create: (['home', 'away'] as const).map((side, s) => ({
        side,
        clubId: clubs[s].id,
        goals: 0,
        formation: '4-4-2',
        ...(withLineups && {
          lineups: {
            create: Array.from({ length: 11 }, (_, slot) => ({
              playerId: players[s * 11 + slot].id,
              slot,
              position: slot === 0 ? ('GK' as const) : ('MF' as const),
            })),
          },
        }),
      })),
    });
    const score = {
      create: {
        score: 90,
        signals: {},
        algorithmVersion: 'test',
        computedAt: new Date(),
      },
    };

    await tx.match.create({
      data: {
        slug: `${SLUG}-in`,
        seasonId: inSeason.id,
        date: new Date('2007-03-10'),
        teams: teams(true),
        memorability: score,
      },
    });
    // Scored, but no XI: never in the pool
    await tx.match.create({
      data: {
        slug: `${SLUG}-out`,
        seasonId: outSeason.id,
        date: new Date('2007-03-10'),
        teams: teams(false),
        memorability: score,
      },
    });
    return { inId: inComp.id, outId: outComp.id };
  }

  it('leaves out a competition with no pool match', async () => {
    const result = await rolledBack(async (tx) => {
      const ids = await build(tx);
      const db = tx as unknown as PrismaService;
      const env = { MATCH_POOL_INCLUDE_UNSCORED: false } as Env;
      const selector = new MatchSelectorService(db, env);
      const catalog = new CatalogService(selector, db, env);
      const options = await catalog.filterOptions();
      return { ids, listed: options.competitions.map((c) => c.id) };
    });
    expect(result.listed).toContain(result.ids.inId);
    expect(result.listed).not.toContain(result.ids.outId);
  });
});
