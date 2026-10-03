import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import {
  ALREADY_REGISTERED,
  EMAIL_TAKEN,
  HANDLE_TAKEN,
  NO_SESSION,
  SIGN_OUT_FIRST,
} from '@/auth/auth-flow.service.js';
import { GUEST_EMAIL_DOMAIN } from '@/auth/auth.factory.js';
import { generateGuestHandle } from '@/auth/guest-handle.js';
import { setupDocs } from '@/docs/setup-docs.js';
import { PrismaService } from '@/prisma/prisma.service.js';

// Lets one test force a handle collision
vi.mock('@/auth/guest-handle.js', async (importActual) => {
  const actual = await importActual<typeof import('@/auth/guest-handle.js')>();
  return { generateGuestHandle: vi.fn(actual.generateGuestHandle) };
});

const PASSWORD = 'correct-horse';
const GUEST_HANDLE = /^guest-[0-9a-z]{8}$/;
const SLUG = 'test-guest-history';

// Own prefix: e2e files run in parallel
const account = (tag: string, handle = `test-g-${tag}`) => ({
  email: `test-guest-${tag}@lineup.test`,
  password: PASSWORD,
  handle,
});

const cookieHeader = (res: request.Response) =>
  [res.headers['set-cookie'] ?? []]
    .flat()
    .map((c) => c.split(';')[0])
    .join('; ');

describe('Guest endpoints (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const created: string[] = [];

  // Starts a guest; its id is tracked for clean-up
  async function asGuest() {
    const res = await http().post('/auth/guest');
    created.push(res.body.data.user.id);
    return { res, cookie: cookieHeader(res), id: res.body.data.user.id };
  }

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
    await prisma.gameSession.deleteMany({ where: { match: { slug: SLUG } } });
    await prisma.user.deleteMany({
      where: {
        OR: [
          { id: { in: created.splice(0) } },
          { email: { startsWith: 'test-guest-' } },
        ],
      },
    });
  });

  afterAll(async () => {
    await prisma.match.deleteMany({ where: { slug: SLUG } });
    await prisma.season.deleteMany({
      where: { competition: { slug: `${SLUG}-comp` } },
    });
    await prisma.competition.deleteMany({ where: { slug: `${SLUG}-comp` } });
    await app.close();
  });

  it('starts a guest with a generated handle and a cookie', async () => {
    const { res, cookie, id } = await asGuest();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        user: {
          id: expect.any(String),
          handle: expect.stringMatching(GUEST_HANDLE),
          isGuest: true,
          tier: 'free',
        },
      },
    });
    const read = await http().get('/auth/session').set('Cookie', cookie);
    expect(read.body).toEqual(res.body);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(stored.isAnonymous).toBe(true);
    expect(stored.email.endsWith(`@${GUEST_EMAIL_DOMAIN}`)).toBe(true);
    expect(stored.name).toBe(stored.handle);
    expect(await prisma.account.count({ where: { userId: id } })).toBe(0);
  });

  it('returns the same guest to a second call', async () => {
    const { cookie, id } = await asGuest();

    const again = await http().post('/auth/guest').set('Cookie', cookie);

    expect(again.status).toBe(200);
    expect(again.body.data.user.id).toBe(id);
    expect(
      await prisma.user.count({
        where: { handle: again.body.data.user.handle },
      }),
    ).toBe(1);
  });

  it('retries a guest whose generated handle is taken', async () => {
    const handle = vi.mocked(generateGuestHandle);
    handle.mockClear().mockReturnValueOnce('guest-e2ec0ll1');
    const first = await asGuest();
    expect(first.res.body.data.user.handle).toBe('guest-e2ec0ll1');

    handle.mockReturnValueOnce('guest-e2ec0ll1');
    const { res } = await asGuest();

    // Collided once, then a fresh handle
    expect(handle).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(200);
    expect(res.body.data.user.handle).toMatch(GUEST_HANDLE);
    expect(res.body.data.user.handle).not.toBe('guest-e2ec0ll1');
  });

  it('refuses a guest to someone signed in with an account', async () => {
    const signedUp = await http().post('/auth/sign-up').send(account('reg'));

    const res = await http()
      .post('/auth/guest')
      .set('Cookie', cookieHeader(signedUp));

    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({
      code: 'forbidden',
      message: SIGN_OUT_FIRST,
    });
  });

  describe('upgrade', () => {
    // Commits a solo session and stats for the guest
    async function giveHistory(userId: string) {
      const competition = await prisma.competition.upsert({
        where: { slug: `${SLUG}-comp` },
        update: {},
        create: { slug: `${SLUG}-comp`, kind: 'league', name: 'Crown League' },
      });
      const season = await prisma.season.upsert({
        where: {
          competitionId_label: {
            competitionId: competition.id,
            label: '2002-03',
          },
        },
        update: {},
        create: {
          competitionId: competition.id,
          label: '2002-03',
          startYear: 2002,
        },
      });
      const match = await prisma.match.upsert({
        where: { slug: SLUG },
        update: {},
        create: {
          slug: SLUG,
          seasonId: season.id,
          date: new Date('2003-05-03'),
        },
      });
      await prisma.gameSession.create({
        data: {
          mode: 'solo',
          matchId: match.id,
          participants: { create: { userId, seat: 0 } },
        },
      });
      await prisma.userStats.create({ data: { userId, played: 1 } });
    }

    it('keeps the user id, its history, and signs in with the new password', async () => {
      const guest = await asGuest();
      await giveHistory(guest.id);

      const res = await http()
        .post('/auth/upgrade')
        .set('Cookie', guest.cookie)
        .send(account('up', 'test-g-up'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: {
          user: {
            id: guest.id,
            handle: 'test-g-up',
            isGuest: false,
            tier: 'free',
          },
        },
      });
      expect(
        await prisma.gameParticipant.count({ where: { userId: guest.id } }),
      ).toBe(1);
      expect(
        await prisma.userStats.findUnique({ where: { userId: guest.id } }),
      ).toMatchObject({ played: 1 });

      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: guest.id },
        include: { accounts: true },
      });
      expect(stored).toMatchObject({
        email: 'test-guest-up@lineup.test',
        isAnonymous: false,
        emailVerified: false,
      });
      expect(stored.accounts).toHaveLength(1);
      expect(stored.accounts[0].providerId).toBe('credential');
      expect(stored.accounts[0].password).not.toContain(PASSWORD);

      const fresh = await http()
        .get('/auth/session')
        .set('Cookie', cookieHeader(res));
      expect(fresh.body.data.user).toMatchObject({
        id: guest.id,
        isGuest: false,
      });

      const signedIn = await http()
        .post('/auth/sign-in')
        .send({ email: 'test-guest-up@lineup.test', password: PASSWORD });
      expect(signedIn.body.data.user.id).toBe(guest.id);
    });

    it('stops the old guest cookie working', async () => {
      const guest = await asGuest();
      await http()
        .post('/auth/upgrade')
        .set('Cookie', guest.cookie)
        .send(account('old'));

      const read = await http()
        .get('/auth/session')
        .set('Cookie', guest.cookie);

      expect(read.body).toEqual({ success: true, data: null });
      expect(await prisma.session.count({ where: { userId: guest.id } })).toBe(
        1,
      );
    });

    it('stores the email in lower case', async () => {
      const guest = await asGuest();

      await http()
        .post('/auth/upgrade')
        .set('Cookie', guest.cookie)
        .send({ ...account('case'), email: 'TEST-GUEST-Case@lineup.test' });

      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: guest.id },
      });
      expect(stored.email).toBe('test-guest-case@lineup.test');
    });

    it('refuses with no session', async () => {
      const res = await http().post('/auth/upgrade').send(account('none'));

      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({
        code: 'unauthorized',
        message: NO_SESSION,
      });
    });

    it('refuses an account that is already registered', async () => {
      const signedUp = await http().post('/auth/sign-up').send(account('reg'));

      const res = await http()
        .post('/auth/upgrade')
        .set('Cookie', cookieHeader(signedUp))
        .send(account('again', 'test-g-again'));

      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({
        code: 'forbidden',
        message: ALREADY_REGISTERED,
      });
    });

    it.each([
      ['a taken handle', { handle: 'test-g-taken' }, HANDLE_TAKEN],
      [
        'a taken handle in another case',
        { handle: 'TEST-G-Taken' },
        HANDLE_TAKEN,
      ],
      ['a used email', { email: 'TEST-GUEST-taken@lineup.test' }, EMAIL_TAKEN],
    ])('refuses %s and stays a guest', async (_, change, message) => {
      await http().post('/auth/sign-up').send(account('taken'));
      const guest = await asGuest();

      const res = await http()
        .post('/auth/upgrade')
        .set('Cookie', guest.cookie)
        .send({ ...account('fresh'), ...change });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ code: 'invalid_input', message });
      const read = await http()
        .get('/auth/session')
        .set('Cookie', guest.cookie);
      expect(read.body.data.user).toMatchObject({
        id: guest.id,
        isGuest: true,
      });
    });

    it('refuses a bad body', async () => {
      const guest = await asGuest();

      const res = await http()
        .post('/auth/upgrade')
        .set('Cookie', guest.cookie)
        .send({ email: 'not-an-email', password: 'short', handle: 'a b' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_input');
    });
  });

  it('keeps the guest row when a guest signs in to an account', async () => {
    await http().post('/auth/sign-up').send(account('owner'));
    const guest = await asGuest();

    const res = await http()
      .post('/auth/sign-in')
      .set('Cookie', guest.cookie)
      .send({ email: 'test-guest-owner@lineup.test', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({
      handle: 'test-g-owner',
      isGuest: false,
    });
    expect(
      await prisma.user.findUnique({ where: { id: guest.id } }),
    ).toMatchObject({ isAnonymous: true });
  });

  it.each(['/api/auth/sign-in/anonymous', '/api/auth/delete-anonymous-user'])(
    'closes the native route %s',
    async (path) => {
      const res = await http().post(path);
      expect(res.status).toBe(404);
    },
  );

  it('documents both routes in OpenAPI', async () => {
    const res = await http().get('/docs/openapi.json');
    const paths = res.body.paths as Record<string, { post?: object }>;

    expect(paths['/auth/guest']?.post).toBeDefined();
    expect(paths['/auth/upgrade']?.post).toMatchObject({
      requestBody: {
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpgradeGuestRequest' },
          },
        },
      },
    });
  });
});
