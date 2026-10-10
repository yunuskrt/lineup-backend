import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { NO_SESSION } from '@/auth/auth-flow.service.js';
import { GatewayTokenService } from '@/auth/gateway-token.service.js';
import { ORIGIN_REFUSED } from '@/common/origin-check.middleware.js';
import { setupDocs } from '@/docs/setup-docs.js';
import { PrismaService } from '@/prisma/prisma.service.js';

const PASSWORD = 'correct-horse';

// Own prefix: e2e files run in parallel
const account = (tag: string) => ({
  email: `test-bearer-${tag}@lineup.test`,
  password: PASSWORD,
  handle: `test-b-${tag}`,
});

const tokenOf = (res: request.Response): string => {
  const token = res.headers['set-auth-token'] as string | undefined;
  if (!token) throw new Error('No set-auth-token on the response');
  return token;
};

const cookieHeader = (res: request.Response) =>
  [res.headers['set-cookie'] ?? []]
    .flat()
    .map((c) => c.split(';')[0])
    .join('; ');

describe('Bearer tokens (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let gateway: GatewayTokenService;
  const http = () => request(app.getHttpServer());
  const guests: string[] = [];

  const bearer = (token: string) => `Bearer ${token}`;
  const sessionFor = (token: string) =>
    http().get('/auth/session').set('Authorization', bearer(token));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    setupDocs(app);
    await app.init();
    prisma = app.get(PrismaService);
    gateway = app.get(GatewayTokenService);
  });

  afterEach(async () => {
    await prisma.user.deleteMany({
      where: {
        OR: [
          { id: { in: guests.splice(0) } },
          { email: { startsWith: 'test-bearer-' } },
        ],
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('hands a token on sign-up, sign-in and guest', async () => {
    const signUp = await http().post('/auth/sign-up').send(account('issue'));
    const signIn = await http()
      .post('/auth/sign-in')
      .send({ email: 'test-bearer-issue@lineup.test', password: PASSWORD });
    const guest = await http().post('/auth/guest');
    guests.push(guest.body.data.user.id);

    for (const res of [signUp, signIn, guest]) {
      expect(res.status).toBe(200);
      expect(tokenOf(res)).toMatch(/\./);
    }
    // The web's cookie is still set
    expect(cookieHeader(signUp)).toMatch(/lineup\.session_token=/);
  });

  it('never exposes the token to browser scripts', async () => {
    const web = new URL(process.env.WEB_APP_URL ?? '').origin;
    await http().post('/auth/sign-up').send(account('web'));

    const res = await http()
      .post('/auth/sign-in')
      .set('Origin', web)
      .send({ email: 'test-bearer-web@lineup.test', password: PASSWORD });

    expect(res.headers['set-auth-token']).toBeDefined();
    // Not exposed by CORS: page scripts can't read it
    expect(res.headers['access-control-expose-headers']).toBeUndefined();
  });

  it('reads the session from the bearer token alone', async () => {
    const signUp = await http().post('/auth/sign-up').send(account('read'));

    const res = await sessionFor(tokenOf(signUp));

    expect(res.body.data.user).toEqual(signUp.body.data.user);
  });

  it('gets a gateway token by bearer, for the same user', async () => {
    const guest = await http().post('/auth/guest');
    guests.push(guest.body.data.user.id);

    const res = await http()
      .get('/auth/token')
      .set('Authorization', bearer(tokenOf(guest)));

    expect(res.status).toBe(200);
    expect(await gateway.verify(res.body.data.token as string)).toEqual({
      userId: guest.body.data.user.id,
    });
  });

  it('upgrades a guest by bearer, with a fresh token', async () => {
    const guest = await http().post('/auth/guest');
    guests.push(guest.body.data.user.id);
    const oldToken = tokenOf(guest);

    const res = await http()
      .post('/auth/upgrade')
      .set('Authorization', bearer(oldToken))
      .send(account('up'));

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({
      id: guest.body.data.user.id,
      isGuest: false,
    });
    const newToken = tokenOf(res);
    expect(newToken).not.toBe(oldToken);
    expect((await sessionFor(newToken)).body.data.user.id).toBe(
      guest.body.data.user.id,
    );
    expect((await sessionFor(oldToken)).body.data).toBeNull();
  });

  it('signs out by bearer, after which the token is dead', async () => {
    const signUp = await http().post('/auth/sign-up').send(account('out'));
    const token = tokenOf(signUp);

    const out = await http()
      .post('/auth/sign-out')
      .set('Authorization', bearer(token));

    expect(out.status).toBe(200);
    expect(out.headers['set-auth-token']).toBeUndefined();
    expect((await sessionFor(token)).body.data).toBeNull();
  });

  describe('refuses a token that is', () => {
    async function liveToken(tag: string) {
      const res = await http().post('/auth/sign-up').send(account(tag));
      return tokenOf(res);
    }

    it('unsigned', async () => {
      const [unsigned] = (await liveToken('unsigned')).split('.');
      expect((await sessionFor(unsigned)).body.data).toBeNull();
    });

    it('tampered with', async () => {
      const token = await liveToken('tampered');
      const last = token.at(-1) === 'A' ? 'B' : 'A';
      expect(
        (await sessionFor(`${token.slice(0, -1)}${last}`)).body.data,
      ).toBeNull();
    });

    it('for a deleted session', async () => {
      const token = await liveToken('gone');
      await prisma.session.deleteMany({
        where: { user: { email: 'test-bearer-gone@lineup.test' } },
      });
      expect((await sessionFor(token)).body.data).toBeNull();
    });

    it('sent to a guarded route', async () => {
      const res = await http()
        .get('/auth/token')
        .set('Authorization', bearer('not-a-real-token.sig'));

      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({
        code: 'unauthorized',
        message: NO_SESSION,
      });
    });
  });

  describe('origin check', () => {
    it('lets a bearer write with no Origin through, as mobile sends it', async () => {
      const signUp = await http().post('/auth/sign-up').send(account('mob'));

      const res = await http()
        .post('/auth/sign-out')
        .set('Authorization', bearer(tokenOf(signUp)));

      expect(res.status).toBe(200);
    });

    it('refuses a bearer write from an untrusted Origin', async () => {
      const signUp = await http().post('/auth/sign-up').send(account('evil'));
      const token = tokenOf(signUp);

      const res = await http()
        .post('/auth/sign-out')
        .set('Authorization', bearer(token))
        .set('Origin', 'https://evil.example');

      expect(res.status).toBe(403);
      expect(res.body.error.message).toBe(ORIGIN_REFUSED);
      expect((await sessionFor(token)).body.data).not.toBeNull();
    });
  });

  it('lets the bearer token win over a cookie', async () => {
    const cookieUser = await http().post('/auth/sign-up').send(account('ck'));
    const bearerUser = await http().post('/auth/sign-up').send(account('br'));

    const res = await http()
      .get('/auth/session')
      .set('Cookie', cookieHeader(cookieUser))
      .set('Authorization', bearer(tokenOf(bearerUser)));

    expect(res.body.data.user.id).toBe(bearerUser.body.data.user.id);
  });

  it('documents the bearer scheme and the token header', async () => {
    const res = await http().get('/docs/openapi.json');
    const doc = res.body as {
      paths: Record<
        string,
        Record<
          string,
          {
            security?: unknown;
            responses: Record<string, { headers?: unknown }>;
          }
        >
      >;
      components: { securitySchemes: Record<string, unknown> };
    };

    expect(doc.components.securitySchemes.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(doc.paths['/auth/token'].get.security).toEqual([
      { session: [] },
      { bearer: [] },
    ]);
    for (const path of [
      '/auth/sign-up',
      '/auth/sign-in',
      '/auth/guest',
      '/auth/upgrade',
    ]) {
      expect(doc.paths[path].post.responses['200'].headers).toHaveProperty(
        'set-auth-token',
      );
    }
  });
});
