import { ApiException } from '@/common/api-exception.js';
import type { Clock } from '@/common/clock.js';
import type { User } from '@/contract/auth.js';
import type { DuelEventMap } from '@/contract/duel.js';
import type { DuelNotifier } from '@/duel/duel-notifier.js';
import { DuelRooms } from '@/duel/duel-rooms.js';
import { MATCHMAKING_MESSAGES } from '@/duel/duel-messages.js';
import type { DuelStartService } from '@/duel/duel-start.service.js';
import { MatchmakingService } from '@/duel/matchmaking.service.js';

const T0 = 1_000_000;
const TIMEOUT_MS = 60_000;

const user = (id: string): User => ({
  id,
  handle: `handle-${id}`,
  isGuest: true,
  emailVerified: false,
  tier: 'free',
});

const asPlayer = (id: string) => ({ id, handle: `handle-${id}`, lives: 3 });

type Sent = { to: string; event: keyof DuelEventMap; payload: unknown };

function setup() {
  const clock: Clock & { at: number } = { at: T0, now: () => clock.at };
  const sent: Sent[] = [];
  const notifier = {
    toUser: (to: string, event: keyof DuelEventMap, payload: unknown) => {
      sent.push({ to, event, payload });
    },
  } as unknown as DuelNotifier;
  const rooms = new DuelRooms();
  const start = { open: vi.fn(), drop: vi.fn() };
  const service = new MatchmakingService(
    rooms,
    notifier,
    start as unknown as DuelStartService,
    clock,
    TIMEOUT_MS,
  );
  const eventsOf = (to: string) =>
    sent.filter((s) => s.to === to).map((s) => s.event);
  return { clock, sent, rooms, start, service, eventsOf };
}

function refusal(action: () => void): ApiException['error'] | null {
  try {
    action();
    return null;
  } catch (error) {
    if (error instanceof ApiException) return error.error;
    throw error;
  }
}

describe('MatchmakingService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe('enter', () => {
    it('queues a lone player and tells them when', () => {
      const { service, sent, rooms } = setup();
      service.enter(user('a'));
      expect(sent).toEqual([
        { to: 'a', event: 'queued', payload: { phase: 'queued', since: T0 } },
      ]);
      expect(rooms.roomOf('a')).toBeNull();
    });

    it('pairs the newcomer with the waiting player', () => {
      const { service, sent, rooms, clock } = setup();
      service.enter(user('a'));
      clock.at = T0 + 500;
      service.enter(user('b'));

      expect(sent.slice(1)).toEqual([
        {
          to: 'b',
          event: 'queued',
          payload: { phase: 'queued', since: T0 + 500 },
        },
        {
          to: 'a',
          event: 'paired',
          payload: { phase: 'paired', opponent: asPlayer('b') },
        },
        {
          to: 'b',
          event: 'paired',
          payload: { phase: 'paired', opponent: asPlayer('a') },
        },
      ]);
      const room = rooms.roomOf('a');
      expect(room).toMatchObject({
        players: [asPlayer('a'), asPlayer('b')],
        pairedAt: T0 + 500,
      });
      expect(rooms.roomOf('b')).toBe(room);
    });

    it('hands the new room to the start of the duel', () => {
      const { service, rooms, start } = setup();
      service.enter(user('a'));
      service.enter(user('b'));
      expect(start.open).toHaveBeenCalledExactlyOnceWith(rooms.roomOf('a'));
    });

    it('pairs in order of arrival', () => {
      const { service, rooms } = setup();
      for (const id of ['a', 'b', 'c', 'd']) service.enter(user(id));
      expect(rooms.roomOf('a')?.players.map((p) => p.id)).toEqual(['a', 'b']);
      expect(rooms.roomOf('c')?.players.map((p) => p.id)).toEqual(['c', 'd']);
    });

    it('leaves the third player waiting', () => {
      const { service, rooms, eventsOf } = setup();
      for (const id of ['a', 'b', 'c']) service.enter(user(id));
      expect(rooms.roomOf('c')).toBeNull();
      expect(eventsOf('c')).toEqual(['queued']);
    });

    it('refuses a player already waiting', () => {
      const { service, sent } = setup();
      service.enter(user('a'));
      expect(refusal(() => service.enter(user('a')))).toEqual({
        code: 'forbidden',
        message: MATCHMAKING_MESSAGES.alreadyQueued,
        retryAfterMs: null,
      });
      expect(sent).toHaveLength(1);
    });

    it('refuses a player already in a room', () => {
      const { service } = setup();
      service.enter(user('a'));
      service.enter(user('b'));
      expect(refusal(() => service.enter(user('b')))).toMatchObject({
        code: 'forbidden',
        message: MATCHMAKING_MESSAGES.inDuel,
      });
    });
  });

  describe('leave', () => {
    it('takes a waiting player out of the queue', () => {
      const { service, rooms } = setup();
      service.enter(user('a'));
      service.leave('a');
      service.enter(user('b'));
      expect(rooms.roomOf('b')).toBeNull();
    });

    it('refuses a player who is not waiting', () => {
      const { service } = setup();
      expect(refusal(() => service.leave('a'))).toMatchObject({
        code: 'forbidden',
        message: MATCHMAKING_MESSAGES.notQueued,
      });
    });

    it('refuses a player who is already paired', () => {
      const { service } = setup();
      service.enter(user('a'));
      service.enter(user('b'));
      expect(refusal(() => service.leave('a'))).toMatchObject({
        message: MATCHMAKING_MESSAGES.notQueued,
      });
    });
  });

  describe('the timeout', () => {
    it('sends queueTimedOut with the time waited', () => {
      const { service, sent, clock } = setup();
      service.enter(user('a'));
      clock.at = T0 + TIMEOUT_MS + 3;
      vi.advanceTimersByTime(TIMEOUT_MS);
      expect(sent.at(-1)).toEqual({
        to: 'a',
        event: 'queueTimedOut',
        payload: { phase: 'queued', waitedMs: TIMEOUT_MS + 3 },
      });
    });

    it('leaves the player idle, free to enter again', () => {
      const { service, rooms } = setup();
      service.enter(user('a'));
      vi.advanceTimersByTime(TIMEOUT_MS);
      service.enter(user('b'));
      expect(rooms.roomOf('b')).toBeNull();
      service.enter(user('a'));
      expect(rooms.roomOf('a')?.players.map((p) => p.id)).toEqual(['b', 'a']);
    });

    it('never reports a negative wait', () => {
      const { service, sent, clock } = setup();
      service.enter(user('a'));
      clock.at = T0 - 10;
      vi.advanceTimersByTime(TIMEOUT_MS);
      expect(sent.at(-1)?.payload).toEqual({ phase: 'queued', waitedMs: 0 });
    });

    it.each([
      ['pairing', (s: MatchmakingService) => s.enter(user('b'))],
      ['leave', (s: MatchmakingService) => s.leave('a')],
      ['drop', (s: MatchmakingService) => s.drop('a')],
      ['module destroy', (s: MatchmakingService) => s.onModuleDestroy()],
    ])('is cleared on %s', (_, end) => {
      const { service, eventsOf } = setup();
      service.enter(user('a'));
      end(service);
      vi.advanceTimersByTime(TIMEOUT_MS * 2);
      expect(eventsOf('a')).not.toContain('queueTimedOut');
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('drop', () => {
    it('takes a waiting player out of the queue, silently', () => {
      const { service, sent, rooms } = setup();
      service.enter(user('a'));
      service.drop('a');
      service.enter(user('b'));
      expect(rooms.roomOf('b')).toBeNull();
      expect(sent.map((s) => s.event)).toEqual(['queued', 'queued']);
    });

    it('hands a paired player to the start of the duel', () => {
      const { service, start } = setup();
      service.enter(user('a'));
      service.enter(user('b'));
      service.drop('a');
      expect(start.drop).toHaveBeenCalledExactlyOnceWith('a');
    });

    it('sends nothing itself for an idle player', () => {
      const { service, sent } = setup();
      service.drop('a');
      expect(sent).toEqual([]);
    });
  });
});
