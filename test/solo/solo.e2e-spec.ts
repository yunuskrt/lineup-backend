import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { z } from 'zod';
import { AppModule } from '@/app.module.js';
import { CLOCK, type Clock } from '@/common/clock.js';
import { GRACE_MS, ROUND_MS } from '@/contract/constants.js';
import {
  soloGuessResponseSchema,
  soloMatchOfferSchema,
  soloSessionSchema,
  soloSummarySchema,
  type SoloSession,
} from '@/contract/solo.js';
import { setupDocs } from '@/docs/setup-docs.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { SOLO_MESSAGES } from '@/solo/solo.service.js';

const ALL = { competitionIds: [], clubIds: [], era: { from: 2000, to: 2025 } };

type Starter = { id: string; name: string };

const cookieHeader = (res: request.Response) =>
  [res.headers['set-cookie'] ?? []]
    .flat()
    .map((c) => c.split(';')[0])
    .join('; ');

describe('Solo (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clock: Clock & { at: number } = {
    at: Date.now(),
    now: () => clock.at,
  };
  const http = () => request(app.getHttpServer());
  const guests: string[] = [];
  // Every body received, and what it may show
  const seen: { body: unknown; xi: Starter[]; revealed: Set<string> }[] = [];

  async function guest(): Promise<string> {
    const res = await http().post('/auth/guest');
    guests.push(res.body.data.user.id as string);
    return cookieHeader(res);
  }

  function dataOf<T extends z.ZodType>(
    res: request.Response,
    schema: T,
  ): z.output<T> {
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
    return schema.parse(res.body.data);
  }

  function errorOf(res: request.Response, status: number) {
    expect(res.status).toBe(status);
    expect(res.body.success).toBe(false);
    return res.body.error as { code: string; message: string };
  }

  async function startersOf(session: SoloSession): Promise<Starter[]> {
    const rows = await prisma.lineup.findMany({
      where: {
        matchTeam: { matchId: session.match.id, side: session.match.side },
      },
      select: { player: { select: { id: true, name: true } } },
    });
    return rows.map((row) => row.player);
  }

  // A run in play: offer, then a side
  async function playing(cookie: string) {
    const offer = dataOf(
      await http().post('/solo/sessions').set('Cookie', cookie).send(ALL),
      soloMatchOfferSchema,
    );
    const id = offer.sessionId;
    const session = dataOf(
      await http()
        .post(`/solo/sessions/${id}/side`)
        .set('Cookie', cookie)
        .send({ side: 'home' }),
      soloSessionSchema,
    );
    const xi = await startersOf(session);
    const revealed = new Set<string>();
    seen.push({ body: session, xi, revealed: new Set() });
    const track = (res: request.Response) => {
      if (res.body.data?.result?.outcome === 'correct_new') {
        revealed.add(res.body.data.result.player.id as string);
      }
      seen.push({ body: res.body, xi, revealed: new Set(revealed) });
      return res;
    };
    const run = {
      id,
      xi,
      session,
      guess: async (text: string, sessionId = id) =>
        track(
          await http()
            .post(`/solo/sessions/${id}/guesses`)
            .set('Cookie', cookie)
            .send({ sessionId, guess: text }),
        ),
      sync: async () =>
        track(await http().get(`/solo/sessions/${id}`).set('Cookie', cookie)),
      quit: async () =>
        track(
          await http().post(`/solo/sessions/${id}/quit`).set('Cookie', cookie),
        ),
      summary: async () =>
        track(
          await http()
            .get(`/solo/sessions/${id}/summary`)
            .set('Cookie', cookie),
        ),
    };
    return run;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    setupDocs(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: guests } } });
    await app.close();
  });

  it('refuses a request with no session', async () => {
    const res = await http().post('/solo/sessions').send(ALL);
    expect(errorOf(res, 401).code).toBe('unauthorized');
  });

  it('plays a perfect clear', async () => {
    const run = await playing(await guest());
    expect(run.session).toMatchObject({
      status: 'active',
      lives: 3,
      found: [],
    });

    for (const [index, starter] of run.xi.entries()) {
      clock.at += 1_000;
      const response = dataOf(
        await run.guess(starter.name),
        soloGuessResponseSchema,
      );
      expect(response.result).toMatchObject({
        outcome: 'correct_new',
        player: { id: starter.id },
      });
      expect(response.session.found).toHaveLength(index + 1);
    }

    const summary = dataOf(await run.summary(), soloSummarySchema);
    expect(summary).toMatchObject({
      endReason: 'perfect_clear',
      livesRemaining: 3,
      missedCount: 0,
      missed: null,
      accuracy: 1,
      bestStreak: 11,
    });
    expect(summary.roundTimesMs).toEqual(Array(11).fill(1_000));
  });

  it('leaves the round alone on a repeat or a miss', async () => {
    const run = await playing(await guest());
    clock.at += 1_000;
    const hit = dataOf(
      await run.guess(run.xi[0].name),
      soloGuessResponseSchema,
    );

    clock.at += 1_000;
    const repeat = dataOf(
      await run.guess(run.xi[0].name),
      soloGuessResponseSchema,
    );
    expect(repeat.result).toEqual({
      outcome: 'already_found',
      playerId: run.xi[0].id,
    });

    clock.at += 1_000;
    const miss = dataOf(
      await run.guess('Nobody Atall Zzyzx'),
      soloGuessResponseSchema,
    );
    expect(miss.result).toEqual({ outcome: 'not_in_xi' });

    for (const after of [repeat, miss]) {
      expect(after.session.lives).toBe(3);
      expect(after.session.round).toEqual(hit.session.round);
    }
  });

  it('takes a life at the deadline and refuses a late guess', async () => {
    const run = await playing(await guest());
    const deadline = run.session.round!.endsAt + GRACE_MS;

    clock.at = deadline + 1;
    const synced = dataOf(await run.sync(), soloSessionSchema);
    expect(synced.lives).toBe(2);
    expect(synced.round).toEqual({
      startedAt: deadline,
      endsAt: deadline + ROUND_MS,
    });

    clock.at = deadline + ROUND_MS + GRACE_MS + 1;
    const late = errorOf(await run.guess(run.xi[0].name), 409);
    expect(late).toMatchObject({
      code: 'session_over',
      message: SOLO_MESSAGES.roundOver,
    });
    expect(dataOf(await run.sync(), soloSessionSchema).lives).toBe(1);
  });

  it('ends the run when the clock takes the last life', async () => {
    const run = await playing(await guest());
    clock.at += 3 * (ROUND_MS + GRACE_MS) + 1;

    const summary = dataOf(await run.summary(), soloSummarySchema);
    expect(summary).toMatchObject({
      endReason: 'lives_out',
      livesRemaining: 0,
      missedCount: 11,
      roundTimesMs: [ROUND_MS, ROUND_MS, ROUND_MS],
    });
  });

  it('quits with the lives kept', async () => {
    const run = await playing(await guest());
    clock.at += 2_000;
    const summary = dataOf(await run.quit(), soloSummarySchema);
    expect(summary).toMatchObject({ endReason: 'quit', livesRemaining: 3 });
    expect(dataOf(await run.summary(), soloSummarySchema)).toEqual(summary);
  });

  it('answers a quit after the lives run out with the real reason', async () => {
    const run = await playing(await guest());
    clock.at += 3 * (ROUND_MS + GRACE_MS) + 1;
    const summary = dataOf(await run.quit(), soloSummarySchema);
    expect(summary.endReason).toBe('lives_out');
  });

  it('ends the open run when a new one starts', async () => {
    const cookie = await guest();
    const first = await playing(cookie);
    clock.at += 1_000;
    await playing(cookie);

    const summary = dataOf(await first.summary(), soloSummarySchema);
    expect(summary).toMatchObject({ endReason: 'quit', livesRemaining: 3 });

    const offer = dataOf(
      await http().post('/solo/sessions').set('Cookie', cookie).send(ALL),
      soloMatchOfferSchema,
    );
    await http().post('/solo/sessions').set('Cookie', cookie).send(ALL);
    const dropped = await http()
      .post(`/solo/sessions/${offer.sessionId}/side`)
      .set('Cookie', cookie)
      .send({ side: 'away' });
    expect(errorOf(dropped, 404).code).toBe('not_found');
  });

  describe('refusals', () => {
    it('refuses a summary while the run is in play', async () => {
      const run = await playing(await guest());
      const error = errorOf(await run.summary(), 403);
      expect(error).toMatchObject({
        code: 'forbidden',
        message: SOLO_MESSAGES.stillPlaying,
      });
    });

    it('refuses a second side', async () => {
      const cookie = await guest();
      const run = await playing(cookie);
      const res = await http()
        .post(`/solo/sessions/${run.id}/side`)
        .set('Cookie', cookie)
        .send({ side: 'away' });
      expect(errorOf(res, 403).code).toBe('forbidden');
    });

    it('refuses a guess, a sync or a quit before a side', async () => {
      const cookie = await guest();
      const offer = dataOf(
        await http().post('/solo/sessions').set('Cookie', cookie).send(ALL),
        soloMatchOfferSchema,
      );
      const id = offer.sessionId;

      // Built one at a time: each request binds the server
      const calls = [
        () =>
          http()
            .post(`/solo/sessions/${id}/guesses`)
            .send({ sessionId: id, guess: 'anyone' }),
        () => http().get(`/solo/sessions/${id}`),
        () => http().post(`/solo/sessions/${id}/quit`),
      ];
      for (const call of calls) {
        const error = errorOf(await call().set('Cookie', cookie), 400);
        expect(error).toMatchObject({
          code: 'invalid_input',
          message: SOLO_MESSAGES.noSide,
        });
      }
    });

    it('refuses a guess whose body names another run', async () => {
      const run = await playing(await guest());
      const error = errorOf(await run.guess('anyone', randomUUID()), 400);
      expect(error).toMatchObject({
        code: 'invalid_input',
        message: SOLO_MESSAGES.otherRun,
      });
    });

    it('refuses an empty guess and an unknown side', async () => {
      const cookie = await guest();
      const run = await playing(cookie);
      expect(errorOf(await run.guess('   '), 400).code).toBe('invalid_input');

      const offer = dataOf(
        await http().post('/solo/sessions').set('Cookie', cookie).send(ALL),
        soloMatchOfferSchema,
      );
      const res = await http()
        .post(`/solo/sessions/${offer.sessionId}/side`)
        .set('Cookie', cookie)
        .send({ side: 'middle' });
      expect(errorOf(res, 400).code).toBe('invalid_input');
    });

    it("hides another guest's run", async () => {
      const run = await playing(await guest());
      const other = await guest();
      const res = await http()
        .get(`/solo/sessions/${run.id}`)
        .set('Cookie', other);
      expect(errorOf(res, 404)).toMatchObject({
        code: 'not_found',
        message: SOLO_MESSAGES.notFound,
      });
    });

    it('names the filter that empties the pool', async () => {
      const cookie = await guest();
      const res = await http()
        .post('/solo/sessions')
        .set('Cookie', cookie)
        .send({ ...ALL, clubIds: [randomUUID()] });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({
        code: 'empty_pool',
        emptyBecause: 'club',
      });
    });
  });

  // Runs last: checks every body the suite received
  it('never sent a starter before it was named', () => {
    expect(seen.length).toBeGreaterThan(30);
    for (const { body, xi, revealed } of seen) {
      // Guests are free: no summary lists the missed
      const json = JSON.stringify(body);
      for (const starter of xi) {
        if (revealed.has(starter.id)) continue;
        expect(json).not.toContain(starter.id);
        expect(json).not.toContain(starter.name);
      }
    }
  });
});
