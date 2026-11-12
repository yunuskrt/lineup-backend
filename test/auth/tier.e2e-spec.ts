import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { CONFIG_CACHE_CONTROL } from '@/config/config.controller.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import { loadEnv } from '@/config/load-env.js';
import { PROTOCOL_VERSION } from '@/contract/protocol.js';
import { SocketAuthService } from '@/duel/socket-auth.service.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { setUserTier } from '@scripts/user-tier/user-tier.js';

const PASSWORD = 'correct-horse';

// Own prefix: e2e files run in parallel
const account = (tag: string) => ({
  email: `test-tier-${tag}@lineup.test`,
  password: PASSWORD,
  handle: `test-t-${tag}`,
});

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

describe('Tier and PRO_ENABLED (e2e)', () => {
  let on: INestApplication<App>;
  let off: INestApplication<App>;
  let prisma: PrismaService;
  const created: string[] = [];

  beforeAll(async () => {
    [on, off] = await Promise.all([boot(true), boot(false)]);
    prisma = on.get(PrismaService);
  });

  afterEach(async () => {
    await prisma.user.deleteMany({
      where: {
        OR: [
          { id: { in: created.splice(0) } },
          { email: { startsWith: 'test-tier-' } },
        ],
      },
    });
  });

  afterAll(async () => {
    await Promise.all([on.close(), off.close()]);
  });

  async function asGuest(app: INestApplication<App>) {
    const res = await request(app.getHttpServer()).post('/auth/guest');
    created.push(res.body.data.user.id);
    return { res, cookie: cookieHeader(res), id: res.body.data.user.id };
  }

  // Each call that returns a User, in one pass
  async function tiersFrom(app: INestApplication<App>, tag: string) {
    const http = () => request(app.getHttpServer());
    const guest = await asGuest(app);
    const upgrade = await http()
      .post('/auth/upgrade')
      .set('Cookie', guest.cookie)
      .send(account(`${tag}-up`));
    const signUp = await http().post('/auth/sign-up').send(account(tag));
    const { email } = account(tag);
    const signIn = await http()
      .post('/auth/sign-in')
      .send({ email, password: PASSWORD });
    const cookie = cookieHeader(signIn);
    const session = await http().get('/auth/session').set('Cookie', cookie);
    const profile = await http().get('/profile').set('Cookie', cookie);
    const { data: token } = (
      await http().get('/auth/token').set('Cookie', cookie)
    ).body;
    const socket = await app
      .get(SocketAuthService)
      .authenticate({ token: token.token, protocolVersion: PROTOCOL_VERSION });
    return {
      guest: guest.res.body.data.user.tier,
      upgrade: upgrade.body.data.user.tier,
      signUp: signUp.body.data.user.tier,
      signIn: signIn.body.data.user.tier,
      session: session.body.data.user.tier,
      profile: profile.body.data.user.tier,
      socket: socket.tier,
    };
  }

  it.each([
    ['on', () => on, 'free'],
    ['off', () => off, 'pro'],
  ] as const)(
    'with the switch %s, a stored-free user reads %s everywhere',
    async (tag, app, expected) => {
      const tiers = await tiersFrom(app(), tag);
      expect(Object.values(tiers)).toEqual(Array(7).fill(expected));
      const stored = await prisma.user.findMany({
        where: { email: { startsWith: `test-tier-${tag}` } },
        select: { tier: true },
      });
      expect(stored.map((u) => u.tier)).toEqual(['free', 'free']);
    },
  );

  it('applies a stored tier on the next request, no new sign-in', async () => {
    const { cookie, id } = await asGuest(on);
    await prisma.user.update({ where: { id }, data: { tier: 'pro' } });

    const session = await request(on.getHttpServer())
      .get('/auth/session')
      .set('Cookie', cookie);

    expect(session.body.data.user.tier).toBe('pro');
  });

  it('keeps a Pro guest Pro after the upgrade', async () => {
    const { cookie, id } = await asGuest(on);
    await prisma.user.update({ where: { id }, data: { tier: 'pro' } });

    const upgrade = await request(on.getHttpServer())
      .post('/auth/upgrade')
      .set('Cookie', cookie)
      .send(account('keep'));

    expect(upgrade.status).toBe(200);
    expect(upgrade.body.data.user).toMatchObject({
      id,
      isGuest: false,
      tier: 'pro',
    });
    const profile = await request(on.getHttpServer())
      .get('/profile')
      .set('Cookie', cookieHeader(upgrade));
    expect(profile.body.data.user.tier).toBe('pro');
  });

  it("refuses a tier sent to Better Auth's update-user", async () => {
    const { cookie, id } = await asGuest(on);
    const env = on.get<Env>(ENV);

    const res = await request(on.getHttpServer())
      .post('/api/auth/update-user')
      .set('Cookie', cookie)
      .set('Origin', env.WEB_APP_URL)
      .send({ tier: 'pro' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'FIELD_NOT_ALLOWED' });
    const stored = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(stored.tier).toBe('free');
  });

  it.each([
    ['on', () => on, true],
    ['off', () => off, false],
  ] as const)(
    'GET /config with the switch %s, no session',
    async (_, app, proEnabled) => {
      const res = await request(app().getHttpServer()).get('/config');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { proEnabled } });
      expect(res.headers['cache-control']).toBe(CONFIG_CACHE_CONTROL);
      expect(res.headers['set-cookie']).toBeUndefined();
    },
  );

  describe('setUserTier (npm run user:tier)', () => {
    it('sets a tier by email', async () => {
      const signUp = await request(on.getHttpServer())
        .post('/auth/sign-up')
        .send(account('script'));

      const change = await setUserTier(
        prisma,
        { email: account('script').email },
        'pro',
      );

      expect(change).toEqual({
        handle: account('script').handle,
        before: 'free',
        after: 'pro',
      });
      const session = await request(on.getHttpServer())
        .get('/auth/session')
        .set('Cookie', cookieHeader(signUp));
      expect(session.body.data.user.tier).toBe('pro');
    });

    it('finds a guest by its handle, in any case', async () => {
      const { res, id } = await asGuest(on);
      const handle: string = res.body.data.user.handle;

      const change = await setUserTier(
        prisma,
        { handle: handle.toUpperCase() },
        'pro',
      );

      expect(change).toEqual({ handle, before: 'free', after: 'pro' });
      const stored = await prisma.user.findUniqueOrThrow({ where: { id } });
      expect(stored.tier).toBe('pro');
    });

    it('refuses an unknown user', async () => {
      expect(
        await setUserTier(prisma, { handle: 'test-t-nobody' }, 'pro'),
      ).toBeNull();
      expect(
        await setUserTier(prisma, { email: 'test-tier-nobody@x.test' }, 'pro'),
      ).toBeNull();
    });
  });
});
