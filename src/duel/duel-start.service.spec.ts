import { Logger } from '@nestjs/common';
import { ApiException } from '@/common/api-exception.js';
import type { Clock } from '@/common/clock.js';
import type { User } from '@/contract/auth.js';
import { duelPlayer } from '@/contract/contract.fixtures.js';
import type { DuelEventMap } from '@/contract/duel.js';
import type { Filters } from '@/contract/match.js';
import { NO_PREFERENCE } from '@/game/coin-flip.js';
import {
  DUEL_START_MESSAGES,
  MATCHMAKING_MESSAGES,
} from '@/duel/duel-messages.js';
import type { DuelNotifier } from '@/duel/duel-notifier.js';
import type { DuelPlayService } from '@/duel/duel-play.service.js';
import { DuelRooms } from '@/duel/duel-rooms.js';
import { DuelStartService } from '@/duel/duel-start.service.js';
import type { MatchSelectorService } from '@/matches/match-selector.service.js';
import type { SidePickerService } from '@/matches/side-picker.service.js';
import type { SquadLoaderService } from '@/matches/squad-loader.service.js';
import { NAMES, SQUAD } from '@/matches/squad.fixtures.js';
import type { PrismaService } from '@/prisma/prisma.service.js';

const T0 = 1_000_000;
const WINDOW_MS = 30_000;
const REVEAL_MS = 2_000;

const user = (id: string): User => ({
  id,
  handle: `player-${id}`,
  isGuest: true,
  emailVerified: false,
  tier: 'free',
});

const A_FILTERS: Filters = {
  competitionIds: ['c-ucl'],
  clubIds: ['mil'],
  era: { from: 2004, to: 2006 },
};
const B_FILTERS: Filters = { ...NO_PREFERENCE, clubIds: ['liv'] };

const club = (id: string) => ({ id, name: `Club ${id}`, shortName: 'CLB' });
const MATCH_ROW = {
  id: 'm-1',
  date: new Date('2005-05-25T00:00:00.000Z'),
  stage: 'Final',
  nickname: null,
  season: {
    label: '2004-05',
    competition: { id: 'c-ucl', kind: 'ucl' as const, name: 'Cup' },
  },
  teams: [
    { side: 'home' as const, goals: 3, club: club('mil') },
    { side: 'away' as const, goals: 3, club: club('liv') },
  ],
};

type Sent = { to: string; event: keyof DuelEventMap; payload: unknown };

function setup(draw = 0.1) {
  const clock: Clock & { at: number } = { at: T0, now: () => clock.at };
  const sent: Sent[] = [];
  const notifier = {
    toUser: (to: string, event: keyof DuelEventMap, payload: unknown) => {
      sent.push({ to, event, payload });
    },
  } as unknown as DuelNotifier;
  const rooms = new DuelRooms();
  const selector = {
    check: vi.fn().mockResolvedValue(null),
    select: vi.fn().mockResolvedValue({ matchId: 'm-1' }),
  };
  const sides = { pick: vi.fn().mockResolvedValue('away') };
  const squads = { load: vi.fn().mockResolvedValue(SQUAD) };
  const findUniqueOrThrow = vi.fn().mockResolvedValue(MATCH_ROW);
  const random = () => draw;
  const play = { start: vi.fn(), drop: vi.fn() };
  const service = new DuelStartService(
    rooms,
    notifier,
    play as unknown as DuelPlayService,
    selector as unknown as MatchSelectorService,
    sides as unknown as SidePickerService,
    squads as unknown as SquadLoaderService,
    { match: { findUniqueOrThrow } } as unknown as PrismaService,
    clock,
    random,
    WINDOW_MS,
    REVEAL_MS,
  );

  const room = rooms.open(duelPlayer('a'), duelPlayer('b'), T0);
  service.open(room);

  const eventsOf = (to: string) =>
    sent.filter((s) => s.to === to).map((s) => s.event);
  const last = (to: string, event: keyof DuelEventMap) =>
    sent.filter((s) => s.to === to && s.event === event).at(-1)?.payload;
  return {
    clock,
    sent,
    rooms,
    roomId: room.id,
    selector,
    sides,
    squads,
    random,
    play,
    service,
    eventsOf,
    last,
  };
}

async function bothSubmit(ctx: ReturnType<typeof setup>) {
  await ctx.service.submit(user('a'), A_FILTERS);
  await ctx.service.submit(user('b'), B_FILTERS);
}

// Lets the resolution's awaits settle
const settle = () => vi.advanceTimersByTimeAsync(0);

async function refusal(action: Promise<unknown>) {
  try {
    await action;
    return null;
  } catch (error) {
    if (error instanceof ApiException) return error.error;
    throw error;
  }
}

describe('DuelStartService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('submit', () => {
    it('tells both players, each from their own seat', async () => {
      const ctx = setup();
      await ctx.service.submit(user('a'), A_FILTERS);

      expect(ctx.last('a', 'filtersUpdated')).toEqual({
        yours: 'submitted',
        theirs: 'pending',
      });
      expect(ctx.last('b', 'filtersUpdated')).toEqual({
        yours: 'pending',
        theirs: 'submitted',
      });
      expect(ctx.rooms.get(ctx.roomId)).toMatchObject({
        phase: 'filters',
        submissions: [A_FILTERS, null],
      });
    });

    it('checks the pool before storing a set', async () => {
      const ctx = setup();
      await ctx.service.submit(user('a'), A_FILTERS);
      expect(ctx.selector.check).toHaveBeenCalledWith(A_FILTERS);
    });

    it('refuses filters that empty the pool, storing nothing', async () => {
      const ctx = setup();
      ctx.selector.check.mockResolvedValue('club');
      expect(await refusal(ctx.service.submit(user('a'), A_FILTERS))).toEqual({
        code: 'empty_pool',
        message: DUEL_START_MESSAGES.emptyPool,
        retryAfterMs: null,
        emptyBecause: 'club',
      });
      expect(ctx.sent).toEqual([]);
      expect(ctx.rooms.get(ctx.roomId)).toMatchObject({
        submissions: [null, null],
      });
    });

    it.each([
      ['a second submit', 'a', true],
      ['a player in no room', 'z', false],
    ])('refuses %s as not open', async (_, id, isSecond) => {
      const ctx = setup();
      if (isSecond) await ctx.service.submit(user('a'), A_FILTERS);
      expect(await refusal(ctx.service.submit(user(id), A_FILTERS))).toEqual({
        code: 'forbidden',
        message: DUEL_START_MESSAGES.filtersClosed,
        retryAfterMs: null,
      });
    });

    it('refuses a submit once the flip has happened', async () => {
      const ctx = setup();
      await bothSubmit(ctx);
      expect(
        await refusal(ctx.service.submit(user('a'), A_FILTERS)),
      ).toMatchObject({ message: DUEL_START_MESSAGES.filtersClosed });
    });

    it('refuses a submit whose room closed during the check', async () => {
      const ctx = setup();
      let release!: (value: null) => void;
      ctx.selector.check.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      const pending = refusal(ctx.service.submit(user('a'), A_FILTERS));
      ctx.service.drop('b');
      release(null);
      expect(await pending).toMatchObject({ code: 'forbidden' });
      expect(ctx.eventsOf('b')).toEqual([]);
    });
  });

  describe('the coin flip', () => {
    it('follows the last submit with the flip, to both', async () => {
      const ctx = setup();
      await bothSubmit(ctx);

      expect(ctx.eventsOf('a')).toEqual([
        'filtersUpdated',
        'filtersUpdated',
        'coinFlip',
      ]);
      expect(ctx.last('a', 'filtersUpdated')).toEqual({
        yours: 'submitted',
        theirs: 'submitted',
      });
      expect(ctx.last('a', 'coinFlip')).toEqual({
        winner: 'you',
        filters: A_FILTERS,
      });
      expect(ctx.last('b', 'coinFlip')).toEqual({
        winner: 'opponent',
        filters: A_FILTERS,
      });
    });

    it("applies the winner's set whole to the selector", async () => {
      const ctx = setup(0.9);
      await bothSubmit(ctx);
      await settle();
      expect(ctx.last('b', 'coinFlip')).toMatchObject({ winner: 'you' });
      expect(ctx.selector.select).toHaveBeenCalledWith(B_FILTERS, ctx.random);
    });

    it('loads the side the server picked', async () => {
      const ctx = setup();
      await bothSubmit(ctx);
      await settle();
      expect(ctx.sides.pick).toHaveBeenCalledWith('m-1', ctx.random);
      expect(ctx.squads.load).toHaveBeenCalledWith('m-1', 'away');
    });
  });

  describe('the filter window', () => {
    it('fills a missing set with no preference and flips', async () => {
      const ctx = setup(0.9);
      await ctx.service.submit(user('a'), A_FILTERS);
      await vi.advanceTimersByTimeAsync(WINDOW_MS);

      expect(ctx.last('b', 'filtersUpdated')).toEqual({
        yours: 'submitted',
        theirs: 'submitted',
      });
      expect(ctx.last('b', 'coinFlip')).toEqual({
        winner: 'you',
        filters: NO_PREFERENCE,
      });
    });

    it('flips even when nobody submitted', async () => {
      const ctx = setup();
      await vi.advanceTimersByTimeAsync(WINDOW_MS);
      expect(ctx.last('a', 'coinFlip')).toEqual({
        winner: 'you',
        filters: NO_PREFERENCE,
      });
    });

    it('never fires once both have submitted', async () => {
      const ctx = setup();
      await bothSubmit(ctx);
      await vi.advanceTimersByTimeAsync(WINDOW_MS);
      const flips = ctx.sent.filter((s) => s.event === 'coinFlip');
      expect(flips).toHaveLength(2);
    });
  });

  describe('matchReady', () => {
    it('waits for the reveal before starting the clock', async () => {
      const ctx = setup();
      await bothSubmit(ctx);
      await settle();
      ctx.clock.at = T0 + REVEAL_MS - 1;
      await vi.advanceTimersByTimeAsync(REVEAL_MS - 1);
      expect(ctx.eventsOf('a')).not.toContain('matchReady');

      ctx.clock.at = T0 + REVEAL_MS;
      await vi.advanceTimersByTimeAsync(1);
      expect(ctx.eventsOf('a').at(-1)).toBe('matchReady');
      expect(ctx.eventsOf('b').at(-1)).toBe('matchReady');
    });

    it('starts round 1 at matchReady, flip loser on turn', async () => {
      const ctx = setup();
      await bothSubmit(ctx);
      await settle();
      ctx.clock.at = T0 + REVEAL_MS;
      await vi.advanceTimersByTimeAsync(REVEAL_MS);

      const forA = ctx.last('a', 'matchReady');
      expect(forA).toMatchObject({
        sessionId: ctx.roomId,
        you: { id: 'a', lives: 3 },
        opponent: { id: 'b', lives: 3 },
        turn: 'opponent',
        round: { startedAt: T0 + REVEAL_MS, endsAt: T0 + REVEAL_MS + 15_000 },
        found: [],
      });
      expect(ctx.last('b', 'matchReady')).toMatchObject({ turn: 'you' });
      expect(ctx.rooms.get(ctx.roomId)?.phase).toBe('playing');
    });

    it('hands the playing room to the round loop', async () => {
      const ctx = setup();
      await bothSubmit(ctx);
      await settle();
      await vi.advanceTimersByTimeAsync(REVEAL_MS);
      expect(ctx.play.start).toHaveBeenCalledExactlyOnceWith(
        ctx.rooms.get(ctx.roomId),
      );
    });

    it('starts at once when loading outlasts the reveal', async () => {
      const ctx = setup();
      await bothSubmit(ctx);
      ctx.clock.at = T0 + REVEAL_MS * 3;
      await settle();
      expect(ctx.eventsOf('a').at(-1)).toBe('matchReady');
    });

    it('sends no player before matchReady, and none in it', async () => {
      const ctx = setup();
      await bothSubmit(ctx);
      await settle();
      await vi.advanceTimersByTimeAsync(REVEAL_MS);
      const json = JSON.stringify(ctx.sent);
      for (const name of NAMES) expect(json).not.toContain(name);
    });
  });

  describe('a failed start', () => {
    it('reports a pool emptied since the flip to both', async () => {
      const ctx = setup();
      ctx.selector.select.mockResolvedValue({ emptyBecause: 'era' });
      await bothSubmit(ctx);
      await settle();

      for (const id of ['a', 'b']) {
        expect(ctx.last(id, 'error')).toEqual({
          code: 'empty_pool',
          message: DUEL_START_MESSAGES.emptiedSinceFlip,
          retryAfterMs: null,
          emptyBecause: 'era',
        });
      }
      expect(ctx.rooms.roomOf('a')).toBeNull();
    });

    it('reports a squad that fails to load, logging the match only', async () => {
      const ctx = setup();
      const logged = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      ctx.squads.load.mockRejectedValue(new Error('Secret alfa'));
      await bothSubmit(ctx);
      await settle();

      expect(ctx.last('b', 'error')).toMatchObject({ code: 'server_error' });
      expect(ctx.rooms.roomOf('b')).toBeNull();
      expect(logged).toHaveBeenCalledExactlyOnceWith(
        'Duel start failed for match m-1 (Error)',
      );
      await vi.advanceTimersByTimeAsync(REVEAL_MS);
      expect(ctx.eventsOf('a')).not.toContain('matchReady');
    });
    it('reports a selector that fails before any match', async () => {
      const ctx = setup();
      const logged = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      ctx.selector.select.mockRejectedValue(new TypeError('pool'));
      await bothSubmit(ctx);
      await settle();

      expect(logged).toHaveBeenCalledExactlyOnceWith(
        'Duel start failed for match none (TypeError)',
      );
      expect(ctx.last('a', 'error')).toMatchObject({ code: 'server_error' });
      expect(ctx.squads.load).not.toHaveBeenCalled();
    });

    it('logs a thrown non-error by its type, never its value', async () => {
      const ctx = setup();
      const logged = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      ctx.squads.load.mockRejectedValue('Secret alfa');
      await bothSubmit(ctx);
      await settle();

      expect(logged).toHaveBeenCalledExactlyOnceWith(
        'Duel start failed for match m-1 (string)',
      );
    });

    it('sends nothing more when the room closed before the failure', async () => {
      const ctx = setup();
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      let reject!: (reason: Error) => void;
      ctx.squads.load.mockReturnValue(
        new Promise((_, fail) => {
          reject = fail;
        }),
      );
      await bothSubmit(ctx);
      await settle();
      ctx.service.drop('a');
      reject(new Error('load'));
      await settle();

      // B heard the opponent left, and only that
      expect(ctx.sent.filter((s) => s.event === 'error')).toEqual([
        {
          to: 'b',
          event: 'error',
          payload: expect.objectContaining({ code: 'session_over' }),
        },
      ]);
    });
  });

  describe('drop', () => {
    it('ends a room on filters and tells the other player', async () => {
      const ctx = setup();
      ctx.service.drop('a');
      expect(ctx.sent).toEqual([
        {
          to: 'b',
          event: 'error',
          payload: {
            code: 'session_over',
            message: MATCHMAKING_MESSAGES.opponentLeft,
            retryAfterMs: null,
          },
        },
      ]);
      expect(ctx.rooms.roomOf('b')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stops a start whose room ends while loading', async () => {
      const ctx = setup();
      await bothSubmit(ctx);
      ctx.service.drop('b');
      await settle();
      // Nothing is left waiting for a closed room
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(REVEAL_MS);
      expect(ctx.eventsOf('a')).not.toContain('matchReady');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stops a start whose room ends during the reveal', async () => {
      const ctx = setup();
      await bothSubmit(ctx);
      await settle();
      ctx.service.drop('a');
      await vi.advanceTimersByTimeAsync(REVEAL_MS);
      expect(ctx.eventsOf('b')).not.toContain('matchReady');
      expect(ctx.last('b', 'error')).toMatchObject({
        message: MATCHMAKING_MESSAGES.opponentLeft,
      });
    });

    it('hands a playing room to the round loop', async () => {
      const ctx = setup();
      await bothSubmit(ctx);
      await settle();
      await vi.advanceTimersByTimeAsync(REVEAL_MS);
      ctx.service.drop('a');
      expect(ctx.play.drop).toHaveBeenCalledExactlyOnceWith('a');
      expect(ctx.last('b', 'error')).toBeUndefined();
    });

    it('does nothing for a player in no room', () => {
      const ctx = setup();
      ctx.service.drop('z');
      expect(ctx.sent).toEqual([]);
    });
  });

  it('clears every timer on module destroy', async () => {
    const ctx = setup();
    ctx.service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    expect(ctx.sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
