import { ApiException } from '@/common/api-exception.js';
import type { Clock } from '@/common/clock.js';
import type { User } from '@/contract/auth.js';
import type { Filters } from '@/contract/match.js';
import type { MatchSelectorService } from '@/matches/match-selector.service.js';
import type { SquadLoaderService } from '@/matches/squad-loader.service.js';
import type { PrismaService } from '@/prisma/prisma.service.js';
import { NAMES, SQUAD, T0 } from '@/solo/solo.fixtures.js';
import { type PlayedRun, RUN_IDLE_MS } from '@/solo/solo-run.js';
import type { SoloPersistenceService } from '@/solo/solo-persistence.service.js';
import {
  rejectionError,
  SOLO_MESSAGES,
  SoloService,
} from '@/solo/solo.service.js';
import { SoloSessionStore } from '@/solo/solo-session.store.js';

const user = (id = 'user-1', tier: User['tier'] = 'free'): User => ({
  id,
  handle: `handle-${id}`,
  isGuest: true,
  emailVerified: false,
  tier,
});

const FILTERS: Filters = {
  competitionIds: [],
  clubIds: [],
  era: { from: 2000, to: 2025 },
};

const club = (id: string) => ({ id, name: `Club ${id}`, shortName: 'CLB' });
const MATCH_ROW = {
  id: 'm-1',
  date: new Date('2005-05-25T00:00:00.000Z'),
  stage: 'Final',
  nickname: null,
  season: {
    label: '2004-05',
    competition: { id: 'comp-1', kind: 'ucl' as const, name: 'Cup' },
  },
  teams: [
    { side: 'home' as const, goals: 3, club: club('c-home') },
    { side: 'away' as const, goals: 3, club: club('c-away') },
  ],
};

function setup() {
  const clock: Clock & { at: number } = { at: T0, now: () => clock.at };
  const select = vi.fn().mockResolvedValue({ matchId: 'm-1' });
  const load = vi.fn().mockResolvedValue(SQUAD);
  const findUniqueOrThrow = vi.fn().mockResolvedValue(MATCH_ROW);
  const store = new SoloSessionStore();
  const save = vi.fn().mockResolvedValue(true);
  const service = new SoloService(
    { match: { findUniqueOrThrow } } as unknown as PrismaService,
    { select } as unknown as MatchSelectorService,
    { load } as unknown as SquadLoaderService,
    store,
    { save } as unknown as SoloPersistenceService,
    clock,
  );
  return { service, clock, select, load, store, save };
}

// A started run with its side chosen at T0
async function playing(ctx = setup(), who = user()) {
  const { sessionId } = await ctx.service.start(who, FILTERS);
  await ctx.service.chooseSide(who, sessionId, 'home');
  return { ...ctx, sessionId, who };
}

async function failureOf(act: () => unknown) {
  try {
    await act();
  } catch (error) {
    if (error instanceof ApiException) return error.error;
    throw error;
  }
  throw new Error('Expected an ApiException');
}

const guessOf = (sessionId: string, text: string) => ({
  sessionId,
  guess: text,
});

describe('SoloService', () => {
  describe('start', () => {
    it('offers both clubs and keeps an offered run', async () => {
      const { service, select, store } = setup();
      const offer = await service.start(user(), FILTERS);

      expect(select).toHaveBeenCalledWith(FILTERS);
      expect(offer.home.id).toBe('c-home');
      expect(offer.away.id).toBe('c-away');
      expect(store.get(offer.sessionId, 'user-1')).toMatchObject({
        side: null,
        touchedAt: T0,
      });
    });

    it('refuses an empty pool, naming the filter to blame', async () => {
      const ctx = setup();
      ctx.select.mockResolvedValue({ emptyBecause: 'club' });

      const error = await failureOf(() => ctx.service.start(user(), FILTERS));
      expect(error).toMatchObject({
        code: 'empty_pool',
        message: SOLO_MESSAGES.emptyPool,
        emptyBecause: 'club',
      });
    });

    it('keeps the open run when no match fits', async () => {
      const ctx = await playing();
      ctx.select.mockResolvedValue({ emptyBecause: 'era' });

      await failureOf(() => ctx.service.start(ctx.who, FILTERS));
      expect((await ctx.service.sync(ctx.who, ctx.sessionId)).status).toBe(
        'active',
      );
    });

    it('ends a run in play as quit, lives kept', async () => {
      const ctx = await playing();
      ctx.clock.at = T0 + 16_000;
      await ctx.service.start(ctx.who, FILTERS);

      expect(await ctx.service.summary(ctx.who, ctx.sessionId)).toMatchObject({
        endReason: 'quit',
        livesRemaining: 2,
      });
    });

    it('lets a run the clock already ended keep its reason', async () => {
      const ctx = await playing();
      ctx.clock.at = T0 + 60_000;
      await ctx.service.start(ctx.who, FILTERS);

      expect(await ctx.service.summary(ctx.who, ctx.sessionId)).toMatchObject({
        endReason: 'lives_out',
        livesRemaining: 0,
      });
    });

    it('drops an offer whose side was never chosen', async () => {
      const { service } = setup();
      const first = await service.start(user(), FILTERS);
      await service.start(user(), FILTERS);

      const error = await failureOf(() =>
        service.chooseSide(user(), first.sessionId, 'home'),
      );
      expect(error.code).toBe('not_found');
    });

    it("leaves another user's run alone", async () => {
      const ctx = await playing();
      await ctx.service.start(user('user-2'), FILTERS);
      expect((await ctx.service.sync(ctx.who, ctx.sessionId)).status).toBe(
        'active',
      );
    });
  });

  describe('chooseSide', () => {
    it('loads that side and starts round 1 now', async () => {
      const { service, load, clock } = setup();
      const { sessionId } = await service.start(user(), FILTERS);
      clock.at = T0 + 5_000;
      const session = await service.chooseSide(user(), sessionId, 'away');

      expect(load).toHaveBeenCalledWith('m-1', 'away');
      expect(session).toMatchObject({
        status: 'active',
        lives: 3,
        found: [],
        round: { startedAt: T0 + 5_000, endsAt: T0 + 20_000 },
      });
      expect(session.match).toMatchObject({ side: 'away', formation: '4-4-2' });
    });

    it("hides an unknown id and another user's run", async () => {
      const { service } = setup();
      const { sessionId } = await service.start(user(), FILTERS);

      for (const [id, who] of [
        ['nope', user()],
        [sessionId, user('user-2')],
      ] as const) {
        const error = await failureOf(() =>
          service.chooseSide(who, id, 'home'),
        );
        expect(error).toMatchObject({
          code: 'not_found',
          message: SOLO_MESSAGES.notFound,
        });
      }
    });

    it('refuses a second side', async () => {
      const ctx = await playing();
      const error = await failureOf(() =>
        ctx.service.chooseSide(ctx.who, ctx.sessionId, 'away'),
      );
      expect(error).toMatchObject({
        code: 'forbidden',
        message: SOLO_MESSAGES.sideTaken,
      });
    });

    it('refuses the loser of two concurrent picks', async () => {
      const { service } = setup();
      const { sessionId } = await service.start(user(), FILTERS);

      const results = await Promise.allSettled([
        service.chooseSide(user(), sessionId, 'home'),
        service.chooseSide(user(), sessionId, 'away'),
      ]);
      expect(results.map((result) => result.status)).toEqual([
        'fulfilled',
        'rejected',
      ]);
    });

    it('lets a squad that fails to load surface as a crash', async () => {
      const ctx = setup();
      ctx.load.mockRejectedValue(
        new Error('Match m-1 home XI has 10 starters'),
      );
      const { sessionId } = await ctx.service.start(user(), FILTERS);

      await expect(
        ctx.service.chooseSide(user(), sessionId, 'home'),
      ).rejects.not.toBeInstanceOf(ApiException);
      expect(ctx.store.get(sessionId, 'user-1')?.side).toBeNull();
    });
  });

  describe('guess', () => {
    it('reveals a new name and starts the next round now', async () => {
      const ctx = await playing();
      ctx.clock.at = T0 + 4_000;
      const response = await ctx.service.guess(
        ctx.who,
        ctx.sessionId,
        guessOf(ctx.sessionId, 'charlie'),
      );

      expect(response.result).toEqual({
        outcome: 'correct_new',
        player: SQUAD.players[2],
      });
      expect(response.session.round).toEqual({
        startedAt: T0 + 4_000,
        endsAt: T0 + 19_000,
      });
    });

    it('leaves the round running on a miss', async () => {
      const ctx = await playing();
      ctx.clock.at = T0 + 4_000;
      const response = await ctx.service.guess(
        ctx.who,
        ctx.sessionId,
        guessOf(ctx.sessionId, 'zulu'),
      );

      expect(response.result).toEqual({ outcome: 'not_in_xi' });
      expect(response.session).toMatchObject({
        lives: 3,
        round: { startedAt: T0, endsAt: T0 + 15_000 },
      });
    });

    it('refuses a body for another run', async () => {
      const ctx = await playing();
      const error = await failureOf(() =>
        ctx.service.guess(ctx.who, ctx.sessionId, guessOf('other', 'alfa')),
      );
      expect(error).toMatchObject({
        code: 'invalid_input',
        message: SOLO_MESSAGES.otherRun,
      });
    });

    it('refuses a guess before a side is chosen', async () => {
      const { service } = setup();
      const { sessionId } = await service.start(user(), FILTERS);
      const error = await failureOf(() =>
        service.guess(user(), sessionId, guessOf(sessionId, 'alfa')),
      );
      expect(error).toMatchObject({
        code: 'invalid_input',
        message: SOLO_MESSAGES.noSide,
      });
    });

    it('refuses a late guess but keeps the lost life', async () => {
      const ctx = await playing();
      ctx.clock.at = T0 + 15_401;
      const error = await failureOf(() =>
        ctx.service.guess(
          ctx.who,
          ctx.sessionId,
          guessOf(ctx.sessionId, 'secret-guess-text'),
        ),
      );

      expect(error).toMatchObject({
        code: 'session_over',
        message: SOLO_MESSAGES.roundOver,
      });
      expect(JSON.stringify(error)).not.toContain('secret-guess-text');
      expect(await ctx.service.sync(ctx.who, ctx.sessionId)).toMatchObject({
        lives: 2,
        round: { startedAt: T0 + 15_400 },
      });
    });

    it('refuses a guess once the run is over', async () => {
      const ctx = await playing();
      await ctx.service.quit(ctx.who, ctx.sessionId);
      const error = await failureOf(() =>
        ctx.service.guess(
          ctx.who,
          ctx.sessionId,
          guessOf(ctx.sessionId, 'alfa'),
        ),
      );
      expect(error).toMatchObject({
        code: 'session_over',
        message: SOLO_MESSAGES.runOver,
      });
    });
  });

  describe('sync', () => {
    it('applies the clock before answering', async () => {
      const ctx = await playing();
      ctx.clock.at = T0 + 31_000;
      expect(await ctx.service.sync(ctx.who, ctx.sessionId)).toMatchObject({
        status: 'active',
        lives: 1,
        round: { startedAt: T0 + 30_800 },
      });
    });

    it('shows a run lost to the clock as over', async () => {
      const ctx = await playing();
      ctx.clock.at = T0 + 60_000;
      expect(await ctx.service.sync(ctx.who, ctx.sessionId)).toMatchObject({
        status: 'over',
        lives: 0,
        round: null,
      });
    });

    it('refuses an offer with no side', async () => {
      const { service } = setup();
      const { sessionId } = await service.start(user(), FILTERS);
      const error = await failureOf(() => service.sync(user(), sessionId));
      expect(error.code).toBe('invalid_input');
    });
  });

  describe('quit', () => {
    it('ends the run with the lives kept', async () => {
      const ctx = await playing();
      ctx.clock.at = T0 + 2_000;
      expect(await ctx.service.quit(ctx.who, ctx.sessionId)).toMatchObject({
        endReason: 'quit',
        livesRemaining: 3,
        missedCount: 11,
        missed: null,
        roundTimesMs: [2_000],
      });
    });

    it('returns the real reason for a run already lost', async () => {
      const ctx = await playing();
      ctx.clock.at = T0 + 60_000;
      expect(await ctx.service.quit(ctx.who, ctx.sessionId)).toMatchObject({
        endReason: 'lives_out',
        livesRemaining: 0,
      });
    });

    it('returns the same summary when quit twice', async () => {
      const ctx = await playing();
      const first = await ctx.service.quit(ctx.who, ctx.sessionId);
      ctx.clock.at = T0 + 9_000;
      expect(await ctx.service.quit(ctx.who, ctx.sessionId)).toEqual(first);
    });
  });

  describe('summary', () => {
    it('refuses a run still in play', async () => {
      const ctx = await playing();
      const error = await failureOf(() =>
        ctx.service.summary(ctx.who, ctx.sessionId),
      );
      expect(error).toMatchObject({
        code: 'forbidden',
        message: SOLO_MESSAGES.stillPlaying,
      });
    });

    it('reports a perfect clear', async () => {
      const ctx = await playing();
      for (const name of NAMES) {
        await ctx.service.guess(
          ctx.who,
          ctx.sessionId,
          guessOf(ctx.sessionId, name),
        );
      }
      expect(await ctx.service.summary(ctx.who, ctx.sessionId)).toMatchObject({
        endReason: 'perfect_clear',
        livesRemaining: 3,
        accuracy: 1,
        bestStreak: 11,
      });
    });

    it('gives the missed list to a pro from the session tier', async () => {
      const ctx = await playing(setup(), user('user-1', 'pro'));
      await ctx.service.guess(
        ctx.who,
        ctx.sessionId,
        guessOf(ctx.sessionId, 'alfa'),
      );
      await ctx.service.quit(ctx.who, ctx.sessionId);

      const summary = await ctx.service.summary(ctx.who, ctx.sessionId);
      expect(summary.missed).toEqual(SQUAD.players.slice(1));
    });
  });

  describe('rejectionError', () => {
    it.each([
      ['session_over', 'session_over', SOLO_MESSAGES.runOver],
      ['round_over', 'session_over', SOLO_MESSAGES.roundOver],
      ['not_your_turn', 'forbidden', SOLO_MESSAGES.notAllowed],
      ['wrong_mode', 'forbidden', SOLO_MESSAGES.notAllowed],
      ['unknown_seat', 'forbidden', SOLO_MESSAGES.notAllowed],
    ] as const)('maps %s to %s', (rejected, code, message) => {
      expect(rejectionError(rejected).error).toMatchObject({ code, message });
    });
  });

  describe('saving', () => {
    const savedRunOf = (ctx: ReturnType<typeof setup>, at = 0) =>
      ctx.save.mock.calls[at][0] as PlayedRun;

    it('saves nothing while the run is in play', async () => {
      const ctx = await playing();
      ctx.clock.at = T0 + 16_000;
      await ctx.service.sync(ctx.who, ctx.sessionId);
      expect(ctx.save).not.toHaveBeenCalled();
    });

    it('saves the run in the call that ends it, once', async () => {
      const ctx = await playing();
      await ctx.service.quit(ctx.who, ctx.sessionId);
      await ctx.service.quit(ctx.who, ctx.sessionId);
      await ctx.service.summary(ctx.who, ctx.sessionId);

      expect(ctx.save).toHaveBeenCalledTimes(1);
      expect(savedRunOf(ctx).timed.game.result).toMatchObject({
        endReason: 'quit',
      });
      expect(ctx.store.get(ctx.sessionId, 'user-1')).toMatchObject({
        savedAt: T0,
      });
    });

    it('saves a perfect clear on the eleventh name', async () => {
      const ctx = await playing();
      for (const name of NAMES) {
        await ctx.service.guess(
          ctx.who,
          ctx.sessionId,
          guessOf(ctx.sessionId, name),
        );
      }
      expect(ctx.save).toHaveBeenCalledTimes(1);
    });

    it('still answers when the save fails, and stays unsaved', async () => {
      const ctx = await playing();
      ctx.save.mockResolvedValue(false);

      const summary = await ctx.service.quit(ctx.who, ctx.sessionId);
      expect(summary.endReason).toBe('quit');
      expect(ctx.store.get(ctx.sessionId, 'user-1')).toMatchObject({
        savedAt: null,
      });
    });

    it('saves the open run a new start ends', async () => {
      const ctx = await playing();
      await ctx.service.start(ctx.who, FILTERS);
      expect(savedRunOf(ctx).id).toBe(ctx.sessionId);
    });
  });

  describe('sweep', () => {
    it('ends and saves a run its player abandoned', async () => {
      const ctx = await playing();
      ctx.clock.at = T0 + 60_000;
      await ctx.service.sweep();

      const saved = ctx.save.mock.calls[0][0] as PlayedRun;
      expect(saved.timed.game.result).toMatchObject({
        endReason: 'lives_out',
      });
      // The clock moving is not a touch
      expect(ctx.store.get(ctx.sessionId, 'user-1')).toMatchObject({
        touchedAt: T0,
        savedAt: T0 + 60_000,
      });
    });

    it('leaves a run in play alone', async () => {
      const ctx = await playing();
      ctx.clock.at = T0 + 5_000;
      await ctx.service.sweep();
      expect(ctx.save).not.toHaveBeenCalled();
      expect((await ctx.service.sync(ctx.who, ctx.sessionId)).status).toBe(
        'active',
      );
    });

    it('retries a save that failed', async () => {
      const ctx = await playing();
      ctx.save.mockResolvedValueOnce(false);
      await ctx.service.quit(ctx.who, ctx.sessionId);

      ctx.clock.at = T0 + 60_000;
      await ctx.service.sweep();
      expect(ctx.save).toHaveBeenCalledTimes(2);
      expect(ctx.store.get(ctx.sessionId, 'user-1')).toMatchObject({
        savedAt: T0 + 60_000,
      });
    });

    it('evicts idle runs once saved, but never an unsaved one', async () => {
      const ctx = await playing();
      ctx.save.mockResolvedValue(false);
      await ctx.service.quit(ctx.who, ctx.sessionId);

      ctx.clock.at = T0 + RUN_IDLE_MS;
      await ctx.service.sweep();
      expect(ctx.store.get(ctx.sessionId, 'user-1')).toBeDefined();

      ctx.save.mockResolvedValue(true);
      await ctx.service.sweep();
      expect(ctx.store.get(ctx.sessionId, 'user-1')).toBeUndefined();
    });

    it('keeps a guess made while it waits on another save', async () => {
      const ctx = setup();
      const first = await playing(ctx, user('user-a'));
      ctx.save.mockResolvedValueOnce(false);
      await ctx.service.quit(first.who, first.sessionId);

      const second = await playing(ctx, user('user-b'));
      let finish: (saved: boolean) => void = () => {};
      ctx.save.mockReturnValueOnce(
        new Promise<boolean>((resolve) => (finish = resolve)),
      );

      const sweeping = ctx.service.sweep();
      await ctx.service.guess(
        second.who,
        second.sessionId,
        guessOf(second.sessionId, 'alfa'),
      );
      finish(true);
      await sweeping;

      const session = await ctx.service.sync(second.who, second.sessionId);
      expect(session.found.map((player) => player.id)).toEqual(['p-alfa']);
    });

    it('skips a sweep while one is still saving', async () => {
      const ctx = await playing();
      ctx.clock.at = T0 + 60_000;
      let finish: (saved: boolean) => void = () => {};
      ctx.save.mockReturnValue(
        new Promise<boolean>((resolve) => (finish = resolve)),
      );

      const first = ctx.service.sweep();
      await ctx.service.sweep();
      finish(true);
      await first;
      expect(ctx.save).toHaveBeenCalledTimes(1);
    });
  });
});
