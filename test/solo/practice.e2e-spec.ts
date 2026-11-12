import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { ENV } from '@/config/config.module.js';
import { loadEnv } from '@/config/load-env.js';
import { historyPageSchema, profileSchema } from '@/contract/profile.js';
import {
  type SoloSession,
  soloAllowanceSchema,
  soloGuessResponseSchema,
  soloMatchOfferSchema,
  soloSessionSchema,
  soloSummarySchema,
} from '@/contract/solo.js';
import { MatchSelectorService } from '@/matches/match-selector.service.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { SOLO_MESSAGES } from '@/solo/solo.service.js';

const ALL = { competitionIds: [], clubIds: [], era: { from: 2000, to: 2025 } };
const PRACTICE = { ...ALL, practice: true };
// No pool club: the pick alone would refuse it
const NOBODY = '00000000-0000-7000-8000-000000000000';

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

describe('Solo practice (e2e)', () => {
  let on: INestApplication<App>;
  let off: INestApplication<App>;
  let prisma: PrismaService;
  let matchId: string;
  const guests: string[] = [];

  function player(app: INestApplication<App>) {
    const http = () => request(app.getHttpServer());
    let cookie = '';
    let userId = '';
    const data = <T>(
      res: request.Response,
      schema: { parse: (v: unknown) => T },
    ) => {
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return schema.parse(res.body.data);
    };
    return {
      get id() {
        return userId;
      },
      async join(tier: 'free' | 'pro') {
        const res = await http().post('/auth/guest');
        userId = res.body.data.user.id as string;
        guests.push(userId);
        cookie = cookieHeader(res);
        await prisma.user.update({ where: { id: userId }, data: { tier } });
      },
      start: (body: object) =>
        http().post('/solo/sessions').set('Cookie', cookie).send(body),
      // Offered and side picked
      async practise(body: object = PRACTICE) {
        const offer = data(await this.start(body), soloMatchOfferSchema);
        const session = data(
          await http()
            .post(`/solo/sessions/${offer.sessionId}/side`)
            .set('Cookie', cookie)
            .send({ side: 'home' }),
          soloSessionSchema,
        );
        return session;
      },
      guess: async (sessionId: string, guess: string) =>
        data(
          await http()
            .post(`/solo/sessions/${sessionId}/guesses`)
            .set('Cookie', cookie)
            .send({ sessionId, guess }),
          soloGuessResponseSchema,
        ),
      quit: async (sessionId: string) =>
        data(
          await http()
            .post(`/solo/sessions/${sessionId}/quit`)
            .set('Cookie', cookie),
          soloSummarySchema,
        ),
      summary: async (sessionId: string) =>
        data(
          await http()
            .get(`/solo/sessions/${sessionId}/summary`)
            .set('Cookie', cookie),
          soloSummarySchema,
        ),
      allowance: async () =>
        data(
          await http().get('/solo/allowance').set('Cookie', cookie),
          soloAllowanceSchema,
        ),
      history: async () =>
        data(
          await http().get('/profile/history').set('Cookie', cookie),
          historyPageSchema,
        ),
      profile: async () =>
        data(await http().get('/profile').set('Cookie', cookie), profileSchema),
    };
  }

  async function startersOf(session: SoloSession): Promise<string[]> {
    const rows = await prisma.lineup.findMany({
      where: {
        matchTeam: { matchId: session.match.id, side: session.match.side },
      },
      select: { player: { select: { name: true } } },
    });
    return rows.map((row) => row.player.name);
  }

  async function expectNothingSaved(p: ReturnType<typeof player>) {
    expect(
      await prisma.gameSession.count({
        where: { participants: { some: { userId: p.id } } },
      }),
    ).toBe(0);
    expect((await p.history()).entries).toEqual([]);
    expect((await p.profile()).stats.played).toBe(0);
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

  it('plays to a perfect clear with no clock, saving nothing', async () => {
    const p = player(on);
    await p.join('pro');

    const session = await p.practise();
    expect(session).toMatchObject({
      status: 'active',
      lives: 3,
      round: null,
      practice: true,
    });

    const miss = await p.guess(session.sessionId, 'Nobody Atall Zzz');
    expect(miss.result.outcome).toBe('not_in_xi');
    let last = miss;
    for (const name of await startersOf(session)) {
      last = await p.guess(session.sessionId, name);
      expect(last.session.round).toBeNull();
      expect(last.session.lives).toBe(3);
    }
    expect(last.session).toMatchObject({ status: 'over', practice: true });

    expect(await p.summary(session.sessionId)).toMatchObject({
      endReason: 'perfect_clear',
      livesRemaining: 3,
      missedCount: 0,
      practice: true,
    });
    await expectNothingSaved(p);
  });

  it('ends on quit with 3 lives, saving nothing', async () => {
    const p = player(on);
    await p.join('pro');
    const session = await p.practise();

    expect(await p.quit(session.sessionId)).toMatchObject({
      endReason: 'quit',
      livesRemaining: 3,
      practice: true,
    });
    await expectNothingSaved(p);
  });

  it('plays the picked match with matchId', async () => {
    const p = player(on);
    await p.join('pro');

    const session = await p.practise({
      ...PRACTICE,
      clubIds: [NOBODY],
      matchId,
    });
    expect(session.match.id).toBe(matchId);
    expect(session.practice).toBe(true);
  });

  it('refuses Free with pro_required', async () => {
    const p = player(on);
    await p.join('free');

    const refused = await p.start(PRACTICE);

    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({
      success: false,
      error: {
        code: 'forbidden',
        message: SOLO_MESSAGES.proToPractise,
        retryAfterMs: null,
        reason: 'pro_required',
      },
    });
  });

  it('lets anyone practise with the switch off, outside the count', async () => {
    const p = player(off);
    await p.join('free');
    const before = await p.allowance();

    const session = await p.practise();
    await p.quit(session.sessionId);

    expect((await p.allowance()).used).toBe(before.used);
    await expectNothingSaved(p);
  });
});
