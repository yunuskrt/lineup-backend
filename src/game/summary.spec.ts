import { ROUND_MS } from '@/contract/constants.js';
import type { SquadEntry } from '@/game/matcher.js';
import { runFigures } from '@/game/summary.js';
import {
  applyTimed,
  createTimedGame,
  type TimedEffect,
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
const guess = (text: string): TimedInput => ({ kind: 'guess', seat: 0, text });
const QUIT: TimedInput = { kind: 'quit' };
const TICK: TimedInput = { kind: 'tick' };

// Plays a solo run; each input lands at T0 + offset
function play(...inputs: [TimedInput, number][]) {
  const start = createTimedGame({ mode: 'solo', squad: SQUAD }, T0);
  let timed = start;
  const effects: TimedEffect[] = [];
  for (const [input, offset] of inputs) {
    const step = applyTimed(timed, input, T0 + offset);
    timed = step.timed;
    effects.push(...step.effects);
  }
  return runFigures(start.round!, effects);
}

describe('runFigures', () => {
  it('is all zeros for a run with no guesses', () => {
    expect(play()).toEqual({ accuracy: 0, bestStreak: 0, roundTimesMs: [] });
  });

  it('divides new correct names by every resolved guess', () => {
    const figures = play(
      [guess('alfa'), 1_000],
      [guess('zulu'), 2_000],
      [guess('alfa'), 3_000],
      [guess('bravo'), 4_000],
    );
    expect(figures.accuracy).toBe(0.5);
  });

  it('counts a perfect clear as eleven in a row', () => {
    const figures = play(
      ...NAMES.map((name, index): [TimedInput, number] => [
        guess(name),
        (index + 1) * 100,
      ]),
    );
    expect(figures).toMatchObject({ accuracy: 1, bestStreak: 11 });
  });

  it('breaks a streak on a name not in the XI', () => {
    const figures = play(
      [guess('alfa'), 100],
      [guess('bravo'), 200],
      [guess('zulu'), 300],
      [guess('charlie'), 400],
    );
    expect(figures.bestStreak).toBe(2);
  });

  it('breaks a streak on a name already found', () => {
    const figures = play(
      [guess('alfa'), 100],
      [guess('alfa'), 200],
      [guess('bravo'), 300],
      [guess('charlie'), 400],
    );
    expect(figures.bestStreak).toBe(2);
  });

  it('breaks a streak on a life lost to the clock', () => {
    const figures = play(
      [guess('alfa'), 100],
      [guess('bravo'), 200],
      // Round 3 started at +200 and expires at +15 600
      [TICK, 16_000],
      [guess('charlie'), 16_100],
    );
    expect(figures.bestStreak).toBe(2);
  });

  it('ignores a guess the clock refused', () => {
    const figures = play([guess('alfa'), 15_401]);
    expect(figures).toMatchObject({ accuracy: 0, bestStreak: 0 });
  });

  it('times a round that ends on a correct name', () => {
    expect(play([guess('alfa'), 4_000]).roundTimesMs).toEqual([4_000]);
  });

  it('clamps an expired round to the round length', () => {
    expect(play([TICK, 15_401]).roundTimesMs).toEqual([ROUND_MS]);
  });

  it('ends a quit round at the quit instant', () => {
    const figures = play([guess('alfa'), 4_000], [QUIT, 6_500]);
    expect(figures.roundTimesMs).toEqual([4_000, 2_500]);
  });

  it('leaves out a round still being played', () => {
    const figures = play([guess('alfa'), 4_000], [TICK, 5_000]);
    expect(figures.roundTimesMs).toEqual([4_000]);
  });

  it('times every round of a run lost to the clock', () => {
    expect(play([TICK, 50_000]).roundTimesMs).toEqual([
      ROUND_MS,
      ROUND_MS,
      ROUND_MS,
    ]);
  });
});
