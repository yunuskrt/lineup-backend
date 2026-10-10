import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { ORIGIN_REFUSED } from '@/common/origin-check.middleware.js';
import { ENV } from '@/config/config.module.js';
import { applyCors } from '@/config/cors.js';
import type { Env } from '@/config/env.schema.js';
import { PrismaService } from '@/prisma/prisma.service.js';

const EVIL = 'https://evil.example';

// Own prefix: e2e files run in parallel
const account = (tag: string) => ({
  email: `test-cors-${tag}@lineup.test`,
  password: 'correct-horse',
  handle: `test-co-${tag}`,
});

const cookieHeader = (res: request.Response) =>
  [res.headers['set-cookie'] ?? []]
    .flat()
    .map((c) => c.split(';')[0])
    .join('; ');

describe('CORS and origin check (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let web: string;
  const http = () => request(app.getHttpServer());
  const guests: string[] = [];

  const preflight = (path: string, origin: string, headers = 'content-type') =>
    http()
      .options(path)
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', headers);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    // The same setup as main.ts, before init
    const env = moduleRef.get<Env>(ENV);
    web = env.WEB_APP_URL;
    applyCors(app, env);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    await prisma.user.deleteMany({
      where: {
        OR: [
          { id: { in: guests.splice(0) } },
          { email: { startsWith: 'test-cors-' } },
        ],
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('preflight', () => {
    it('allows the web app, with credentials and the two headers', async () => {
      const res = await preflight('/auth/sign-in', web);

      expect(res.status).toBe(204);
      expect(res.headers).toMatchObject({
        'access-control-allow-origin': web,
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'GET,POST',
        'access-control-allow-headers': 'Content-Type,Authorization',
        'access-control-max-age': '600',
      });
    });

    it('gives any other origin no allow header', async () => {
      const res = await preflight('/auth/sign-in', EVIL);

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('never echoes a header outside the list', async () => {
      const res = await preflight('/auth/sign-in', web, 'x-anything');

      expect(res.headers['access-control-allow-headers']).toBe(
        'Content-Type,Authorization',
      );
    });

    it("answers for Better Auth's own routes too", async () => {
      const allowed = await preflight('/api/auth/ok', web);
      const refused = await preflight('/api/auth/ok', EVIL);

      expect(allowed.headers['access-control-allow-origin']).toBe(web);
      expect(refused.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  it('marks a credentialed read from the web app', async () => {
    const res = await http().get('/auth/session').set('Origin', web);

    expect(res.headers['access-control-allow-origin']).toBe(web);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers.vary).toMatch(/Origin/);
    expect(res.headers['access-control-expose-headers']).toBeUndefined();
  });

  describe('origin check', () => {
    async function signedUp(tag: string) {
      const res = await http().post('/auth/sign-up').send(account(tag));
      return cookieHeader(res);
    }

    it('refuses a cookie write from an untrusted origin, keeping the session', async () => {
      const cookie = await signedUp('evil');

      const res = await http()
        .post('/auth/sign-out')
        .set('Cookie', cookie)
        .set('Origin', EVIL);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        success: false,
        error: {
          code: 'forbidden',
          message: ORIGIN_REFUSED,
          retryAfterMs: null,
        },
      });
      const session = await http().get('/auth/session').set('Cookie', cookie);
      expect(session.body.data.user.handle).toBe('test-co-evil');
    });

    it('refuses by Referer when there is no Origin', async () => {
      const cookie = await signedUp('ref');

      const res = await http()
        .post('/auth/sign-out')
        .set('Cookie', cookie)
        .set('Referer', `${EVIL}/page`);

      expect(res.status).toBe(403);
    });

    it.each([
      ['from the web app', (r: request.Test, w: string) => r.set('Origin', w)],
      ['with no Origin at all', (r: request.Test) => r],
    ])('lets a cookie write through %s', async (_, withOrigin) => {
      const cookie = await signedUp('ok');

      const res = await withOrigin(
        http().post('/auth/sign-out').set('Cookie', cookie),
        web,
      );

      expect(res.status).toBe(200);
      const session = await http().get('/auth/session').set('Cookie', cookie);
      expect(session.body.data).toBeNull();
    });

    // A foreign form can't swap a player into a guest
    it('refuses a cookie-less write from an untrusted origin', async () => {
      const res = await http().post('/auth/guest').set('Origin', EVIL);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({
        code: 'forbidden',
        message: ORIGIN_REFUSED,
      });
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('lets a cookie-less write with no Origin through', async () => {
      const res = await http().post('/auth/guest');
      guests.push(res.body.data.user.id);

      expect(res.status).toBe(200);
      expect(res.body.data.user.isGuest).toBe(true);
    });
  });
});
