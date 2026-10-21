import { ApiException } from '@/common/api-exception.js';
import type { User } from '@/contract/auth.js';
import { duelPlayer } from '@/contract/contract.fixtures.js';
import { GRACE_MS, ROUND_MS } from '@/contract/constants.js';
import type { DuelEventMap } from '@/contract/duel.js';
import { DUEL_PLAY_MESSAGES } from '@/duel/duel-messages.js';
import type { DuelNotifier } from '@/duel/duel-notifier.js';
import type { DuelPersistenceService } from '@/duel/duel-persistence.service.js';
import { DuelPlayService, playRejection } from '@/duel/duel-play.service.js';
import type { PlayingRoom } from '@/duel/duel-room.js';
import { DuelRooms } from '@/duel/duel-rooms.js';
import type { DuelSocket } from '@/duel/duel.gateway.js';
import { playingRoom, T0 } from '@/duel/duel.fixtures.js';
import { NAMES } from '@/matches/squad.fixtures.js';

const DEADLINE = ROUND_MS + GRACE_MS;
const WINDOW_MS = 20_000;
const SOCKET = { id: 's-new' } as unknown as DuelSocket;

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
    toSocket: (
      socket: { id: string },
      event: keyof DuelEventMap,
      payload: unknown,
    ) => {
      sent.push({ to: `socket:${socket.id}`, event, payload });
    },
  } as unknown as DuelNotifier;
  // Each finished room, and what had gone out by then
  const recorded: { room: PlayingRoom; sentBefore: number }[] = [];
  const persistence = {
    record: (finished: PlayingRoom) => {
      recorded.push({ room: finished, sentBefore: sent.length });
    },
  } as unknown as DuelPersistenceService;
  const rooms = new DuelRooms();
  const opened = rooms.open(duelPlayer('a'), duelPlayer('b'), T0);
  const room: PlayingRoom = { ...playingRoom(0), id: opened.id };
  rooms.save(room);
  const service = new DuelPlayService(
    rooms,
    notifier,
    persistence,
    { now: () => Date.now() },
    WINDOW_MS,
  );
  service.start(room);

  const eventsOf = (to: string) =>
    sent.filter((s) => s.to === to).map((s) => s.event);
  const last = (to: string, event: keyof DuelEventMap) =>
    sent.filter((s) => s.to === to && s.event === event).at(-1)?.payload;
  const current = () => rooms.get(room.id) as PlayingRoom | null;
  const guess = (id: string, text: string) =>
    service.guess(user(id), { sessionId: room.id, guess: text });
  return {
    sent,
    recorded,
    rooms,
    room,
    service,
    eventsOf,
    last,
    current,
    guess,
  };
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

  describe('a drop', () => {
    it('opens a window and tells the opponent', () => {
      const ctx = setup();
      ctx.service.drop('b');
      expect(ctx.sent).toEqual([
        {
          to: 'a',
          event: 'opponentConnection',
          payload: {
            status: 'reconnecting',
            reconnectDeadline: T0 + WINDOW_MS,
          },
        },
      ]);
      expect(ctx.current()?.away).toEqual([null, T0 + WINDOW_MS]);
    });

    it('opens one window, however often the seat drops', () => {
      const ctx = setup();
      ctx.service.drop('b');
      vi.advanceTimersByTime(1_000);
      ctx.service.drop('b');
      expect(ctx.eventsOf('a')).toEqual(['opponentConnection']);
      expect(ctx.current()?.away).toEqual([null, T0 + WINDOW_MS]);
    });

    it('lets the clock run while the seat is away', () => {
      const ctx = setup();
      ctx.service.drop('a');
      vi.advanceTimersByTime(DEADLINE + 1);
      expect(ctx.last('b', 'lifeLost')).toEqual({ who: 'opponent', lives: 2 });
    });

    it('forfeits the seat once the window runs out', () => {
      const ctx = setup();
      ctx.service.drop('b');
      vi.advanceTimersByTime(WINDOW_MS - 1);
      expect(ctx.eventsOf('a')).not.toContain('finished');

      vi.advanceTimersByTime(1);
      expect(ctx.eventsOf('a').slice(-2)).toEqual([
        'opponentConnection',
        'finished',
      ]);
      expect(
        ctx.sent.filter((s) => s.event === 'opponentConnection').at(-1),
      ).toMatchObject({
        payload: { status: 'forfeited', reconnectDeadline: null },
      });
      expect(ctx.last('a', 'finished')).toMatchObject({
        outcome: 'forfeit_win',
        isForfeit: true,
      });
      expect(ctx.rooms.roomOf('a')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('ends on lives, not a forfeit, if the clock gets there first', () => {
      const ctx = setup();
      // Four expiries, alternating: a is down to 1
      vi.advanceTimersByTime((DEADLINE + 1) * 4);
      ctx.service.drop('a');
      vi.advanceTimersByTime(DEADLINE + 1);

      expect(ctx.last('b', 'finished')).toMatchObject({
        outcome: 'win',
        isForfeit: false,
      });
      const notices = ctx.sent.filter((s) => s.event === 'opponentConnection');
      expect(notices.map((s) => s.payload)).toEqual([
        { status: 'reconnecting', reconnectDeadline: expect.any(Number) },
      ]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('forfeits the first seat to run out when both are away', () => {
      const ctx = setup();
      ctx.service.drop('a');
      vi.advanceTimersByTime(1_000);
      ctx.service.drop('b');
      vi.advanceTimersByTime(WINDOW_MS);

      expect(ctx.last('b', 'finished')).toMatchObject({
        outcome: 'forfeit_win',
      });
      expect(ctx.last('a', 'finished')).toMatchObject({ outcome: 'loss' });
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does nothing for a player in no duel', () => {
      const ctx = setup();
      ctx.service.drop('z');
      expect(ctx.sent).toEqual([]);
    });
  });

  describe('rejoin', () => {
    it('resumes inside the window and tells both', () => {
      const ctx = setup();
      ctx.service.drop('a');
      vi.advanceTimersByTime(5_000);
      ctx.service.rejoin('a', SOCKET);

      const back = ctx.sent.filter((s) => s.to === 'socket:s-new');
      expect(back.map((s) => s.event)).toEqual(['disconnected', 'matchReady']);
      expect(back[0].payload).toEqual({
        status: 'connected',
        reconnectDeadline: null,
      });
      expect(back[1].payload).toMatchObject({
        sessionId: ctx.room.id,
        you: { id: 'a' },
        turn: 'you',
      });
      expect(ctx.last('b', 'opponentConnection')).toEqual({
        status: 'connected',
        reconnectDeadline: null,
      });
      expect(ctx.current()?.away).toEqual([null, null]);
    });

    it('closes the window, so it never forfeits', () => {
      const ctx = setup();
      ctx.service.drop('b');
      ctx.service.rejoin('b', SOCKET);
      vi.advanceTimersByTime(WINDOW_MS + 1);
      expect(ctx.sent.map((s) => s.event)).not.toContain('finished');
    });

    it('shows the clock as it is now', () => {
      const ctx = setup();
      ctx.service.drop('a');
      // The round timer is late: catch-up first
      vi.setSystemTime(T0 + DEADLINE + 5);
      ctx.service.rejoin('a', SOCKET);
      const snapshot = ctx.sent.find(
        (s) => s.to === 'socket:s-new' && s.event === 'matchReady',
      );
      expect(snapshot?.payload).toMatchObject({
        you: { lives: 2 },
        turn: 'opponent',
      });
    });

    it('keeps the first window from ending a second absence early', () => {
      const ctx = setup();
      ctx.service.drop('b');
      ctx.service.rejoin('b', SOCKET);
      vi.advanceTimersByTime(3_000);
      ctx.service.drop('b');

      // The first window would have ended here
      vi.advanceTimersByTime(WINDOW_MS - 3_000);
      expect(ctx.eventsOf('a')).not.toContain('finished');
      vi.advanceTimersByTime(3_000);
      expect(ctx.last('a', 'finished')).toMatchObject({
        outcome: 'forfeit_win',
      });
    });

    it('opens a fresh window on a second drop', () => {
      const ctx = setup();
      ctx.service.drop('b');
      ctx.service.rejoin('b', SOCKET);
      vi.advanceTimersByTime(3_000);
      ctx.service.drop('b');
      expect(ctx.current()?.away).toEqual([null, T0 + 3_000 + WINDOW_MS]);
    });

    it('hands a replacing socket the duel, telling nobody else', () => {
      const ctx = setup();
      ctx.service.rejoin('b', SOCKET);
      expect(ctx.sent).toEqual([
        expect.objectContaining({ to: 'socket:s-new', event: 'matchReady' }),
      ]);
    });

    it('sends no snapshot when the catch-up ends the duel', () => {
      const ctx = setup();
      // Four expiries: a is down to 1, and on turn
      vi.advanceTimersByTime((DEADLINE + 1) * 4);
      ctx.service.drop('a');
      // The round timer hasn't run yet: rejoin is first
      vi.setSystemTime(Date.now() + DEADLINE + 5);
      ctx.service.rejoin('a', SOCKET);

      expect(ctx.last('a', 'finished')).toMatchObject({ outcome: 'loss' });
      expect(ctx.sent.filter((s) => s.to === 'socket:s-new')).toEqual([]);
      expect(ctx.rooms.roomOf('a')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does nothing for a player in no duel', () => {
      const ctx = setup();
      ctx.service.rejoin('z', SOCKET);
      expect(ctx.sent).toEqual([]);
    });
  });

  it('knows who is playing, and stops once the duel ends', () => {
    const ctx = setup();
    expect(ctx.service.isPlaying('a')).toBe(true);
    expect(ctx.service.isPlaying('z')).toBe(false);
    ctx.service.forfeit(user('a'));
    expect(ctx.service.isPlaying('b')).toBe(false);
  });

  it('clears the round timer and every window on module destroy', () => {
    const ctx = setup();
    ctx.service.drop('b');
    ctx.service.onModuleDestroy();
    vi.advanceTimersByTime(DEADLINE * 3);
    expect(ctx.eventsOf('a')).toEqual(['opponentConnection']);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('DuelPlayService record', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const kinds = (room: PlayingRoom | null) =>
    room?.effects.map((effect) => effect.kind);

  it('logs every effect, from guesses and from the clock', () => {
    const ctx = setup();
    ctx.guess('a', 'zulu');
    expect(kinds(ctx.current())).toEqual(['guess_resolved']);

    ctx.guess('a', 'alfa');
    vi.advanceTimersByTime(DEADLINE + 1);
    expect(kinds(ctx.current())).toEqual([
      'guess_resolved',
      'guess_resolved',
      'player_revealed',
      'round_ended',
      'round_started',
      'life_lost',
      'round_ended',
      'round_started',
    ]);
    expect(ctx.recorded).toEqual([]);
  });

  it('logs nothing for a refused guess', () => {
    const ctx = setup();
    ctx.guess('a', 'zulu');
    refusal(() => ctx.guess('b', 'alfa'));
    expect(kinds(ctx.current())).toEqual(['guess_resolved']);
  });

  it('keeps the catch-up a late guess brought', () => {
    const ctx = setup();
    vi.setSystemTime(T0 + DEADLINE + 5);
    refusal(() => ctx.guess('a', 'alfa'));
    expect(kinds(ctx.current())).toEqual([
      'life_lost',
      'round_ended',
      'round_started',
    ]);
  });

  it.each([
    ['lives out', () => vi.advanceTimersByTime((DEADLINE + 1) * 5)],
    [
      'a forfeit',
      (ctx: ReturnType<typeof setup>) => ctx.service.forfeit(user('b')),
    ],
    [
      'an expired window',
      (ctx: ReturnType<typeof setup>) => {
        ctx.service.drop('b');
        vi.advanceTimersByTime(WINDOW_MS);
      },
    ],
    [
      'all 11 named',
      (ctx: ReturnType<typeof setup>) =>
        NAMES.forEach((name, index) => ctx.guess(index % 2 ? 'b' : 'a', name)),
    ],
  ])('hands over the duel once on %s', (_, end) => {
    const ctx = setup();
    end(ctx);
    vi.advanceTimersByTime(60_000);

    expect(ctx.recorded).toHaveLength(1);
    const [{ room, sentBefore }] = ctx.recorded;
    expect(room.id).toBe(ctx.room.id);
    expect(room.timed.game.result).not.toBeNull();
    expect(room.effects.at(-1)?.kind).toBe('game_over');
    expect(room.effects.filter((e) => e.kind === 'round_ended')).toHaveLength(
      room.timed.game.round,
    );
    // Recorded before the finished events go out
    expect(ctx.sent.slice(sentBefore).map((s) => s.event)).toContain(
      'finished',
    );
    expect(ctx.sent.slice(0, sentBefore).map((s) => s.event)).not.toContain(
      'finished',
    );
  });
});

describe('playRejection', () => {
  it('fails loudly on a refusal a duel cannot get', () => {
    expect(() => playRejection('wrong_mode')).toThrow('refused as wrong_mode');
  });
});
