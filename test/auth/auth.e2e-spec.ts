import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import {
  BAD_CREDENTIALS,
  EMAIL_TAKEN,
  HANDLE_TAKEN,
} from '@/auth/auth-flow.service.js';
import { setupDocs } from '@/docs/setup-docs.js';
import { PrismaService } from '@/prisma/prisma.service.js';

const PASSWORD = 'correct-horse';
const SESSION_COOKIE = 'lineup.session_token';

// Own prefix: e2e files run in parallel
const account = (tag: string, handle = `test-h-${tag}`) => ({
  email: `test-http-${tag}@lineup.test`,
  password: PASSWORD,
  handle,
});

const cookiesOf = (res: request.Response) =>
  [res.headers['set-cookie'] ?? []].flat();

// name=value pairs, ready for a Cookie header
const cookieHeader = (res: request.Response) =>
  cookiesOf(res)
    .map((c) => c.split(';')[0])
    .join('; ');

describe('Auth endpoints (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    setupDocs(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'test-http-' } },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('signs up, reads the session, signs out and back in', async () => {
    const signedUp = await http().post('/auth/sign-up').send(account('flow'));
    expect(signedUp.status).toBe(200);
    expect(signedUp.body).toEqual({
      success: true,
      data: {
        user: {
          id: expect.any(String),
          handle: 'test-h-flow',
          isGuest: false,
          emailVerified: false,
          tier: 'free',
        },
      },
    });
    const session = cookiesOf(signedUp).find((c) =>
      c.startsWith(`${SESSION_COOKIE}=`),
    );
    expect(session).toMatch(/HttpOnly/i);

    const cookie = cookieHeader(signedUp);
    const read = await http().get('/auth/session').set('Cookie', cookie);
    expect(read.body).toEqual(signedUp.body);

    const out = await http().post('/auth/sign-out').set('Cookie', cookie);
    expect(out.body).toEqual({ success: true, data: null });
    // The cookie is cleared and the session row is gone
    expect(cookiesOf(out).join()).toMatch(`${SESSION_COOKIE}=;`);
    const after = await http().get('/auth/session').set('Cookie', cookie);
    expect(after.body).toEqual({ success: true, data: null });

    const signedIn = await http()
      .post('/auth/sign-in')
      .send({ email: 'test-http-flow@lineup.test', password: PASSWORD });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.data.user.id).toBe(signedUp.body.data.user.id);
    const again = await http()
      .get('/auth/session')
      .set('Cookie', cookieHeader(signedIn));
    expect(again.body.data.user.handle).toBe('test-h-flow');
  });

  it('returns null with no cookie', async () => {
    const res = await http().get('/auth/session');
    expect(res.body).toEqual({ success: true, data: null });
  });

  describe('a stored session', () => {
    const DAY_MS = 86_400_000;

    // Signs up, then moves the session's expiry
    async function signedUpExpiring(tag: string, inMs: number) {
      const res = await http().post('/auth/sign-up').send(account(tag));
      await prisma.session.updateMany({
        where: { user: { email: `test-http-${tag}@lineup.test` } },
        data: { expiresAt: new Date(Date.now() + inMs) },
      });
      return cookieHeader(res);
    }

    it('is renewed, with a fresh cookie, once a day old', async () => {
      // 25 of 30 days left: past the 1-day update age
      const cookie = await signedUpExpiring('renew', 25 * DAY_MS);

      const res = await http().get('/auth/session').set('Cookie', cookie);

      expect(res.body.data.user.handle).toBe('test-h-renew');
      const renewed = cookiesOf(res).find((c) =>
        c.startsWith(`${SESSION_COOKIE}=`),
      );
      expect(renewed).toMatch(/Max-Age=2592000/);
      const [stored] = await prisma.session.findMany({
        where: { user: { email: 'test-http-renew@lineup.test' } },
      });
      expect(stored.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 29 * DAY_MS,
      );
    });

    it('reads as null and is cleared once expired', async () => {
      const cookie = await signedUpExpiring('expired', -60_000);

      const res = await http().get('/auth/session').set('Cookie', cookie);

      expect(res.body).toEqual({ success: true, data: null });
      expect(cookiesOf(res).join()).toMatch(`${SESSION_COOKIE}=;`);
      expect(
        await prisma.session.count({
          where: { user: { email: 'test-http-expired@lineup.test' } },
        }),
      ).toBe(0);
    });
  });

  it('signs out without a session', async () => {
    const res = await http().post('/auth/sign-out');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: null });
  });

  it.each([
    [
      'a wrong password',
      { email: 'test-http-known@lineup.test', password: 'x'.repeat(8) },
    ],
    [
      'an unknown email',
      { email: 'test-http-ghost@lineup.test', password: PASSWORD },
    ],
  ])('refuses %s with one message', async (_, body) => {
    await http().post('/auth/sign-up').send(account('known'));
    const res = await http().post('/auth/sign-in').send(body);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({
      code: 'unauthorized',
      message: BAD_CREDENTIALS,
    });
    expect(cookiesOf(res)).toEqual([]);
  });

  it.each([
    ['the same handle', 'test-h-taken'],
    ['the handle in another case', 'TEST-H-Taken'],
  ])('refuses %s', async (_, handle) => {
    await http().post('/auth/sign-up').send(account('first', 'test-h-taken'));
    const res = await http()
      .post('/auth/sign-up')
      .send(account('second', handle));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'invalid_input',
      message: HANDLE_TAKEN,
    });
  });

  it('refuses an email that is already registered', async () => {
    await http().post('/auth/sign-up').send(account('dup', 'test-h-one'));
    const res = await http()
      .post('/auth/sign-up')
      .send({
        ...account('dup', 'test-h-two'),
        email: 'TEST-HTTP-dup@lineup.test',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'invalid_input',
      message: EMAIL_TAKEN,
    });
    expect(await prisma.user.count({ where: { handle: 'test-h-two' } })).toBe(
      0,
    );
  });

  it.each([
    ['a missing body', undefined],
    ['a short password', { ...account('weak'), password: 'x'.repeat(7) }],
    ['a bad email', { ...account('bad'), email: 'not-an-email' }],
    ['a spaced handle', account('spaced', 'has space')],
  ])('refuses %s as invalid input', async (_, body) => {
    const res = await http().post('/auth/sign-up').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_input');
  });

  it('never echoes the email or handle in an error', async () => {
    await http().post('/auth/sign-up').send(account('echo', 'test-h-echo'));
    const res = await http()
      .post('/auth/sign-up')
      .send(account('echo', 'test-h-echo'));
    expect(JSON.stringify(res.body)).not.toMatch(/test-h-echo|test-http-echo/);
  });

  it('ignores a form-encoded sign-in', async () => {
    const res = await http()
      .post('/auth/sign-in')
      .type('form')
      .send({ email: 'test-http-form@lineup.test', password: PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_input');
  });

  it.each(['/api/auth/sign-up/email', '/api/auth/sign-in/email'])(
    'switches off the native %s route',
    async (path) => {
      const res = await http().post(path).send(account('native'));
      expect(res.status).toBe(404);
      expect(
        await prisma.user.count({ where: { handle: 'test-h-native' } }),
      ).toBe(0);
    },
  );

  it('documents all four routes', async () => {
    const res = await http().get('/docs/openapi.json');
    const paths = res.body.paths as Record<string, Record<string, unknown>>;
    expect(Object.keys(paths['/auth/session'])).toEqual(['get']);
    for (const path of ['/auth/sign-up', '/auth/sign-in', '/auth/sign-out']) {
      expect(Object.keys(paths[path])).toEqual(['post']);
    }
    expect(res.body.components.schemas).toHaveProperty('SessionOrNull');
  });
});
