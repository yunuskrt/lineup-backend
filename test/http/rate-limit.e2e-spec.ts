import { setTimeout as sleep } from 'node:timers/promises';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '@/app.module.js';
import { RATE_LIMITS } from '@/common/rate-limits.js';
import { ENV } from '@/config/config.module.js';
import { loadEnv } from '@/config/load-env.js';
import { applyTrustProxy } from '@/config/proxy.js';
import { apiErrorSchema } from '@/contract/envelope.js';
import { soloSessionSchema } from '@/contract/solo.js';
import { PrismaService } from '@/prisma/prisma.service.js';

const ALL = { competitionIds: [], clubIds: [], era: { from: 2000, to: 2025 } };
const MISS = 'Nobody Atall Zzyzx';

const cookieHeader = (res: request.Response) =>
  [res.headers['set-cookie'] ?? []]
    .flat()
    .map((c) => c.split(';')[0])
    .join('; ');

describe('Rate limits (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const guests: string[] = [];
  // A fresh address per case keeps IP limits apart
  let lastOctet = 0;
  const nextIp = () => `198.51.100.${++lastOctet}`;
  const refusals: request.Response[] = [];

  const http = (ip: string) => {
    const agent = request(app.getHttpServer());
    const as = (test: request.Test) => test.set('X-Forwarded-For', ip);
    return {
      get: (path: string) => as(agent.get(path)),
      post: (path: string) => as(agent.post(path)),
    };
  };

  function expectRefused(res: request.Response) {
    refusals.push(res);
    expect(res.status).toBe(429);
    const error = apiErrorSchema.parse(res.body.error);
    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterMs).toBeGreaterThan(0);
    expect(Number(res.headers['retry-after'])).toBe(error.retryAfterMs! / 1000);
    return error;
  }

  async function guest(ip = nextIp()) {
    const res = await http(ip).post('/auth/guest');
    guests.push(res.body.data.user.id as string);
    return cookieHeader(res);
  }

  // A run in play for a fresh guest
  async function playing(ip = nextIp()) {
    const cookie = await guest(ip);
    const offer = await http(ip)
      .post('/solo/sessions')
      .set('Cookie', cookie)
      .send(ALL);
    const id = offer.body.data.sessionId as string;
    await http(ip)
      .post(`/solo/sessions/${id}/side`)
      .set('Cookie', cookie)
      .send({ side: 'home' });
    return {
      guess: () =>
        http(ip)
          .post(`/solo/sessions/${id}/guesses`)
          .set('Cookie', cookie)
          .send({ sessionId: id, guess: MISS }),
      sync: () => http(ip).get(`/solo/sessions/${id}`).set('Cookie', cookie),
    };
  }

  beforeAll(async () => {
    const env = loadEnv();
    if (!env.success) throw new Error('E2E needs a valid .env');
    // Back on for this suite only, behind one proxy
    const limited = {
      ...env.data,
      RATE_LIMITS_ENABLED: true,
      TRUST_PROXY_HOPS: 1,
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(limited)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    applyTrustProxy(app, limited);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.gameSession.deleteMany({
      where: { participants: { some: { userId: { in: guests } } } },
    });
    await prisma.user.deleteMany({ where: { id: { in: guests } } });
    await app.close();
  });

  describe('guesses', () => {
    it('refuses the 13th in the window, and only that player', async () => {
      const ip = nextIp();
      const run = await playing(ip);
      const before = soloSessionSchema.parse((await run.sync()).body.data);
      for (let sent = 0; sent < RATE_LIMITS.guess.limit; sent += 1) {
        expect((await run.guess()).status).toBe(200);
      }

      const error = expectRefused(await run.guess());
      expect(error.retryAfterMs).toBeLessThanOrEqual(RATE_LIMITS.guess.ttl);

      // Same IP: the count is per user, not per address
      const other = await playing(ip);
      expect((await other.guess()).status).toBe(200);

      const after = soloSessionSchema.parse((await run.sync()).body.data);
      expect(after).toMatchObject({ lives: 3, round: before.round });
    });

    it('accepts guesses again once the window has passed', async () => {
      const run = await playing();
      for (let sent = 0; sent <= RATE_LIMITS.guess.limit; sent += 1) {
        await run.guess();
      }
      const { retryAfterMs } = expectRefused(await run.guess());

      await sleep(retryAfterMs! + 100);
      expect((await run.guess()).status).toBe(200);
    });
  });

  describe('sign-in', () => {
    const attempt = (ip: string, email: string) =>
      http(ip).post('/auth/sign-in').send({ email, password: 'wrong-horse' });

    it('refuses the 11th attempt from one IP, whatever the email', async () => {
      const ip = nextIp();
      for (let tried = 0; tried < RATE_LIMITS.signIn.limit; tried += 1) {
        const res = await attempt(ip, `test-rl-ip-${tried}@lineup.test`);
        expect(res.status).toBe(401);
      }
      const res = await attempt(ip, 'test-rl-ip-last@lineup.test');
      expectRefused(res);
      expect(res.body.error.message).not.toContain('test-rl-ip-last');
    });

    it('refuses the 6th attempt on one email, from any IP', async () => {
      const email = 'Test-RL-Account@lineup.test';
      for (let tried = 0; tried < 5; tried += 1) {
        const res = await attempt(
          nextIp(),
          tried % 2 ? email : email.toLowerCase(),
        );
        expect(res.status).toBe(401);
      }
      const res = await attempt(nextIp(), ` ${email} `);
      expectRefused(res);
      expect(res.body.error.message).not.toMatch(/test-rl-account/i);
    });
  });

  it('refuses the 11th guest from one IP', async () => {
    const ip = nextIp();
    for (let made = 0; made < RATE_LIMITS.guest.limit; made += 1) {
      await guest(ip);
    }
    expectRefused(await http(ip).post('/auth/guest'));
  });

  it('holds a route with no limit of its own to the default', async () => {
    const ip = nextIp();
    for (let read = 0; read < RATE_LIMITS.default.limit; read += 1) {
      expect((await http(ip).get('/auth/session')).status).toBe(200);
    }
    expectRefused(await http(ip).get('/auth/session'));
  });

  it('never names a limit, a guess or an email in a refusal', () => {
    expect(refusals.length).toBeGreaterThanOrEqual(6);
    for (const res of refusals) {
      const { message } = apiErrorSchema.parse(res.body.error);
      expect(message).toMatch(
        /^Too many attempts\. Try again in \d+ (second|minute)s?\.$/,
      );
      expect(message).not.toMatch(/@|Zzyzx|signIn|account|guess/);
    }
  });
});
