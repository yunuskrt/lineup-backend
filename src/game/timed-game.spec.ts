import type { Seat } from '@/game/engine.js';
import type { SquadEntry } from '@/game/matcher.js';
import {
  applyTimed,
  createTimedGame,
  nextDeadline,
  type TimedGame,
  type TimedInput,
} from '@/game/timed-game.js';

const NAMES = [
  'alfa',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf',
  'hotel',
  'india',
  'juliett',
  'kilo',
];
const SQUAD: SquadEntry[] = NAMES.map((name) => ({
  playerId: `p-${name}`,
  aliases: [name],
}));

const T0 = 1_000_000;
// Round n's deadline when every round expires
const due = (n: number) => T0 + n * 15_400;

const TICK: TimedInput = { kind: 'tick' };
const guess = (seat: Seat, text: string): TimedInput => ({
  kind: 'guess',
  seat,
  text,
});
const solo = () => createTimedGame({ mode: 'solo', squad: SQUAD }, T0);
const duel = () =>
  createTimedGame({ mode: 'duel', squad: SQUAD, firstSeat: 0 }, T0);

function run(timed: TimedGame, input: TimedInput, now: number): TimedGame {
  const step = applyTimed(timed, input, now);
  expect(step.rejected).toBeNull();
  return step.timed;
}

describe('createTimedGame', () => {
  it('starts round 1 at now', () => {
    const timed = solo();
    expect(timed.round).toEqual({ startedAt: T0, endsAt: T0 + 15_000 });
    expect(timed.game.round).toBe(1);
    expect(nextDeadline(timed)).toBe(due(1));
  });
});

describe('a guess in time', () => {
  it('stamps the round end and starts the next at now', () => {
    const step = applyTimed(solo(), guess(0, 'Alfa'), T0 + 5_000);
    expect(step.rejected).toBeNull();
    expect(step.effects.slice(-2)).toEqual([
      {
        kind: 'round_ended',
        round: 1,
        seat: 0,
        reason: 'found',
        endedAt: T0 + 5_000,
      },
      {
        kind: 'round_started',
        round: 2,
        seat: 0,
        startedAt: T0 + 5_000,
        endsAt: T0 + 20_000,
      },
    ]);
    expect(step.timed.round).toEqual({
      startedAt: T0 + 5_000,
      endsAt: T0 + 20_000,
    });
    expect(nextDeadline(step.timed)).toBe(T0 + 20_400);
  });

  it('keeps the same game and clock on a miss', () => {
    const timed = solo();
    const step = applyTimed(timed, guess(0, 'Nobody'), T0 + 5_000);
    expect(step.timed).toBe(timed);
    expect(step.effects).toEqual([
      { kind: 'guess_resolved', seat: 0, verdict: { kind: 'not_in_xi' } },
    ]);
  });

  it.each([T0 + 15_200, due(1)])(
    'accepts a guess in the grace window (%i)',
    (now) => {
      const step = applyTimed(solo(), guess(0, 'Alfa'), now);
      expect(step.rejected).toBeNull();
      expect(step.timed.game.lives).toEqual([3]);
      expect(step.timed.game.found).toHaveLength(1);
    },
  );
});

describe('a late guess', () => {
  it('expires the round and refuses the guess just past the deadline', () => {
    const step = applyTimed(solo(), guess(0, 'Alfa'), due(1) + 1);
    expect(step.rejected).toBe('round_over');
    expect(step.effects).toEqual([
      { kind: 'life_lost', seat: 0, lives: 2 },
      {
        kind: 'round_ended',
        round: 1,
        seat: 0,
        reason: 'expired',
        endedAt: due(1),
      },
      {
        kind: 'round_started',
        round: 2,
        seat: 0,
        startedAt: due(1),
        endsAt: due(1) + 15_000,
      },
    ]);
    expect(step.timed.game.found).toEqual([]);
    expect(step.timed.round?.startedAt).toBe(due(1));
  });

  it('refuses with session_over when catch-up ended the run', () => {
    const step = applyTimed(solo(), guess(0, 'Alfa'), due(3) + 1);
    expect(step.rejected).toBe('session_over');
    expect(step.timed.game.result).toEqual({
      mode: 'solo',
      endReason: 'lives_out',
      livesRemaining: 0,
    });
  });

  it('is refused in a duel too, without a prior tick', () => {
    const step = applyTimed(duel(), guess(1, 'Alfa'), due(1) + 1);
    expect(step.rejected).toBe('round_over');
    expect(step.timed.game).toMatchObject({ turn: 1, lives: [2, 3] });
  });
});

describe('tick', () => {
  it('changes nothing before the deadline', () => {
    const timed = solo();
    const step = applyTimed(timed, TICK, due(1));
    expect(step).toEqual({ timed, effects: [], rejected: null });
    expect(step.timed).toBe(timed);
  });

  it('applies every due expiry, chaining from each deadline', () => {
    const step = applyTimed(solo(), TICK, due(2) + 200);
    expect(step.rejected).toBeNull();
    expect(step.effects.filter((e) => e.kind === 'round_ended')).toEqual([
      {
        kind: 'round_ended',
        round: 1,
        seat: 0,
        reason: 'expired',
        endedAt: due(1),
      },
      {
        kind: 'round_ended',
        round: 2,
        seat: 0,
        reason: 'expired',
        endedAt: due(2),
      },
    ]);
    expect(step.timed.game).toMatchObject({ lives: [1], round: 3 });
    expect(step.timed.round).toEqual({
      startedAt: due(2),
      endsAt: due(2) + 15_000,
    });
  });

  it('ends a solo run lost by being away', () => {
    const step = applyTimed(solo(), TICK, T0 + 50_000);
    expect(step.effects.map((e) => e.kind)).toEqual([
      'life_lost',
      'round_ended',
      'round_started',
      'life_lost',
      'round_ended',
      'round_started',
      'life_lost',
      'round_ended',
      'game_over',
    ]);
    expect(step.timed.round).toBeNull();
    expect(nextDeadline(step.timed)).toBeNull();
  });

  it('hands the duel turn over at the deadline', () => {
    const step = applyTimed(duel(), TICK, due(1) + 3);
    expect(step.effects).toEqual([
      { kind: 'life_lost', seat: 0, lives: 2 },
      {
        kind: 'round_ended',
        round: 1,
        seat: 0,
        reason: 'expired',
        endedAt: due(1),
      },
      {
        kind: 'round_started',
        round: 2,
        seat: 1,
        startedAt: due(1),
        endsAt: due(1) + 15_000,
      },
    ]);
    const next = run(step.timed, guess(1, 'Alfa'), due(1) + 2_000);
    expect(next.game).toMatchObject({ turn: 0, round: 3 });
  });

  it('does nothing once the game is over', () => {
    const over = run(solo(), { kind: 'quit' }, T0 + 1_000);
    const step = applyTimed(over, TICK, T0 + 999_999);
    expect(step).toEqual({ timed: over, effects: [], rejected: null });
  });
});

describe('quit and forfeit', () => {
  it('stamps the quit round with now', () => {
    const step = applyTimed(solo(), { kind: 'quit' }, T0 + 4_000);
    expect(step.effects[0]).toEqual({
      kind: 'round_ended',
      round: 1,
      seat: 0,
      reason: 'ended',
      endedAt: T0 + 4_000,
    });
    expect(step.timed.round).toBeNull();
  });

  it('catches up before a quit', () => {
    const step = applyTimed(solo(), { kind: 'quit' }, due(1) + 500);
    expect(step.rejected).toBeNull();
    expect(step.effects.at(-1)).toEqual({
      kind: 'game_over',
      result: { mode: 'solo', endReason: 'quit', livesRemaining: 2 },
    });
  });

  it('refuses a quit when catch-up already ended the run', () => {
    const step = applyTimed(solo(), { kind: 'quit' }, due(3) + 1);
    expect(step.rejected).toBe('session_over');
    expect(step.effects.at(-1)).toEqual({
      kind: 'game_over',
      result: { mode: 'solo', endReason: 'lives_out', livesRemaining: 0 },
    });
  });

  it('refuses a forfeit when the clock already ended the duel', () => {
    // Seat 0 runs out on the 5th expiry
    const step = applyTimed(duel(), { kind: 'forfeit', seat: 0 }, due(5) + 1);
    expect(step.rejected).toBe('session_over');
    expect(step.effects.at(-1)).toEqual({
      kind: 'game_over',
      result: { mode: 'duel', outcomes: ['loss', 'win'], isForfeit: false },
    });
    expect(nextDeadline(step.timed)).toBeNull();
  });

  it('catches up before a forfeit', () => {
    const step = applyTimed(duel(), { kind: 'forfeit', seat: 0 }, due(1) + 900);
    expect(step.rejected).toBeNull();
    expect(step.effects.slice(-2)).toEqual([
      {
        kind: 'round_ended',
        round: 2,
        seat: 1,
        reason: 'ended',
        endedAt: due(1) + 900,
      },
      {
        kind: 'game_over',
        result: {
          mode: 'duel',
          outcomes: ['loss', 'forfeit_win'],
          isForfeit: true,
        },
      },
    ]);
  });
});

describe('a wall clock stepping back', () => {
  it('never ends a round before it started', () => {
    const started = run(solo(), guess(0, 'Alfa'), T0 + 5_000);
    const step = applyTimed(started, guess(0, 'Bravo'), T0 + 4_000);
    const ended = step.effects.find((e) => e.kind === 'round_ended');
    expect(ended).toMatchObject({ round: 2, endedAt: T0 + 5_000 });
    expect(step.timed.round?.startedAt).toBe(T0 + 5_000);
  });
});

describe('engine rejections', () => {
  it('passes one through with no effects in time', () => {
    const timed = duel();
    const step = applyTimed(timed, guess(1, 'Alfa'), T0 + 1_000);
    expect(step).toEqual({ timed, effects: [], rejected: 'not_your_turn' });
  });

  it('keeps catch-up effects alongside one', () => {
    const step = applyTimed(duel(), { kind: 'quit' }, due(1) + 1);
    expect(step.rejected).toBe('wrong_mode');
    expect(step.effects.map((e) => e.kind)).toEqual([
      'life_lost',
      'round_ended',
      'round_started',
    ]);
  });

  it('refuses an expire from a caller at compile time', () => {
    expectTypeOf<{ kind: 'expire' }>().not.toExtend<TimedInput>();
  });
});
