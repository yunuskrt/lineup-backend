import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { z } from 'zod';
import { AppModule } from '@/app.module.js';
import { NO_SESSION } from '@/auth/auth-flow.service.js';
import { CurrentUser } from '@/auth/current-user.decorator.js';
import { Public } from '@/auth/public.decorator.js';
import { ContractResponse } from '@/common/contract-response.js';
import { type User, userSchema } from '@/contract/auth.js';
import { PrismaService } from '@/prisma/prisma.service.js';

const SESSION_COOKIE = 'lineup.session_token';
const DAY_MS = 86_400_000;

// Test-only routes: one guarded, one public
@Controller('test-guard')
class ProbeController {
  @Get('me')
  @ContractResponse(userSchema)
  me(@CurrentUser() user: User) {
    return user;
  }

  @Public()
  @Get('open')
  @ContractResponse(z.null())
  open() {
    return null;
  }
}

// Own prefix: e2e files run in parallel
const account = (tag: string) => ({
  email: `test-guard-${tag}@lineup.test`,
  password: 'correct-horse',
  handle: `test-gd-${tag}`,
});

const cookiesOf = (res: request.Response) =>
  [res.headers['set-cookie'] ?? []].flat();

const cookieHeader = (res: request.Response) =>
  cookiesOf(res)
    .map((c) => c.split(';')[0])
    .join('; ');

describe('Session guard (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const guests: string[] = [];

  // Signs up, then moves the session's expiry
  async function signedUpExpiring(tag: string, inMs: number) {
    const res = await http().post('/auth/sign-up').send(account(tag));
    await prisma.session.updateMany({
      where: { user: { email: `test-guard-${tag}@lineup.test` } },
      data: { expiresAt: new Date(Date.now() + inMs) },
    });
    return cookieHeader(res);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    await prisma.user.deleteMany({
      where: {
        OR: [
          { id: { in: guests.splice(0) } },
          { email: { startsWith: 'test-guard-' } },
        ],
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses a guarded route with no session', async () => {
    const res = await http().get('/test-guard/me');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'unauthorized', message: NO_SESSION, retryAfterMs: null },
    });
  });

  it('hands a guest to the route', async () => {
    const guest = await http().post('/auth/guest');
    guests.push(guest.body.data.user.id);

    const res = await http()
      .get('/test-guard/me')
      .set('Cookie', cookieHeader(guest));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(guest.body.data.user);
    expect(res.body.data.isGuest).toBe(true);
  });

  it('hands a registered user to the route, with no email', async () => {
    const signedUp = await http().post('/auth/sign-up').send(account('reg'));
    const cookie = cookieHeader(signedUp);

    const res = await http().get('/test-guard/me').set('Cookie', cookie);
    const session = await http().get('/auth/session').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(session.body.data.user);
    expect(JSON.stringify(res.body)).not.toContain('@lineup.test');
  });

  it('lets a public route through with no session', async () => {
    const res = await http().get('/test-guard/open');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: null });
  });

  it('still answers an unknown route with 404, not 401', async () => {
    const res = await http().get('/test-guard/nowhere');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('renews an ageing session, with a fresh cookie', async () => {
    // 25 of 30 days left: past the 1-day update age
    const cookie = await signedUpExpiring('renew', 25 * DAY_MS);

    const res = await http().get('/test-guard/me').set('Cookie', cookie);

    expect(res.status).toBe(200);
    const renewed = cookiesOf(res).find((c) =>
      c.startsWith(`${SESSION_COOKIE}=`),
    );
    expect(renewed).toMatch(/Max-Age=2592000/);
    const [stored] = await prisma.session.findMany({
      where: { user: { email: 'test-guard-renew@lineup.test' } },
    });
    expect(stored.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 29 * DAY_MS,
    );
  });

  it('refuses an expired session and clears its cookie', async () => {
    const cookie = await signedUpExpiring('expired', -60_000);

    const res = await http().get('/test-guard/me').set('Cookie', cookie);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
    expect(cookiesOf(res).join()).toMatch(`${SESSION_COOKIE}=;`);
  });

  it('keeps every auth route open without a session', async () => {
    const signUp = await http().post('/auth/sign-up').send(account('open'));
    const signIn = await http()
      .post('/auth/sign-in')
      .send({
        email: 'test-guard-open@lineup.test',
        password: 'correct-horse',
      });
    const guest = await http().post('/auth/guest');
    guests.push(guest.body.data.user.id);
    const session = await http().get('/auth/session');
    const signOut = await http().post('/auth/sign-out');

    for (const res of [signUp, signIn, guest, session, signOut]) {
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    }
  });
});
