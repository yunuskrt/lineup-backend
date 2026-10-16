import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { CLOCK, type Clock } from '@/common/clock.js';
import { GRACE_MS, ROUND_MS } from '@/contract/constants.js';
import { historyPageSchema, profileSchema } from '@/contract/profile.js';
import { type SoloSession, soloSessionSchema } from '@/contract/solo.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { SoloPersistenceService } from '@/solo/solo-persistence.service.js';
import { SoloService } from '@/solo/solo.service.js';
import { guess, IDENTITY, playedRun } from '@/solo/solo.fixtures.js';

const ALL = { competitionIds: [], clubIds: [], era: { from: 2000, to: 2025 } };
const ROUND_TO_DEADLINE = ROUND_MS + GRACE_MS;

const cookieHeader = (res: request.Response) =>
  [res.headers['set-cookie'] ?? []]
    .flat()
    .map((c) => c.split(';')[0])
    .join('; ');

describe('Solo persistence (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clock: Clock & { at: number } = {
    at: Date.now(),
    now: () => clock.at,
  };
  const http = () => request(app.getHttpServer());
  const guests: string[] = [];

  async function guest() {
    const res = await http().post('/auth/guest');
    const id = res.body.data.user.id as string;
    guests.push(id);
    return { id, cookie: cookieHeader(res) };
  }

  async function offer(cookie: string): Promise<string> {
    const res = await http()
      .post('/solo/sessions')
      .set('Cookie', cookie)
      .send(ALL);
    return res.body.data.sessionId as string;
  }

  // A run in play, with its starters' names
  async function playing(cookie: string) {
    const id = await offer(cookie);
    const res = await http()
      .post(`/solo/sessions/${id}/side`)
      .set('Cookie', cookie)
      .send({ side: 'home' });
    const session: SoloSession = soloSessionSchema.parse(res.body.data);
    const starters = await prisma.lineup.findMany({
      where: { matchTeam: { matchId: session.match.id, side: 'home' } },
      select: { player: { select: { name: true } } },
    });
    const names = starters.map((row) => row.player.name);
    const post = (path: string, body?: object) =>
      http()
        .post(`/solo/sessions/${id}${path}`)
        .set('Cookie', cookie)
        .send(body);
    return {
      id,
      session,
      names,
      guess: (text: string) => post('/guesses', { sessionId: id, guess: text }),
      quit: () => post('/quit'),
      summary: () =>
        http().get(`/solo/sessions/${id}/summary`).set('Cookie', cookie),
    };
  }

  async function historyOf(cookie: string) {
    const res = await http().get('/profile/history').set('Cookie', cookie);
    return historyPageSchema.parse(res.body.data).entries;
  }

  async function statsOf(cookie: string) {
    const res = await http().get('/profile').set('Cookie', cookie);
    return profileSchema.parse(res.body.data).stats;
  }

  const sessionCount = (id: string) =>
    prisma.gameSession.count({ where: { id } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Saved runs restrict a user delete (B10a)
    await prisma.gameSession.deleteMany({
      where: { participants: { some: { userId: { in: guests } } } },
    });
    await prisma.user.deleteMany({ where: { id: { in: guests } } });
    await app.close();
  });

  it('saves a perfect clear into the history and the profile', async () => {
    const { id: userId, cookie } = await guest();
    const run = await playing(cookie);
    for (const name of run.names) {
      clock.at += 1_000;
      await run.guess(name);
    }

    const [entry] = await historyOf(cookie);
    expect(entry).toMatchObject({
      id: run.id,
      mode: 'solo',
      outcome: 'perfect_clear',
      foundCount: 11,
      livesRemaining: 3,
      playedAt: new Date(clock.at).toISOString(),
    });
    expect(await statsOf(cookie)).toMatchObject({
      played: 1,
      wins: 0,
      perfectClears: 1,
      bestStreak: 11,
      accuracy: 1,
      favouriteClub: { id: run.session.match.home.id },
    });

    const saved = await prisma.gameSession.findUniqueOrThrow({
      where: { id: run.id },
      include: {
        participants: true,
        rounds: { include: { guesses: true }, orderBy: { number: 'asc' } },
      },
    });
    expect(saved).toMatchObject({ mode: 'solo', side: 'home', status: 'over' });
    expect(saved.participants).toEqual([
      expect.objectContaining({ userId, seat: 0, livesRemaining: 3 }),
    ]);
    expect(saved.rounds).toHaveLength(11);
    for (const [index, round] of saved.rounds.entries()) {
      expect(round).toMatchObject({
        number: index + 1,
        endReason: 'found',
        participantId: saved.participants[0].id,
      });
      expect(round.guesses).toEqual([
        expect.objectContaining({
          text: run.names[index],
          outcome: 'correct_new',
          playerId: expect.any(String),
        }),
      ]);
    }
  });

  it('adds a quit run to the same profile', async () => {
    const { cookie } = await guest();
    const first = await playing(cookie);
    for (const name of first.names) await first.guess(name);

    const second = await playing(cookie);
    await second.guess('Nobody Atall Zzyzx');
    clock.at += ROUND_TO_DEADLINE + 1;
    await second.quit();

    const entries = await historyOf(cookie);
    expect(entries.map((entry) => entry.outcome)).toEqual([
      'quit',
      'perfect_clear',
    ]);
    expect(entries[0]).toMatchObject({ foundCount: 0, livesRemaining: 2 });
    expect(await statsOf(cookie)).toMatchObject({
      played: 2,
      perfectClears: 1,
      bestStreak: 11,
      accuracy: 11 / 12,
    });
  });

  it('sweeps an abandoned run into the history at its last deadline', async () => {
    const { cookie } = await guest();
    const run = await playing(cookie);
    const lastDeadline = run.session.round!.startedAt + 3 * ROUND_TO_DEADLINE;

    clock.at = lastDeadline + 60_000;
    await app.get(SoloService).sweep();

    const [entry] = await historyOf(cookie);
    expect(entry).toMatchObject({
      id: run.id,
      outcome: 'lives_out',
      livesRemaining: 0,
      playedAt: new Date(lastDeadline).toISOString(),
    });
    expect(await statsOf(cookie)).toMatchObject({ played: 1, accuracy: 0 });
  });

  it('saves the open run a new start ends', async () => {
    const { cookie } = await guest();
    const run = await playing(cookie);
    await offer(cookie);

    const [entry] = await historyOf(cookie);
    expect(entry).toMatchObject({ id: run.id, outcome: 'quit' });
  });

  it('saves a run once, however often it is read', async () => {
    const { cookie } = await guest();
    const run = await playing(cookie);
    await run.quit();
    await run.quit();
    await run.summary();

    expect(await sessionCount(run.id)).toBe(1);
    expect((await statsOf(cookie)).played).toBe(1);
  });

  it('writes nothing for an offer whose side was never chosen', async () => {
    const { cookie } = await guest();
    const id = await offer(cookie);
    expect(await sessionCount(id)).toBe(0);
    expect(await historyOf(cookie)).toEqual([]);
  });

  it('rolls back a failed save and logs no guess text', async () => {
    const { id: userId } = await guest();
    const match = await prisma.match.findFirstOrThrow({
      where: { teams: { every: { formation: { not: null } } } },
      select: { id: true },
    });
    // Untrimmed text breaks guesses_text_check
    const run = {
      ...playedRun(
        [guess(' secret-guess-text'), 1_000],
        [{ kind: 'quit' }, 2_000],
      ),
      id: randomUUID(),
      userId,
      match: { ...IDENTITY, id: match.id },
    };

    // Everything printed while saving, swallowed
    const printed: string[] = [];
    const capture = (chunk: unknown) => {
      printed.push(String(chunk));
      return true;
    };
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(capture);
    const saved = await app.get(SoloPersistenceService).save(run);
    out.mockRestore();
    err.mockRestore();

    expect(saved).toBe(false);
    expect(await sessionCount(run.id)).toBe(0);
    expect(await prisma.userStats.count({ where: { userId } })).toBe(0);
    expect(printed.join('')).toContain(`Run ${run.id} was not saved`);
    expect(printed.join('')).not.toContain('secret-guess-text');
  });
});
