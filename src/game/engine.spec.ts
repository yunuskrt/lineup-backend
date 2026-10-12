import {
  applyInput,
  createGame,
  type GameInput,
  type GameState,
  type Seat,
  type Step,
} from '@/game/engine.js';
import type { SquadEntry } from '@/game/matcher.js';

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

function ok(step: Step) {
  if ('rejected' in step) throw new Error(`Rejected: ${step.rejected}`);
  return step;
}

function play(state: GameState, inputs: GameInput[]): GameState {
  return inputs.reduce(
    (current, input) => ok(applyInput(current, input)).state,
    state,
  );
}

function guess(seat: Seat, text: string): GameInput {
  return { kind: 'guess', seat, text };
}

const EXPIRE: GameInput = { kind: 'expire' };
const solo = () => createGame({ mode: 'solo', squad: SQUAD });
const duel = (firstSeat: Seat = 0) =>
  createGame({ mode: 'duel', squad: SQUAD, firstSeat });

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('createGame', () => {
  it('starts solo on seat 0 with 3 lives', () => {
    expect(solo()).toEqual({
      mode: 'solo',
      squad: SQUAD,
      lives: [3],
      found: [],
      turn: 0,
      round: 1,
      result: null,
    });
  });

  it.each<Seat>([0, 1])('starts a duel on seat %i', (firstSeat) => {
    const state = duel(firstSeat);
    expect(state.turn).toBe(firstSeat);
    expect(state.lives).toEqual([3, 3]);
  });

  it('refuses a squad that is not 11 starters', () => {
    expect(() => createGame({ mode: 'solo', squad: SQUAD.slice(1) })).toThrow(
      'A game needs exactly 11 starters',
    );
  });
});

describe('a guess', () => {
  it('reveals a new player and keeps the solo seat', () => {
    const step = ok(applyInput(solo(), guess(0, 'Delta')));
    expect(step.effects).toEqual([
      {
        kind: 'guess_resolved',
        seat: 0,
        verdict: { kind: 'correct_new', playerId: 'p-delta' },
      },
      { kind: 'player_revealed', seat: 0, playerId: 'p-delta' },
      { kind: 'round_ended', round: 1, seat: 0, reason: 'found' },
      { kind: 'round_started', round: 2, seat: 0 },
    ]);
    expect(step.state).toMatchObject({
      found: [{ playerId: 'p-delta', foundBy: 0 }],
      turn: 0,
      round: 2,
      lives: [3],
    });
  });

  it('hands a duel turn over on a new player', () => {
    const step = ok(applyInput(duel(1), guess(1, 'Delta')));
    expect(step.effects.at(-1)).toEqual({
      kind: 'round_started',
      round: 2,
      seat: 0,
    });
    expect(step.state.turn).toBe(0);
    expect(step.state.found).toEqual([{ playerId: 'p-delta', foundBy: 1 }]);
  });

  it('leaves the round running when already found', () => {
    const state = play(duel(), [guess(0, 'Delta')]);
    const step = ok(applyInput(state, guess(1, 'delta')));
    expect(step.state).toBe(state);
    expect(step.effects).toEqual([
      {
        kind: 'guess_resolved',
        seat: 1,
        verdict: { kind: 'already_found', playerId: 'p-delta' },
      },
    ]);
  });

  it('leaves the solo round running when already found', () => {
    const state = play(solo(), [guess(0, 'Delta')]);
    const step = ok(applyInput(state, guess(0, 'Delta')));
    expect(step.state).toBe(state);
    expect(step.effects).toEqual([
      {
        kind: 'guess_resolved',
        seat: 0,
        verdict: { kind: 'already_found', playerId: 'p-delta' },
      },
    ]);
  });

  it.each<[string, () => GameState, Seat]>([
    ['solo', solo, 0],
    ['duel', () => duel(1), 1],
  ])('leaves the %s round running when not in the XI', (_, make, seat) => {
    const state = make();
    const step = ok(applyInput(state, guess(seat, 'Zinedine Zidane')));
    expect(step.state).toBe(state);
    expect(step.effects).toEqual([
      { kind: 'guess_resolved', seat, verdict: { kind: 'not_in_xi' } },
    ]);
  });
});

describe('an expiry', () => {
  it('costs a life and keeps the solo seat', () => {
    const step = ok(applyInput(solo(), EXPIRE));
    expect(step.effects).toEqual([
      { kind: 'life_lost', seat: 0, lives: 2 },
      { kind: 'round_ended', round: 1, seat: 0, reason: 'expired' },
      { kind: 'round_started', round: 2, seat: 0 },
    ]);
    expect(step.state).toMatchObject({ lives: [2], turn: 0, round: 2 });
  });

  it('costs the holder a life and hands the duel turn over', () => {
    const step = ok(applyInput(duel(1), EXPIRE));
    expect(step.effects[0]).toEqual({ kind: 'life_lost', seat: 1, lives: 2 });
    expect(step.state).toMatchObject({ lives: [3, 2], turn: 0, round: 2 });
  });
});

describe('a full game', () => {
  it('ends solo in a perfect clear on the 11th name', () => {
    const state = play(solo(), [
      EXPIRE,
      ...NAMES.slice(1).map((n) => guess(0, n)),
    ]);
    const step = ok(applyInput(state, guess(0, 'Alfa')));
    expect(step.effects.slice(-2)).toEqual([
      { kind: 'round_ended', round: 12, seat: 0, reason: 'found' },
      {
        kind: 'game_over',
        result: { mode: 'solo', endReason: 'perfect_clear', livesRemaining: 2 },
      },
    ]);
    expect(step.state.found).toHaveLength(11);
  });

  it('ends solo on the last life', () => {
    const state = play(solo(), [guess(0, 'Alfa'), EXPIRE, EXPIRE]);
    const step = ok(applyInput(state, EXPIRE));
    expect(step.effects).toEqual([
      { kind: 'life_lost', seat: 0, lives: 0 },
      { kind: 'round_ended', round: 4, seat: 0, reason: 'expired' },
      {
        kind: 'game_over',
        result: { mode: 'solo', endReason: 'lives_out', livesRemaining: 0 },
      },
    ]);
    expect(step.state.result).not.toBeNull();
  });

  it('ends a duel in a draw on the 11th name', () => {
    const inputs = NAMES.slice(0, 10).map((name, index) =>
      guess(index % 2 === 0 ? 0 : 1, name),
    );
    const state = play(duel(), inputs);
    expect(state.turn).toBe(0);
    const step = ok(applyInput(state, guess(0, 'Kilo')));
    expect(step.effects.at(-1)).toEqual({
      kind: 'game_over',
      result: { mode: 'duel', outcomes: ['draw', 'draw'], isForfeit: false },
    });
    expect(step.state.lives).toEqual([3, 3]);
  });

  it.each<[Seat, [string, string]]>([
    [0, ['loss', 'win']],
    [1, ['win', 'loss']],
  ])('ends a duel when seat %i runs out of lives', (loser, outcomes) => {
    // The other seat expires in between
    const state = play(duel(loser), [EXPIRE, EXPIRE, EXPIRE, EXPIRE]);
    expect(state.lives[loser]).toBe(1);
    const step = ok(applyInput(state, EXPIRE));
    expect(step.effects).toEqual([
      { kind: 'life_lost', seat: loser, lives: 0 },
      { kind: 'round_ended', round: 5, seat: loser, reason: 'expired' },
      {
        kind: 'game_over',
        result: { mode: 'duel', outcomes, isForfeit: false },
      },
    ]);
  });
});

describe('leaving early', () => {
  it('ends solo on quit with the lives kept', () => {
    const state = play(solo(), [EXPIRE]);
    const step = ok(applyInput(state, { kind: 'quit' }));
    expect(step.effects).toEqual([
      { kind: 'round_ended', round: 2, seat: 0, reason: 'ended' },
      {
        kind: 'game_over',
        result: { mode: 'solo', endReason: 'quit', livesRemaining: 2 },
      },
    ]);
  });

  it.each<[Seat, [string, string]]>([
    [0, ['loss', 'forfeit_win']],
    [1, ['forfeit_win', 'loss']],
  ])('gives a forfeit by seat %i to the other', (leaver, outcomes) => {
    const step = ok(applyInput(duel(0), { kind: 'forfeit', seat: leaver }));
    expect(step.effects).toEqual([
      { kind: 'round_ended', round: 1, seat: 0, reason: 'ended' },
      {
        kind: 'game_over',
        result: { mode: 'duel', outcomes, isForfeit: true },
      },
    ]);
  });
});

describe('rejections', () => {
  const over = () => ok(applyInput(solo(), { kind: 'quit' })).state;
  const duelOver = () =>
    ok(applyInput(duel(), { kind: 'forfeit', seat: 1 })).state;

  it.each<GameInput>([guess(0, 'Alfa'), EXPIRE, { kind: 'quit' }])(
    'refuses %j once a solo game is over',
    (input) => {
      expect(applyInput(over(), input)).toEqual({ rejected: 'session_over' });
    },
  );

  it('refuses a forfeit once a duel is over', () => {
    expect(applyInput(duelOver(), { kind: 'forfeit', seat: 0 })).toEqual({
      rejected: 'session_over',
    });
  });

  it('refuses a duel guess out of turn', () => {
    expect(applyInput(duel(0), guess(1, 'Alfa'))).toEqual({
      rejected: 'not_your_turn',
    });
  });

  it('refuses quit in a duel and forfeit in solo', () => {
    expect(applyInput(duel(), { kind: 'quit' })).toEqual({
      rejected: 'wrong_mode',
    });
    expect(applyInput(solo(), { kind: 'forfeit', seat: 0 })).toEqual({
      rejected: 'wrong_mode',
    });
  });

  it('refuses a seat the game does not have', () => {
    const seat2 = 2 as Seat;
    expect(applyInput(solo(), guess(1, 'Alfa'))).toEqual({
      rejected: 'unknown_seat',
    });
    expect(applyInput(duel(), guess(seat2, 'Alfa'))).toEqual({
      rejected: 'unknown_seat',
    });
    expect(applyInput(duel(), { kind: 'forfeit', seat: seat2 })).toEqual({
      rejected: 'unknown_seat',
    });
  });
});

describe('purity', () => {
  it.each<[string, () => GameState, GameInput]>([
    ['a solo correct guess', solo, guess(0, 'Alfa')],
    ['a solo miss', solo, guess(0, 'Nobody')],
    ['a solo expiry', solo, EXPIRE],
    ['a solo quit', solo, { kind: 'quit' }],
    ['a duel correct guess', duel, guess(0, 'Alfa')],
    ['a duel expiry', duel, EXPIRE],
    ['a duel forfeit', duel, { kind: 'forfeit', seat: 1 }],
  ])('leaves the input state untouched on %s', (_, make, input) => {
    const state = deepFreeze(make());
    const before = structuredClone(state);
    expect(() => applyInput(state, input)).not.toThrow();
    expect(state).toEqual(before);
  });
});
