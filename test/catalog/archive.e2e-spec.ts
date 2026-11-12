import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { ARCHIVE_MESSAGES, ArchiveService } from '@/catalog/archive.service.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import { loadEnv } from '@/config/load-env.js';
import { archivePageSchema } from '@/contract/catalog.js';
import type { MatchIdentity } from '@/contract/match.js';
import { MatchSelectorService } from '@/matches/match-selector.service.js';
import type { ShowcaseSpec } from '@/matches/showcase.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { type Tx, useRolledBackDb } from '@test/schema/schema-test-utils.js';

const SLUG = 'test-archive';

const IDENTITY_KEYS = [
  'away',
  'competition',
  'date',
  'home',
  'id',
  'nickname',
  'score',
  'season',
  'stage',
];

const cookieHeader = (res: request.Response) =>
  [res.headers['set-cookie'] ?? []]
    .flat()
    .map((c) => c.split(';')[0])
    .join('; ');

async function boot(proEnabled: boolean) {
  const env = loadEnv();
  if (!env.success) throw new Error('E2E needs a valid .env');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue({ ...env.data, PRO_ENABLED: proEnabled })
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    bodyParser: false,
  });
  await app.init();
  return app;
}

describe('GET /catalog/matches (e2e)', () => {
  let on: INestApplication<App>;
  let off: INestApplication<App>;
  let prisma: PrismaService;
  let poolIds: string[];
  let pro = '';
  const guests: string[] = [];
  const get = (app: INestApplication<App>, cookie = '') =>
    request(app.getHttpServer()).get('/catalog/matches').set('Cookie', cookie);

  async function guest(tier: 'free' | 'pro') {
    const res = await request(on.getHttpServer()).post('/auth/guest');
    const id = res.body.data.user.id as string;
    guests.push(id);
    await prisma.user.update({ where: { id }, data: { tier } });
    return cookieHeader(res);
  }

  // Every page of a query, through the cursor
  async function everyPage(query: Record<string, string | number>) {
    const ids: string[] = [];
    let cursor: string | null = null;
    let total = -1;
    for (let guard = 0; guard < 100; guard += 1) {
      const res = await get(on, pro).query({
        ...query,
        ...(cursor && { cursor }),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const page = archivePageSchema.parse(res.body.data);
      total = page.total;
      ids.push(...page.entries.map((e) => e.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    return { ids, total };
  }

  beforeAll(async () => {
    [on, off] = await Promise.all([boot(true), boot(false)]);
    prisma = on.get(PrismaService);
    poolIds = (await on.get(MatchSelectorService).candidates()).map(
      (c) => c.matchId,
    );
    pro = await guest('pro');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: guests } } });
    await Promise.all([on.close(), off.close()]);
  });

  describe('access', () => {
    it('needs a session while the switch is on', async () => {
      const res = await get(on);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('unauthorized');
    });

    it('refuses Free with pro_required', async () => {
      const res = await get(on, await guest('free'));
      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        success: false,
        error: {
          code: 'forbidden',
          message: ARCHIVE_MESSAGES.proRequired,
          retryAfterMs: null,
          reason: 'pro_required',
        },
      });
    });

    it('serves Pro', async () => {
      expect((await get(on, pro)).status).toBe(200);
    });

    it('is public while the switch is off', async () => {
      const res = await get(off);
      expect(res.status).toBe(200);
      expect(archivePageSchema.safeParse(res.body.data).success).toBe(true);
    });
  });

  it('lists the whole pool once, newest first, with its total', async () => {
    const { ids, total } = await everyPage({ limit: 3 });

    expect(total).toBe(poolIds.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...poolIds].sort());
  });

  it('sends MatchIdentity and nothing more', async () => {
    const res = await get(on, pro).query({ limit: 50 });
    const entries = res.body.data.entries as MatchIdentity[];

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(IDENTITY_KEYS);
    }
    const dates = entries.map((e) => e.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('filters by competition, club, seasons and search', async () => {
    const first = archivePageSchema.parse(
      (await get(on, pro).query({ limit: 1 })).body.data,
    ).entries[0];
    if (!first) throw new Error('The dev pool is empty');
    const year = Number(first.date.slice(0, 4));

    const byCompetition = await everyPage({
      competitionId: first.competition.id,
    });
    const byClub = await everyPage({ clubId: first.home.id });
    const bySeason = await everyPage({ from: year - 1, to: year });
    const byName = await everyPage({ q: first.away.name.toUpperCase() });

    for (const result of [byCompetition, byClub, bySeason, byName]) {
      expect(result.ids).toContain(first.id);
      expect(result.total).toBe(result.ids.length);
      expect(result.total).toBeLessThanOrEqual(poolIds.length);
    }
    expect(
      (await everyPage({ clubId: first.home.id, q: 'zzzz-nothing' })).total,
    ).toBe(0);
  });

  it('refuses a bad query or cursor as invalid_input', async () => {
    for (const query of [{ from: 2010, to: 2005 }, { cursor: 'eA' }]) {
      const res = await get(on, pro).query(query);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_input');
    }
  });
});

describe('The archive over a rolled-back pool (e2e)', () => {
  const { rolledBack } = useRolledBackDb();
  const env = { MATCH_POOL_INCLUDE_UNSCORED: false } as Env;
  const SPEC: ShowcaseSpec = {
    matchSlug: `${SLUG}-show`,
    side: 'home',
    reveals: [],
    miss: '',
  };

  // in: a pool match; out: no XI; show: showcase
  async function build(tx: Tx) {
    const competition = await tx.competition.create({
      data: { slug: SLUG, kind: 'league', name: 'Süper Arşiv Ligi' },
    });
    const season = await tx.season.create({
      data: {
        competitionId: competition.id,
        label: '2004-05',
        startYear: 2004,
      },
    });
    const clubs = await Promise.all(
      ['a', 'b'].map((key) =>
        tx.club.create({
          data: {
            slug: `${SLUG}-${key}`,
            kind: 'club',
            name: key === 'a' ? 'Atlético Arşiv' : 'Archive United',
            shortName: `AR${key.toUpperCase()}`,
            aliases: { create: { alias: `Archive Alias ${key}` } },
          },
        }),
      ),
    );
    await tx.player.createMany({
      data: Array.from({ length: 22 }, (_, i) => ({
        slug: `${SLUG}-p${String(i).padStart(2, '0')}`,
        name: `Archive Player ${i}`,
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
        goals: s,
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
    const memorability = {
      create: {
        score: 90,
        signals: {},
        algorithmVersion: 'test',
        computedAt: new Date(),
      },
    };
    const match = (tag: string, withLineups: boolean, nickname: string) =>
      tx.match.create({
        data: {
          slug: `${SLUG}-${tag}`,
          seasonId: season.id,
          date: new Date('2005-05-25'),
          nickname,
          teams: teams(withLineups),
          memorability,
        },
        select: { id: true },
      });
    return {
      inId: (await match('in', true, 'The Archive Night')).id,
      outId: (await match('out', false, 'The Missing XI')).id,
      showId: (await match('show', true, 'The Showcase')).id,
    };
  }

  it('lists only the pool, never the showcase, and searches it', async () => {
    const result = await rolledBack(async (tx) => {
      const ids = await build(tx);
      const db = tx as unknown as PrismaService;
      const archive = new ArchiveService(
        new MatchSelectorService(db, env, SPEC),
        db,
        env,
        { now: () => Date.now() },
      );
      const ofQuery = async (q: string) =>
        (await archive.page({ q, limit: 50 })).entries.map((e) => e.id);
      return {
        ids,
        all: (await archive.page({ limit: 50 })).entries.map((e) => e.id),
        accentless: await ofQuery('atletico arsiv'),
        turkish: await ofQuery('SUPER ARSIV'),
        alias: await ofQuery('archive alias b'),
        nickname: await ofQuery('archive night'),
        years: await ofQuery('arsiv 2005'),
        missing: await ofQuery('missing'),
      };
    });

    expect(result.all).toContain(result.ids.inId);
    expect(result.all).not.toContain(result.ids.outId);
    expect(result.all).not.toContain(result.ids.showId);
    for (const found of [
      result.accentless,
      result.turkish,
      result.alias,
      result.nickname,
      result.years,
    ]) {
      expect(found).toEqual([result.ids.inId]);
    }
    expect(result.missing).toEqual([]);
  });
});
