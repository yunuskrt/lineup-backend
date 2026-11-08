import { ApiException } from '@/common/api-exception.js';
import type { Clock } from '@/common/clock.js';
import type { User } from '@/contract/auth.js';
import { ROOM_WAIT_MS } from '@/contract/constants.js';
import type { DuelEventMap } from '@/contract/duel.js';
import type { Filters } from '@/contract/match.js';
import { NO_PREFERENCE } from '@/game/coin-flip.js';
import {
  DUEL_START_MESSAGES,
  MATCHMAKING_MESSAGES,
  ROOM_MESSAGES,
} from '@/duel/duel-messages.js';
import { ConnectionRegistry } from '@/duel/connection-registry.js';
import type { DuelNotifier } from '@/duel/duel-notifier.js';
import { DuelRooms } from '@/duel/duel-rooms.js';
import type { DuelStartService } from '@/duel/duel-start.service.js';
import { MatchmakingQueue } from '@/duel/matchmaking-queue.js';
import { PrivateRoomsService } from '@/duel/private-rooms.service.js';
import type { MatchSelectorService } from '@/matches/match-selector.service.js';

const T0 = 1_000_000;
const FILTERS: Filters = { ...NO_PREFERENCE, clubIds: ['liv'] };

const user = (id: string): User => ({
  id,
  handle: `handle-${id}`,
  isGuest: true,
  emailVerified: false,
  tier: 'free',
});

type Sent = { to: string; event: keyof DuelEventMap; payload: unknown };

// Codes come out AAAAAA, BBBBBB, … in turn
function setup() {
  const clock: Clock & { at: number } = { at: T0, now: () => clock.at };
  const sent: Sent[] = [];
  const notifier = {
    toUser: (to: string, event: keyof DuelEventMap, payload: unknown) => {
      sent.push({ to, event, payload });
    },
  } as unknown as DuelNotifier;
  const connections = new ConnectionRegistry<{ id: string }>();
  const queue = new MatchmakingQueue();
  const duels = new DuelRooms();
  const start = { openFlipped: vi.fn() };
  const selector = { check: vi.fn().mockResolvedValue(null) };
  let draws = 0;
  const pick = () => Math.floor(draws++ / 6) % 31;
  const service = new PrivateRoomsService(
    connections as unknown as ConnectionRegistry,
    queue,
    duels,
    notifier,
    start as unknown as DuelStartService,
    selector as unknown as MatchSelectorService,
    clock,
    ROOM_WAIT_MS,
    pick,
  );
  const eventsOf = (to: string) =>
    sent.filter((s) => s.to === to).map((s) => s.event);
  const last = (to: string, event: keyof DuelEventMap) =>
    sent.filter((s) => s.to === to && s.event === event).at(-1)?.payload;
  // Each user on socket s-<id>, as the gateway sends
  const create = (id: string, filters: Filters = FILTERS) => {
    connections.register(id, { id: `s-${id}` });
    return service.create(user(id), filters, `s-${id}`);
  };
  return {
    clock,
    sent,
    connections,
    queue,
    duels,
    start,
    selector,
    service,
    create,
    eventsOf,
    last,
  };
}

async function refusal(action: () => unknown) {
  try {
    await action();
    return null;
  } catch (error) {
    if (error instanceof ApiException) return error.error;
    throw error;
  }
}

describe('PrivateRoomsService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe('create', () => {
    it('sends roomCreated with the code, filters and expiry', async () => {
      const ctx = setup();
      await ctx.create('a');
      expect(ctx.sent).toEqual([
        {
          to: 'a',
          event: 'roomCreated',
          payload: {
            code: 'AAAAAA',
            filters: FILTERS,
            expiresAt: T0 + ROOM_WAIT_MS,
          },
        },
      ]);
      expect(ctx.selector.check).toHaveBeenCalledWith(FILTERS);
      expect(ctx.service.isHosting('a')).toBe(true);
    });

    it('stores nothing when the pool is empty', async () => {
      const ctx = setup();
      ctx.selector.check.mockResolvedValueOnce('club');
      expect(await refusal(() => ctx.create('a'))).toMatchObject({
        code: 'empty_pool',
        message: DUEL_START_MESSAGES.emptyPool,
        emptyBecause: 'club',
      });
      expect(ctx.service.isHosting('a')).toBe(false);
      expect(ctx.sent).toEqual([]);
    });

    it('refuses a creator who already hosts a room', async () => {
      const ctx = setup();
      await ctx.create('a');
      expect(await refusal(() => ctx.create('a'))).toMatchObject({
        code: 'forbidden',
        message: ROOM_MESSAGES.alreadyHosting,
      });
    });

    it('refuses a queued player', async () => {
      const ctx = setup();
      ctx.queue.enter({ id: 'a', handle: 'handle-a', lives: 3 }, T0);
      expect(await refusal(() => ctx.create('a'))).toMatchObject({
        code: 'forbidden',
        message: MATCHMAKING_MESSAGES.alreadyQueued,
      });
    });

    it('refuses a player in a duel', async () => {
      const ctx = setup();
      ctx.duels.open(
        { id: 'a', handle: 'handle-a', lives: 3 },
        { id: 'x', handle: 'handle-x', lives: 3 },
        T0,
      );
      expect(await refusal(() => ctx.create('a'))).toMatchObject({
        code: 'forbidden',
        message: MATCHMAKING_MESSAGES.inDuel,
      });
    });

    it('re-checks after the pool check, which a queue entry may beat', async () => {
      const ctx = setup();
      ctx.selector.check.mockImplementationOnce(async () => {
        ctx.queue.enter({ id: 'a', handle: 'handle-a', lives: 3 }, T0);
        return null;
      });
      expect(await refusal(() => ctx.create('a'))).toMatchObject({
        code: 'forbidden',
      });
      expect(ctx.service.isHosting('a')).toBe(false);
    });

    it('stores nothing when the socket closed during the pool check', async () => {
      const ctx = setup();
      ctx.selector.check.mockImplementationOnce(async () => {
        ctx.connections.remove('a', { id: 's-a' });
        return null;
      });
      await ctx.create('a');
      expect(ctx.service.isHosting('a')).toBe(false);
      expect(ctx.sent).toEqual([]);
      await vi.advanceTimersByTimeAsync(ROOM_WAIT_MS);
      expect(ctx.sent).toEqual([]);
    });

    it('stores nothing when a new socket took over meanwhile', async () => {
      const ctx = setup();
      ctx.selector.check.mockImplementationOnce(async () => {
        ctx.connections.register('a', { id: 's-a-new' });
        return null;
      });
      await ctx.create('a');
      expect(ctx.service.isHosting('a')).toBe(false);
      expect(ctx.sent).toEqual([]);
    });

    it('gives a second room a code of its own', async () => {
      const ctx = setup();
      await ctx.create('a');
      await ctx.create('b');
      expect(ctx.last('b', 'roomCreated')).toMatchObject({ code: 'BBBBBB' });
    });
  });

  describe('join', () => {
    it('pairs creator at seat 0 and joiner at seat 1, then starts', async () => {
      const ctx = setup();
      await ctx.create('a');
      ctx.service.join(user('b'), 'AAAAAA');

      const duel = ctx.duels.roomOf('a');
      expect(duel).toMatchObject({
        origin: 'room',
        phase: 'flipping',
        flip: { winner: 0, filters: FILTERS },
      });
      expect(duel?.players.map((p) => p.id)).toEqual(['a', 'b']);
      expect(ctx.duels.roomOf('b')).toBe(duel);
      expect(ctx.last('a', 'paired')).toEqual({
        phase: 'paired',
        opponent: { id: 'b', handle: 'handle-b', lives: 3 },
      });
      expect(ctx.last('b', 'paired')).toEqual({
        phase: 'paired',
        opponent: { id: 'a', handle: 'handle-a', lives: 3 },
      });
      expect(ctx.start.openFlipped).toHaveBeenCalledExactlyOnceWith(duel);
      expect(ctx.service.isHosting('a')).toBe(false);
    });

    it('is not_found for a wrong code', async () => {
      const ctx = setup();
      expect(
        await refusal(() => ctx.service.join(user('b'), 'ZZZZZZ')),
      ).toMatchObject({
        code: 'not_found',
        message: ROOM_MESSAGES.noRoom,
      });
    });

    it('is not_found for a second join with the same code (D2)', async () => {
      const ctx = setup();
      await ctx.create('a');
      ctx.service.join(user('b'), 'AAAAAA');
      expect(
        await refusal(() => ctx.service.join(user('c'), 'AAAAAA')),
      ).toMatchObject({ code: 'not_found' });
    });

    it('refuses your own room', async () => {
      const ctx = setup();
      await ctx.create('a');
      expect(
        await refusal(() => ctx.service.join(user('a'), 'AAAAAA')),
      ).toMatchObject({ code: 'forbidden', message: ROOM_MESSAGES.ownRoom });
    });

    it("refuses a creator joining someone else's room", async () => {
      const ctx = setup();
      await ctx.create('a');
      await ctx.create('b');
      expect(
        await refusal(() => ctx.service.join(user('a'), 'BBBBBB')),
      ).toMatchObject({
        code: 'forbidden',
        message: ROOM_MESSAGES.alreadyHosting,
      });
    });

    it('refuses a queued player, before looking up the code', async () => {
      const ctx = setup();
      await ctx.create('a');
      ctx.queue.enter({ id: 'b', handle: 'handle-b', lives: 3 }, T0);
      expect(
        await refusal(() => ctx.service.join(user('b'), 'AAAAAA')),
      ).toMatchObject({
        code: 'forbidden',
        message: MATCHMAKING_MESSAGES.alreadyQueued,
      });
      expect(ctx.service.isHosting('a')).toBe(true);
    });
  });

  describe('leave', () => {
    it('frees the code: a join after it is not_found', async () => {
      const ctx = setup();
      await ctx.create('a');
      ctx.service.leave('a');
      expect(ctx.service.isHosting('a')).toBe(false);
      expect(
        await refusal(() => ctx.service.join(user('b'), 'AAAAAA')),
      ).toMatchObject({ code: 'not_found' });
      expect(ctx.eventsOf('a')).toEqual(['roomCreated']);
    });

    it('refuses a player with no open room', async () => {
      const ctx = setup();
      expect(await refusal(() => ctx.service.leave('a'))).toMatchObject({
        code: 'forbidden',
        message: ROOM_MESSAGES.notHosting,
      });
    });
  });

  describe('the wait', () => {
    it('expires the room after 10 minutes with roomExpired', async () => {
      const ctx = setup();
      await ctx.create('a');
      await vi.advanceTimersByTimeAsync(ROOM_WAIT_MS - 1);
      expect(ctx.eventsOf('a')).toEqual(['roomCreated']);

      await vi.advanceTimersByTimeAsync(1);
      expect(ctx.last('a', 'roomExpired')).toEqual({ code: 'AAAAAA' });
      expect(ctx.service.isHosting('a')).toBe(false);
      expect(
        await refusal(() => ctx.service.join(user('b'), 'AAAAAA')),
      ).toMatchObject({ code: 'not_found' });
    });

    it('never fires for a room that was joined', async () => {
      const ctx = setup();
      await ctx.create('a');
      ctx.service.join(user('b'), 'AAAAAA');
      await vi.advanceTimersByTimeAsync(ROOM_WAIT_MS);
      expect(ctx.eventsOf('a')).not.toContain('roomExpired');
    });

    it('never fires for a room that was left', async () => {
      const ctx = setup();
      await ctx.create('a');
      ctx.service.leave('a');
      await vi.advanceTimersByTimeAsync(ROOM_WAIT_MS);
      expect(ctx.eventsOf('a')).toEqual(['roomCreated']);
    });
  });

  describe('shutdown', () => {
    it('stops every waiting room, so no expiry fires', async () => {
      const ctx = setup();
      await ctx.create('a');
      await ctx.create('b');
      ctx.service.onModuleDestroy();
      expect(ctx.service.isHosting('a')).toBe(false);
      expect(ctx.service.isHosting('b')).toBe(false);
      await vi.advanceTimersByTimeAsync(ROOM_WAIT_MS);
      expect(ctx.eventsOf('a')).toEqual(['roomCreated']);
      expect(ctx.eventsOf('b')).toEqual(['roomCreated']);
    });
  });

  describe('drop', () => {
    it("closes the creator's room at once, sending nothing", async () => {
      const ctx = setup();
      await ctx.create('a');
      expect(ctx.service.drop('a')).toBe(true);
      expect(ctx.service.isHosting('a')).toBe(false);
      await vi.advanceTimersByTimeAsync(ROOM_WAIT_MS);
      expect(ctx.eventsOf('a')).toEqual(['roomCreated']);
    });

    it('is false for a player with no room', () => {
      expect(setup().service.drop('a')).toBe(false);
    });
  });
});
