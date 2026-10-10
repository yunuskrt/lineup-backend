import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { NO_SESSION } from '@/auth/auth-flow.service.js';
import { profileSchema } from '@/contract/profile.js';
import { setupDocs } from '@/docs/setup-docs.js';
import { PrismaService } from '@/prisma/prisma.service.js';

const ZERO_STATS = {
  played: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  accuracy: 0,
  bestStreak: 0,
  perfectClears: 0,
  favouriteClub: null,
};

// Own prefix: e2e files run in parallel
const account = (tag: string) => ({
  email: `test-profile-${tag}@lineup.test`,
  password: 'correct-horse',
  handle: `test-pr-${tag}`,
});

const cookieHeader = (res: request.Response) =>
  [res.headers['set-cookie'] ?? []]
    .flat()
    .map((c) => c.split(';')[0])
    .join('; ');

describe('Profile (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const guests: string[] = [];

  async function signedUp(tag: string) {
    const res = await http().post('/auth/sign-up').send(account(tag));
    return {
      cookie: cookieHeader(res),
      token: res.headers['set-auth-token'] as string,
      user: res.body.data.user as { id: string },
    };
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
    // user_stats cascades from the user
    await prisma.user.deleteMany({
      where: {
        OR: [
          { id: { in: guests.splice(0) } },
          { email: { startsWith: 'test-profile-' } },
        ],
      },
    });
    await prisma.club.deleteMany({
      where: { slug: { startsWith: 'test-profile-' } },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses a request with no session', async () => {
    const res = await http().get('/profile');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'unauthorized', message: NO_SESSION, retryAfterMs: null },
    });
  });

  it('gives a new account zero stats', async () => {
    const { cookie, user } = await signedUp('new');

    const res = await http().get('/profile').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      user: {
        id: user.id,
        handle: 'test-pr-new',
        isGuest: false,
        emailVerified: false,
        tier: 'free',
      },
      stats: ZERO_STATS,
    });
    expect(await prisma.userStats.count({ where: { userId: user.id } })).toBe(
      0,
    );
  });

  it('sends the stored stats, with the favourite club', async () => {
    const { cookie, user } = await signedUp('stats');
    const club = await prisma.club.create({
      data: {
        slug: 'test-profile-club',
        kind: 'club',
        name: 'Test Profile FC',
        shortName: 'TPF',
        crestKey: 'crests/test-profile-club.svg',
      },
    });
    await prisma.userStats.create({
      data: {
        userId: user.id,
        played: 9,
        wins: 3,
        losses: 2,
        draws: 1,
        perfectClears: 1,
        bestStreak: 6,
        correctGuesses: 18,
        totalGuesses: 24,
        favouriteClubId: club.id,
      },
    });

    const res = await http().get('/profile').set('Cookie', cookie);

    expect(res.body.data.stats).toEqual({
      played: 9,
      wins: 3,
      losses: 2,
      draws: 1,
      accuracy: 0.75,
      bestStreak: 6,
      perfectClears: 1,
      favouriteClub: {
        id: club.id,
        name: 'Test Profile FC',
        shortName: 'TPF',
        crestUrl: null,
      },
    });
    expect(profileSchema.safeParse(res.body.data).success).toBe(true);
  });

  it('gives a guest a profile', async () => {
    const guest = await http().post('/auth/guest');
    guests.push(guest.body.data.user.id);

    const res = await http().get('/profile').set('Cookie', cookieHeader(guest));

    expect(res.status).toBe(200);
    expect(res.body.data.user).toEqual(guest.body.data.user);
    expect(res.body.data.user.isGuest).toBe(true);
    expect(res.body.data.stats).toEqual(ZERO_STATS);
  });

  it('reads the same profile by bearer token as by cookie', async () => {
    const { cookie, token } = await signedUp('bearer');

    const byCookie = await http().get('/profile').set('Cookie', cookie);
    const byBearer = await http()
      .get('/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(byBearer.status).toBe(200);
    expect(byBearer.body).toEqual(byCookie.body);
  });

  it('documents the route, both credentials and the Profile schema', async () => {
    const res = await http().get('/docs/openapi.json');
    const doc = res.body as {
      paths: Record<string, { get?: Record<string, unknown> }>;
    };
    const route = doc.paths['/profile']?.get;

    expect(route?.security).toEqual([{ session: [] }, { bearer: [] }]);
    expect(route?.responses).toMatchObject({
      '200': {
        content: {
          'application/json': {
            schema: {
              properties: { data: { $ref: '#/components/schemas/Profile' } },
            },
          },
        },
      },
      '401': {},
    });
  });
});
