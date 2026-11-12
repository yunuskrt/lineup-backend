import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import { loadEnv } from '@/config/load-env.js';
import type { CoinFlipResult, DuelSession } from '@/contract/duel.js';
import { historyPageSchema, profileSchema } from '@/contract/profile.js';
import { soloMatchOfferSchema } from '@/contract/solo.js';
import { NO_PREFERENCE } from '@/game/coin-flip.js';
import { MatchSelectorService } from '@/matches/match-selector.service.js';
import type { ShowcaseSpec } from '@/matches/showcase.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { SOLO_MESSAGES } from '@/solo/solo.service.js';
import { DuelHarness } from '@test/duel/duel-harness.js';
import { nextEvent } from '@test/duel/socket-client.js';
import { type Tx, useRolledBackDb } from '@test/schema/schema-test-utils.js';

const SLUG = 'test-exact';
// No pool club: the pick alone would refuse it
const NOBODY = '00000000-0000-7000-8000-000000000000';
const ALL = { competitionIds: [], clubIds: [], era: { from: 2000, to: 2025 } };

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

describe('POST /solo/sessions with a matchId (e2e)', () => {
  let on: INestApplication<App>;
  let off: INestApplication<App>;
  let prisma: PrismaService;
  let matchId: string;
  const guests: string[] = [];

  function player(app: INestApplication<App>) {
    const http = () => request(app.getHttpServer());
    let cookie = '';
    return {
      async join(tier: 'free' | 'pro') {
        const res = await http().post('/auth/guest');
        const id = res.body.data.user.id as string;
        guests.push(id);
        cookie = cookieHeader(res);
        await prisma.user.update({ where: { id }, data: { tier } });
      },
      start: (body: object) =>
        http().post('/solo/sessions').set('Cookie', cookie).send(body),
      // Offered, side picked, quit: a saved run
      async play(body: object) {
        const offer = await this.start(body);
        expect(offer.status, JSON.stringify(offer.body)).toBe(200);
        const { sessionId, match } = soloMatchOfferSchema.parse(
          offer.body.data,
        );
        const side = await http()
          .post(`/solo/sessions/${sessionId}/side`)
          .set('Cookie', cookie)
          .send({ side: 'home' });
        expect(side.status).toBe(200);
        const quit = await http()
          .post(`/solo/sessions/${sessionId}/quit`)
          .set('Cookie', cookie);
        expect(quit.status).toBe(200);
        return { sessionId, match };
      },
      history: async () =>
        historyPageSchema.parse(
          (await http().get('/profile/history').set('Cookie', cookie)).body
            .data,
        ),
      profile: async () =>
        profileSchema.parse(
          (await http().get('/profile').set('Cookie', cookie)).body.data,
        ),
    };
  }

  beforeAll(async () => {
    [on, off] = await Promise.all([boot(true), boot(false)]);
    prisma = on.get(PrismaService);
    const [first] = await on.get(MatchSelectorService).candidates();
    if (!first) throw new Error('The dev pool is empty');
    matchId = first.matchId;
  });

  afterAll(async () => {
    // Saved runs restrict a user delete (B10a)
    await prisma.gameSession.deleteMany({
      where: { participants: { some: { userId: { in: guests } } } },
    });
    await prisma.user.deleteMany({ where: { id: { in: guests } } });
    await Promise.all([on.close(), off.close()]);
  });

  it('plays the picked match for Pro, filters ignored, and saves it', async () => {
    const p = player(on);
    await p.join('pro');
    const narrow = { ...ALL, clubIds: [NOBODY] };

    const first = await p.play({ ...narrow, matchId });
    const again = await p.play({ ...narrow, matchId });

    expect(first.match.id).toBe(matchId);
    expect(again.match.id).toBe(matchId);
    const { entries } = await p.history();
    expect(entries.map((e) => [e.id, e.mode, e.match.id])).toEqual([
      [again.sessionId, 'solo', matchId],
      [first.sessionId, 'solo', matchId],
    ]);
    expect((await p.profile()).stats.played).toBe(2);
  });

  it('refuses Free with a matchId, and plays Free without one', async () => {
    const p = player(on);
    await p.join('free');

    const refused = await p.start({ ...ALL, matchId });

    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({
      success: false,
      error: {
        code: 'forbidden',
        message: SOLO_MESSAGES.proToPick,
        retryAfterMs: null,
        reason: 'pro_required',
      },
    });
    expect((await p.start(ALL)).status).toBe(200);
  });

  it.each([
    ['an unknown uuid', NOBODY],
    ['an id that is not a uuid', 'not-a-match'],
  ])('is not_found for %s', async (_, id) => {
    const p = player(on);
    await p.join('pro');

    const res = await p.start({ ...ALL, matchId: id });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({
      code: 'not_found',
      message: SOLO_MESSAGES.notInGame,
    });
  });

  it('lets anyone pick while the switch is off', async () => {
    const p = player(off);
    await p.join('free');

    expect((await p.play({ ...ALL, matchId })).match.id).toBe(matchId);
  });
});

describe('isPlayable over a rolled-back pool (e2e)', () => {
  const { rolledBack } = useRolledBackDb();
  const env = { MATCH_POOL_INCLUDE_UNSCORED: false } as Env;
  const SPEC: ShowcaseSpec = {
    matchSlug: `${SLUG}-show`,
    side: 'home',
    reveals: [],
    miss: '',
  };

  // in: whole XIs; out: no XI; show: the showcase
  async function build(tx: Tx) {
    const competition = await tx.competition.create({
      data: { slug: SLUG, kind: 'league', name: 'Exact League' },
    });
    const season = await tx.season.create({
      data: {
        competitionId: competition.id,
        label: '2006-07',
        startYear: 2006,
      },
    });
    const clubs = await Promise.all(
      ['a', 'b'].map((key) =>
        tx.club.create({
          data: {
            slug: `${SLUG}-${key}`,
            kind: 'club',
            name: `Exact ${key}`,
            shortName: `EX${key.toUpperCase()}`,
          },
        }),
      ),
    );
    await tx.player.createMany({
      data: Array.from({ length: 22 }, (_, i) => ({
        slug: `${SLUG}-p${String(i).padStart(2, '0')}`,
        name: `Exact Player ${i}`,
      })),
    });
    const players = await tx.player.findMany({
      where: { slug: { startsWith: `${SLUG}-p` } },
      orderBy: { slug: 'asc' },
    });
    const match = (tag: string, withLineups: boolean) =>
      tx.match.create({
        data: {
          slug: `${SLUG}-${tag}`,
          seasonId: season.id,
          date: new Date('2007-03-10'),
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
          },
        },
        select: { id: true },
      });
    return {
      inId: (await match('in', true)).id,
      outId: (await match('out', false)).id,
      showId: (await match('show', true)).id,
    };
  }

  it('accepts a pool match, never the showcase or one with no XI', async () => {
    const result = await rolledBack(async (tx) => {
      const ids = await build(tx);
      const selector = new MatchSelectorService(
        tx as unknown as PrismaService,
        env,
        SPEC,
      );
      return {
        in: await selector.isPlayable(ids.inId),
        out: await selector.isPlayable(ids.outId),
        show: await selector.isPlayable(ids.showId),
      };
    });

    expect(result).toEqual({ in: true, out: false, show: false });
  });
});

describe('A duel never takes a matchId (e2e)', () => {
  let h: DuelHarness;

  beforeAll(async () => {
    h = await DuelHarness.boot();
  });

  afterEach(() => h.settle());
  afterAll(() => h.close());

  it('accepts filters:submit with a matchId and drops it', async () => {
    const [a, b] = await Promise.all([h.client(), h.client()]);
    const paired = nextEvent(a.socket, 'paired');
    await h.ack(a, 'queue:enter');
    await h.ack(b, 'queue:enter');
    await paired;

    const flipped = nextEvent<CoinFlipResult>(a.socket, 'coinFlip');
    const ready = nextEvent<DuelSession>(a.socket, 'matchReady');
    const withId = { ...NO_PREFERENCE, matchId: NOBODY };
    expect(await h.ack(a, 'filters:submit', withId)).toEqual({
      success: true,
      data: null,
    });
    await h.ack(b, 'filters:submit', withId);

    expect((await flipped).filters).toEqual(NO_PREFERENCE);
    await ready;
    await h.ack(a, 'duel:forfeit');
  });
});
