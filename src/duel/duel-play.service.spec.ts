import { ApiException } from '@/common/api-exception.js';
import type { User } from '@/contract/auth.js';
import { duelPlayer } from '@/contract/contract.fixtures.js';
import { GRACE_MS, ROUND_MS } from '@/contract/constants.js';
import type { DuelEventMap } from '@/contract/duel.js';
import { DUEL_PLAY_MESSAGES } from '@/duel/duel-messages.js';
import type { DuelNotifier } from '@/duel/duel-notifier.js';
import { DuelPlayService, playRejection } from '@/duel/duel-play.service.js';
import type { PlayingRoom } from '@/duel/duel-room.js';
import { DuelRooms } from '@/duel/duel-rooms.js';
import { playingRoom, T0 } from '@/duel/duel.fixtures.js';
import { NAMES } from '@/matches/squad.fixtures.js';

const DEADLINE = ROUND_MS + GRACE_MS;

const user = (id: string): User => ({
  id,
  handle: `player-${id}`,
  isGuest: true,
  emailVerified: false,
  tier: 'free',
});

type Sent = { to: string; event: keyof DuelEventMap; payload: unknown };

// a holds seat 0 and is on turn at T0
function setup() {
  vi.setSystemTime(T0);
  const sent: Sent[] = [];
  const notifier = {
    toUser: (to: string, event: keyof DuelEventMap, payload: unknown) => {
      sent.push({ to, event, payload });
    },
  } as unknown as DuelNotifier;
  const rooms = new DuelRooms();
  const opened = rooms.open(duelPlayer('a'), duelPlayer('b'), T0);
  const room: PlayingRoom = { ...playingRoom(0), id: opened.id };
  rooms.save(room);
  const service = new DuelPlayService(rooms, notifier, {
    now: () => Date.now(),
  });
  service.start(room);

  const eventsOf = (to: string) =>
    sent.filter((s) => s.to === to).map((s) => s.event);
  const last = (to: string, event: keyof DuelEventMap) =>
    sent.filter((s) => s.to === to && s.event === event).at(-1)?.payload;
  const current = () => rooms.get(room.id) as PlayingRoom | null;
  const guess = (id: string, text: string) =>
    service.guess(user(id), { sessionId: room.id, guess: text });
  return { sent, rooms, room, service, eventsOf, last, current, guess };
}

function refusal(action: () => void) {
  try {
    action();
    return null;
  } catch (error) {
    if (error instanceof ApiException) return error.error;
    throw error;
  }
}

describe('DuelPlayService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe('guess', () => {
    it('reveals a correct name and hands the turn over', () => {
      const ctx = setup();
      vi.advanceTimersByTime(1_000);
      ctx.guess('a', 'alfa');

      expect(ctx.eventsOf('a')).toEqual([
        'guessResolved',
        'playerRevealed',
        'turnChanged',
        'roundStarted',
      ]);
      expect(ctx.eventsOf('b')).toEqual([
        'playerRevealed',
        'turnChanged',
        'roundStarted',
      ]);
      expect(ctx.current()?.timed.game.turn).toBe(1);
    });

    it('answers a miss to the guesser only, keeping the turn', () => {
      const ctx = setup();
      ctx.guess('a', 'zulu');
      expect(ctx.sent).toEqual([
        {
          to: 'a',
          event: 'guessResolved',
          payload: { outcome: 'not_in_xi' },
        },
      ]);
      expect(ctx.current()?.timed.game.turn).toBe(0);
    });

    it('refuses a guess out of turn, sending nothing', () => {
      const ctx = setup();
      expect(refusal(() => ctx.guess('b', 'alfa'))).toEqual({
        code: 'forbidden',
        message: DUEL_PLAY_MESSAGES.waitTurn,
        retryAfterMs: null,
      });
      expect(ctx.sent).toEqual([]);
    });

    it('refuses a guess for another duel', () => {
      const ctx = setup();
      expect(
        refusal(() =>
          ctx.service.guess(user('a'), { sessionId: 'other', guess: 'alfa' }),
        ),
      ).toMatchObject({
        code: 'invalid_input',
        message: DUEL_PLAY_MESSAGES.otherDuel,
      });
    });

    it('refuses a player with no duel running', () => {
      const ctx = setup();
      expect(
        refusal(() =>
          ctx.service.guess(user('z'), { sessionId: 'x', guess: 'alfa' }),
        ),
      ).toEqual({
        code: 'session_over',
        message: DUEL_PLAY_MESSAGES.notRunning,
        retryAfterMs: null,
      });
    });

    it('refuses a late guess, but still applies the expiry', () => {
      const ctx = setup();
      // The timer is beaten: the clock jumps alone
      vi.setSystemTime(T0 + DEADLINE + 5);
      expect(refusal(() => ctx.guess('a', 'alfa'))).toMatchObject({
        code: 'session_over',
        message: DUEL_PLAY_MESSAGES.roundOver,
      });
      expect(ctx.eventsOf('b')).toEqual([
        'lifeLost',
        'turnChanged',
        'roundStarted',
      ]);
      expect(ctx.current()?.timed.game.lives).toEqual([2, 3]);
    });
  });

  describe('the round timer', () => {
    it('costs the player on turn a life, with no input', () => {
      const ctx = setup();
      vi.advanceTimersByTime(DEADLINE);
      expect(ctx.sent).toEqual([]);

      vi.advanceTimersByTime(1);
      expect(ctx.last('b', 'lifeLost')).toEqual({
        who: 'opponent',
        lives: 2,
      });
      expect(ctx.current()?.timed.game.turn).toBe(1);
    });

    it('restarts the clock after a correct name', () => {
      const ctx = setup();
      vi.advanceTimersByTime(10_000);
      ctx.guess('a', 'alfa');
      vi.advanceTimersByTime(DEADLINE);
      expect(ctx.eventsOf('b')).not.toContain('lifeLost');

      vi.advanceTimersByTime(1);
      expect(ctx.last('a', 'lifeLost')).toEqual({ who: 'opponent', lives: 2 });
    });

    it('runs the duel out of lives by itself', () => {
      const ctx = setup();
      // Turns alternate: a loses on the fifth expiry
      vi.advanceTimersByTime((DEADLINE + 1) * 5);
      expect(ctx.last('a', 'finished')).toMatchObject({
        outcome: 'loss',
        isForfeit: false,
        you: { lives: 0 },
        opponent: { lives: 1 },
      });
      expect(ctx.last('b', 'finished')).toMatchObject({ outcome: 'win' });
      expect(ctx.rooms.roomOf('a')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('the end', () => {
    it('ends in a draw when all 11 are named', () => {
      const ctx = setup();
      NAMES.forEach((name, index) => ctx.guess(index % 2 ? 'b' : 'a', name));

      expect(ctx.last('a', 'finished')).toMatchObject({ outcome: 'draw' });
      expect(ctx.last('b', 'finished')).toMatchObject({ outcome: 'draw' });
      expect(ctx.rooms.roomOf('b')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('ends the duel on the catch-up before a guess lands', () => {
      const ctx = setup();
      // Five expiries are due: a runs out of lives
      vi.setSystemTime(T0 + (DEADLINE + 1) * 5);
      expect(refusal(() => ctx.guess('b', 'alfa'))).toEqual({
        code: 'session_over',
        message: DUEL_PLAY_MESSAGES.notRunning,
        retryAfterMs: null,
      });
      expect(ctx.last('b', 'finished')).toMatchObject({ outcome: 'win' });
      expect(ctx.eventsOf('b').filter((e) => e === 'lifeLost')).toHaveLength(5);
      expect(ctx.rooms.roomOf('b')).toBeNull();
    });

    it('refuses a forfeit the catch-up made too late', () => {
      const ctx = setup();
      vi.setSystemTime(T0 + (DEADLINE + 1) * 5);
      expect(refusal(() => ctx.service.forfeit(user('a')))).toEqual({
        code: 'forbidden',
        message: DUEL_PLAY_MESSAGES.noDuel,
        retryAfterMs: null,
      });
      // The clock decided it, not the forfeit
      expect(ctx.last('a', 'finished')).toMatchObject({
        outcome: 'loss',
        isForfeit: false,
      });
    });

    it('refuses a guess once the duel is over', () => {
      const ctx = setup();
      ctx.service.forfeit(user('a'));
      expect(refusal(() => ctx.guess('b', 'alfa'))).toMatchObject({
        code: 'session_over',
      });
    });
  });

  describe('forfeit', () => {
    it('loses for the forfeiter and wins for the other', () => {
      const ctx = setup();
      ctx.service.forfeit(user('b'));
      expect(ctx.last('b', 'finished')).toMatchObject({
        outcome: 'loss',
        isForfeit: true,
      });
      expect(ctx.last('a', 'finished')).toMatchObject({
        outcome: 'forfeit_win',
        isForfeit: true,
      });
      expect(ctx.rooms.roomOf('a')).toBeNull();
    });

    it('refuses a player with no duel to forfeit', () => {
      const ctx = setup();
      expect(refusal(() => ctx.service.forfeit(user('z')))).toEqual({
        code: 'forbidden',
        message: DUEL_PLAY_MESSAGES.noDuel,
        retryAfterMs: null,
      });
    });
  });

  describe('drop', () => {
    it('forfeits for the player who dropped', () => {
      const ctx = setup();
      ctx.service.drop('a');
      expect(ctx.last('b', 'finished')).toMatchObject({
        outcome: 'forfeit_win',
        isForfeit: true,
      });
      expect(ctx.rooms.roomOf('b')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does nothing for a player in no duel', () => {
      const ctx = setup();
      ctx.service.drop('z');
      expect(ctx.sent).toEqual([]);
    });
  });

  it('clears the round timer on module destroy', () => {
    const ctx = setup();
    ctx.service.onModuleDestroy();
    vi.advanceTimersByTime(DEADLINE * 3);
    expect(ctx.sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('playRejection', () => {
  it('fails loudly on a refusal a duel cannot get', () => {
    expect(() => playRejection('wrong_mode')).toThrow('refused as wrong_mode');
  });
});
