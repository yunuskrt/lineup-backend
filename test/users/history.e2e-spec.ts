import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { NO_SESSION } from '@/auth/auth-flow.service.js';
import { historyPageSchema } from '@/contract/profile.js';
import type {
  DuelOutcome,
  GameStatus,
  SoloEndReason,
} from '@/generated/prisma/client.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { BAD_CURSOR } from '@/users/history.service.js';

const SLUG = 'test-history';
const BASE = Date.parse('2026-09-01T10:00:00.000Z');
const at = (minute: number) => new Date(BASE + minute * 60_000);

// Own prefix: e2e files run in parallel
const account = (tag: string) => ({
  email: `test-history-${tag}@lineup.test`,
  password: 'correct-horse',
  handle: `test-hi-${tag}`,
});

const cookieHeader = (res: request.Response) =>
  [res.headers['set-cookie'] ?? []]
    .flat()
    .map((c) => c.split(';')[0])
    .join('; ');

type Seat = { userId: string; lives?: number; outcome?: DuelOutcome | null };

type Game = {
  seats: Seat[];
  endedAt: Date;
  status?: GameStatus;
  soloEndReason?: SoloEndReason;
  // The seat that named each new starter
  foundBy?: number[];
};

describe('Profile history (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let matchId: string;
  let playerId: string;
  let clubIds: { home: string; away: string };
  const http = () => request(app.getHttpServer());
  const guests: string[] = [];

  async function signedUp(tag: string) {
    const res = await http().post('/auth/sign-up').send(account(tag));
    return {
      cookie: cookieHeader(res),
      id: res.body.data.user.id as string,
    };
  }

  const historyOf = (cookie: string, query = '') =>
    http().get(`/profile/history${query}`).set('Cookie', cookie);

  // Commits one game, with a round per new find
  async function play(game: Game): Promise<string> {
    const isOver = (game.status ?? 'over') === 'over';
    const mode = game.seats.length === 1 ? 'solo' : 'duel';
    const session = await prisma.gameSession.create({
      data: {
        mode,
        matchId,
        side: 'home',
        status: isOver ? 'over' : 'active',
        startedAt: new Date(game.endedAt.getTime() - 5 * 60_000),
        endedAt: isOver ? game.endedAt : null,
        soloEndReason:
          mode === 'solo' && isOver
            ? (game.soloEndReason ?? 'lives_out')
            : null,
        participants: {
          create: game.seats.map((seat, i) => ({
            userId: seat.userId,
            seat: i,
            livesRemaining: seat.lives ?? 0,
            duelOutcome: seat.outcome ?? null,
          })),
        },
      },
      include: { participants: { orderBy: { seat: 'asc' } } },
    });

    for (const [i, seat] of (game.foundBy ?? []).entries()) {
      const startedAt = new Date(session.startedAt.getTime() + i * 15_000);
      await prisma.gameRound.create({
        data: {
          sessionId: session.id,
          number: i + 1,
          participantId: session.participants[seat].id,
          startedAt,
          endsAt: new Date(startedAt.getTime() + 15_000),
          endedAt: new Date(startedAt.getTime() + 5_000),
          endReason: 'found',
          // A miss and a repeat: neither counts as found
          guesses: {
            create: [
              { text: 'Nobody', outcome: 'not_in_xi' },
              { text: 'Starter', outcome: 'already_found', playerId },
              { text: 'Starter', outcome: 'correct_new', playerId },
            ],
          },
        },
      });
    }
    return session.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    await app.init();
    prisma = app.get(PrismaService);

    const competition = await prisma.competition.create({
      data: { slug: `${SLUG}-comp`, kind: 'ucl', name: 'Test History Cup' },
    });
    const season = await prisma.season.create({
      data: {
        competitionId: competition.id,
        label: '2004-05',
        startYear: 2004,
      },
    });
    const [home, away] = await Promise.all(
      (['home', 'away'] as const).map((side) =>
        prisma.club.create({
          data: {
            slug: `${SLUG}-${side}`,
            kind: 'club',
            name: `History ${side}`,
            shortName: side === 'home' ? 'HHM' : 'HAW',
          },
        }),
      ),
    );
    clubIds = { home: home.id, away: away.id };
    const match = await prisma.match.create({
      data: {
        slug: `${SLUG}-match`,
        seasonId: season.id,
        date: new Date('2005-05-25'),
        stage: 'Final',
        nickname: 'The Test Final',
        teams: {
          create: [
            { side: 'home', clubId: home.id, goals: 3 },
            { side: 'away', clubId: away.id, goals: 2 },
          ],
        },
      },
    });
    matchId = match.id;
    const player = await prisma.player.create({
      data: { slug: `${SLUG}-player`, name: 'Test Starter' },
    });
    playerId = player.id;
  });

  afterEach(async () => {
    // Sessions first: participants RESTRICT a user delete
    await prisma.gameSession.deleteMany({ where: { matchId } });
    await prisma.user.deleteMany({
      where: {
        OR: [
          { id: { in: guests.splice(0) } },
          { email: { startsWith: 'test-history-' } },
        ],
      },
    });
  });

  afterAll(async () => {
    await prisma.match.deleteMany({ where: { slug: `${SLUG}-match` } });
    await prisma.player.deleteMany({ where: { slug: `${SLUG}-player` } });
    await prisma.club.deleteMany({ where: { slug: { startsWith: SLUG } } });
    await prisma.season.deleteMany({
      where: { competition: { slug: `${SLUG}-comp` } },
    });
    await prisma.competition.deleteMany({ where: { slug: `${SLUG}-comp` } });
    await app.close();
  });

  it('refuses a request with no session', async () => {
    const res = await http().get('/profile/history');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({
      code: 'unauthorized',
      message: NO_SESSION,
    });
  });

  it('gives a new account an empty page', async () => {
    const { cookie } = await signedUp('empty');

    const res = await historyOf(cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ entries: [], nextCursor: null });
  });

  it('lists finished solo and duel games, newest first', async () => {
    const me = await signedUp('mixed');
    const rival = await signedUp('rival');
    const soloId = await play({
      seats: [{ userId: me.id, lives: 1 }],
      endedAt: at(1),
      soloEndReason: 'perfect_clear',
      foundBy: [0, 0],
    });
    const duelId = await play({
      seats: [
        { userId: me.id, lives: 2, outcome: 'win' },
        { userId: rival.id, lives: 0, outcome: 'loss' },
      ],
      endedAt: at(2),
    });

    const res = await historyOf(me.cookie);

    expect(historyPageSchema.safeParse(res.body.data).success).toBe(true);
    expect(res.body.data).toEqual({
      entries: [
        {
          id: duelId,
          playedAt: at(2).toISOString(),
          match: expect.any(Object),
          foundCount: 0,
          livesRemaining: 2,
          mode: 'duel',
          outcome: 'win',
        },
        {
          id: soloId,
          playedAt: at(1).toISOString(),
          match: expect.any(Object),
          foundCount: 2,
          livesRemaining: 1,
          mode: 'solo',
          outcome: 'perfect_clear',
        },
      ],
      nextCursor: null,
    });
    expect(res.body.data.entries[0].match).toEqual({
      id: matchId,
      competition: {
        id: expect.any(String),
        kind: 'ucl',
        name: 'Test History Cup',
      },
      season: '2004-05',
      date: '2005-05-25',
      stage: 'Final',
      home: {
        id: clubIds.home,
        name: 'History home',
        shortName: 'HHM',
        crestUrl: null,
      },
      away: {
        id: clubIds.away,
        name: 'History away',
        shortName: 'HAW',
        crestUrl: null,
      },
      score: { home: 3, away: 2 },
      nickname: 'The Test Final',
    });
  });

  it('leaves out an active session and a duel with no outcome', async () => {
    const me = await signedUp('open');
    const rival = await signedUp('open2');
    await play({
      seats: [{ userId: me.id }],
      endedAt: at(1),
      status: 'active',
    });
    await play({
      seats: [{ userId: me.id }, { userId: rival.id }],
      endedAt: at(2),
    });

    expect((await historyOf(me.cookie)).body.data.entries).toEqual([]);
  });

  it("never shows another user's games", async () => {
    const me = await signedUp('mine');
    const other = await signedUp('theirs');
    const mine = await play({ seats: [{ userId: me.id }], endedAt: at(1) });
    await play({ seats: [{ userId: other.id }], endedAt: at(2) });

    const res = await historyOf(me.cookie);

    expect(res.body.data.entries.map((e: { id: string }) => e.id)).toEqual([
      mine,
    ]);
  });

  it("counts the opponent's finds in a duel's found pool", async () => {
    const me = await signedUp('pool');
    const rival = await signedUp('pool2');
    await play({
      seats: [
        { userId: me.id, outcome: 'loss' },
        { userId: rival.id, lives: 1, outcome: 'win' },
      ],
      endedAt: at(1),
      foundBy: [0, 1, 1, 0, 1],
    });

    const [mine, theirs] = await Promise.all([
      historyOf(me.cookie),
      historyOf(rival.cookie),
    ]);

    expect(mine.body.data.entries[0].foundCount).toBe(5);
    expect(theirs.body.data.entries[0]).toMatchObject({
      foundCount: 5,
      outcome: 'win',
      livesRemaining: 1,
    });
  });

  it('pages through every entry once, ties included', async () => {
    const me = await signedUp('pages');
    // Two games end in the same instant
    const ids = [];
    for (const minute of [1, 2, 3, 3, 4]) {
      ids.push(await play({ seats: [{ userId: me.id }], endedAt: at(minute) }));
    }
    const newestFirst = [
      ids[4],
      ...[ids[2], ids[3]].sort().reverse(),
      ids[1],
      ids[0],
    ];

    const seen: string[] = [];
    const cursors: (string | null)[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `?limit=2&cursor=${cursor}` : '?limit=2';
      const res = await historyOf(me.cookie, query);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.entries.map((e: { id: string }) => e.id));
      cursor = res.body.data.nextCursor as string | null;
      cursors.push(cursor);
    } while (cursor);

    expect(seen).toEqual(newestFirst);
    expect(cursors).toEqual([newestFirst[2], newestFirst[4], null]);
  });

  describe('refuses', () => {
    it.each(['?limit=0', '?limit=51', '?limit=two'])(
      'a bad limit: %s',
      async (query) => {
        const { cookie } = await signedUp('limit');

        const res = await historyOf(cookie, query);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatchObject({
          code: 'invalid_input',
          message: 'Check these fields: limit.',
        });
      },
    );

    it('every cursor that is not one of your finished games', async () => {
      const me = await signedUp('cursor');
      const other = await signedUp('cursor2');
      const theirs = await play({
        seats: [{ userId: other.id }],
        endedAt: at(1),
      });
      const active = await play({
        seats: [{ userId: me.id }],
        endedAt: at(2),
        status: 'active',
      });

      for (const cursor of [
        'not-a-uuid',
        '01900000-0000-7000-8000-000000000000',
        theirs,
        active,
      ]) {
        const res = await historyOf(me.cookie, `?cursor=${cursor}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatchObject({
          code: 'invalid_input',
          message: BAD_CURSOR,
        });
      }
    });
  });

  it("keeps a guest's history through an upgrade", async () => {
    const guest = await http().post('/auth/guest');
    const guestId = guest.body.data.user.id as string;
    guests.push(guestId);
    const played = await play({ seats: [{ userId: guestId }], endedAt: at(1) });

    const upgraded = await http()
      .post('/auth/upgrade')
      .set('Cookie', cookieHeader(guest))
      .send(account('upgrade'));
    const res = await historyOf(cookieHeader(upgraded));

    expect(upgraded.body.data.user).toMatchObject({
      id: guestId,
      isGuest: false,
    });
    expect(res.body.data.entries.map((e: { id: string }) => e.id)).toEqual([
      played,
    ]);
  });
});
