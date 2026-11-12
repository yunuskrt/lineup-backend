import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { CLOCK, type Clock } from '@/common/clock.js';
import { ENV } from '@/config/config.module.js';
import { loadEnv } from '@/config/load-env.js';
import { SOLO_DAILY_RUNS } from '@/contract/constants.js';
import { soloAllowanceSchema } from '@/contract/solo.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { nextUtcMidnight } from '@/solo/daily-cap.js';
import { SOLO_MESSAGES } from '@/solo/solo.service.js';

const ALL = { competitionIds: [], clubIds: [], era: { from: 2000, to: 2025 } };

const cookieHeader = (res: request.Response) =>
  [res.headers['set-cookie'] ?? []]
    .flat()
    .map((c) => c.split(';')[0])
    .join('; ');

describe('Solo daily cap (e2e)', () => {
  let on: INestApplication<App>;
  let off: INestApplication<App>;
  let prisma: PrismaService;
  const clock: Clock & { at: number } = {
    at: Date.now(),
    now: () => clock.at,
  };
  const guests: string[] = [];

  async function boot(proEnabled: boolean) {
    const env = loadEnv();
    if (!env.success) throw new Error('E2E needs a valid .env');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue({ ...env.data, PRO_ENABLED: proEnabled })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    const app = moduleRef.createNestApplication<INestApplication<App>>({
      bodyParser: false,
    });
    await app.init();
    return app;
  }

  beforeAll(async () => {
    [on, off] = await Promise.all([boot(true), boot(false)]);
    prisma = on.get(PrismaService);
  });

  beforeEach(() => {
    clock.at = Date.now();
  });

  afterAll(async () => {
    // Saved runs restrict a user delete (B10a)
    await prisma.gameSession.deleteMany({
      where: { participants: { some: { userId: { in: guests } } } },
    });
    await prisma.user.deleteMany({ where: { id: { in: guests } } });
    await Promise.all([on.close(), off.close()]);
  });

  function player(app: INestApplication<App>) {
    const http = () => request(app.getHttpServer());
    let cookie = '';
    return {
      async join(tier: 'free' | 'pro' = 'free') {
        const res = await http().post('/auth/guest');
        const id = res.body.data.user.id as string;
        guests.push(id);
        cookie = cookieHeader(res);
        await prisma.user.update({ where: { id }, data: { tier } });
      },
      start: () =>
        http().post('/solo/sessions').set('Cookie', cookie).send(ALL),
      side: (id: string) =>
        http()
          .post(`/solo/sessions/${id}/side`)
          .set('Cookie', cookie)
          .send({ side: 'home' }),
      quit: (id: string) =>
        http().post(`/solo/sessions/${id}/quit`).set('Cookie', cookie),
      allowance: async () => {
        const res = await http().get('/solo/allowance').set('Cookie', cookie);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        return soloAllowanceSchema.parse(res.body.data);
      },
      // Offered, side picked, quit: one counted run
      async runs(n: number) {
        for (let i = 0; i < n; i += 1) {
          const offer = await this.start();
          expect(offer.status, JSON.stringify(offer.body)).toBe(200);
          const id = offer.body.data.sessionId as string;
          expect((await this.side(id)).status).toBe(200);
          expect((await this.quit(id)).status).toBe(200);
        }
      },
    };
  }

  it('refuses a Free sixth start until UTC midnight', async () => {
    const p = player(on);
    await p.join();
    await p.runs(SOLO_DAILY_RUNS);

    const refused = await p.start();

    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({
      success: false,
      error: {
        code: 'forbidden',
        message: SOLO_MESSAGES.dailyCap,
        retryAfterMs: nextUtcMidnight(clock.at) - clock.at,
        reason: 'daily_cap',
      },
    });
    expect(await p.allowance()).toEqual({
      limit: SOLO_DAILY_RUNS,
      used: SOLO_DAILY_RUNS,
      resetsAt: nextUtcMidnight(clock.at),
    });

    clock.at = nextUtcMidnight(clock.at) + 1;
    expect((await p.start()).status).toBe(200);
    expect((await p.allowance()).used).toBe(0);
  });

  it('never counts an offer with no side pick', async () => {
    const p = player(on);
    await p.join();
    await p.runs(2);
    expect((await p.start()).status).toBe(200);
    expect((await p.start()).status).toBe(200);

    expect((await p.allowance()).used).toBe(2);
  });

  it('lets exactly one of two side picks at 4 used through', async () => {
    const p = player(on);
    await p.join();
    await p.runs(4);
    const id = (await p.start()).body.data.sessionId as string;

    const picks = await Promise.all([p.side(id), p.side(id)]);

    expect(picks.map((res) => res.status).sort((a, b) => a - b)).toEqual([
      200, 403,
    ]);
    expect((await p.allowance()).used).toBe(5);
  });

  it.each([
    ['a Pro user, switch on', () => on, 'pro'],
    ['a stored-Free user, switch off', () => off, 'free'],
  ] as const)('never caps %s', async (_, app, tier) => {
    const p = player(app());
    await p.join(tier);
    await p.runs(SOLO_DAILY_RUNS + 1);

    expect(await p.allowance()).toEqual({
      limit: null,
      used: SOLO_DAILY_RUNS + 1,
      resetsAt: nextUtcMidnight(clock.at),
    });
  });

  it('needs a session for the allowance', async () => {
    const res = await request(on.getHttpServer()).get('/solo/allowance');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });
});
