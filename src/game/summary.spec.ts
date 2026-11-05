import { ROUND_MS } from '@/contract/constants.js';
import type { SquadEntry } from '@/game/matcher.js';
import { namedOrder, runFigures, timedFound } from '@/game/summary.js';
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
const guess = (text: string, seat: 0 | 1 = 0): TimedInput => ({
  kind: 'guess',
  seat,
  text,
});
const QUIT: TimedInput = { kind: 'quit' };
const TICK: TimedInput = { kind: 'tick' };

type NewGame = Parameters<typeof createTimedGame>[0];
const SOLO: NewGame = { mode: 'solo', squad: SQUAD };

// Each input lands at T0 + offset
function streamOf(newGame: NewGame, ...inputs: [TimedInput, number][]) {
  const start = createTimedGame(newGame, T0);
  let timed = start;
  const effects: TimedEffect[] = [];
  for (const [input, offset] of inputs) {
    const step = applyTimed(timed, input, T0 + offset);
    timed = step.timed;
    effects.push(...step.effects);
  }
  return { firstRound: start.round!, effects };
}

function play(...inputs: [TimedInput, number][]) {
  const { firstRound, effects } = streamOf(SOLO, ...inputs);
  return runFigures(firstRound, effects);
}

function named(newGame: NewGame, ...inputs: [TimedInput, number][]) {
  const { firstRound, effects } = streamOf(newGame, ...inputs);
  return namedOrder(firstRound, effects);
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

describe('namedOrder', () => {
  it('is empty for a run quit before any name', () => {
    expect(named(SOLO, [guess('zulu'), 500], [QUIT, 1_000])).toEqual([]);
  });

  it('times a name from the start of its own round', () => {
    expect(
      named(SOLO, [guess('alfa'), 1_000], [guess('bravo'), 3_500]),
    ).toEqual([
      { playerId: 'p-alfa', order: 1, elapsedMs: 1_000 },
      { playerId: 'p-bravo', order: 2, elapsedMs: 2_500 },
    ]);
  });

  it('skips repeats and misses, keeping the clock running', () => {
    expect(
      named(
        SOLO,
        [guess('alfa'), 1_000],
        [guess('alfa'), 2_000],
        [guess('zulu'), 3_000],
        [guess('bravo'), 4_000],
      ),
    ).toEqual([
      { playerId: 'p-alfa', order: 1, elapsedMs: 1_000 },
      { playerId: 'p-bravo', order: 2, elapsedMs: 3_000 },
    ]);
  });

  it('times a name after a lost life from the next round', () => {
    // Round 2 starts at +1 000, expires at +16 400
    const entries = named(
      SOLO,
      [guess('alfa'), 1_000],
      [TICK, 17_000],
      [guess('bravo'), 17_000],
    );
    expect(entries).toEqual([
      { playerId: 'p-alfa', order: 1, elapsedMs: 1_000 },
      { playerId: 'p-bravo', order: 2, elapsedMs: 600 },
    ]);
  });

  it('caps a guess in the grace window at the round length', () => {
    expect(named(SOLO, [guess('alfa'), 15_300])).toEqual([
      { playerId: 'p-alfa', order: 1, elapsedMs: ROUND_MS },
    ]);
  });

  it('orders a perfect clear 1 to 11', () => {
    const entries = named(
      SOLO,
      ...NAMES.map((name, index): [TimedInput, number] => [
        guess(name),
        (index + 1) * 100,
      ]),
    );
    expect(entries.map((entry) => entry.order)).toEqual(
      NAMES.map((_, index) => index + 1),
    );
    expect(entries.every((entry) => entry.elapsedMs === 100)).toBe(true);
  });

  it("times alternating duel names from each seat's own turn", () => {
    const entries = named(
      { mode: 'duel', squad: SQUAD, firstSeat: 0 },
      [guess('alfa', 0), 1_000],
      [guess('bravo', 1), 3_500],
      [guess('charlie', 0), 4_000],
    );
    expect(entries).toEqual([
      { playerId: 'p-alfa', order: 1, elapsedMs: 1_000 },
      { playerId: 'p-bravo', order: 2, elapsedMs: 2_500 },
      { playerId: 'p-charlie', order: 3, elapsedMs: 500 },
    ]);
  });
});

describe('timedFound', () => {
  const TIMINGS = [
    { playerId: 'p-alfa', order: 1, elapsedMs: 1_000 },
    { playerId: 'p-bravo', order: 2, elapsedMs: 2_500 },
  ];

  it('adds each timing and sorts by order', () => {
    const found = [
      { playerId: 'p-bravo', foundBy: 1 },
      { playerId: 'p-alfa', foundBy: 0 },
    ];
    expect(timedFound(found, TIMINGS)).toEqual([
      { playerId: 'p-alfa', foundBy: 0, order: 1, elapsedMs: 1_000 },
      { playerId: 'p-bravo', foundBy: 1, order: 2, elapsedMs: 2_500 },
    ]);
  });

  it('is empty when nothing was named', () => {
    expect(timedFound([], [])).toEqual([]);
  });

  it.each([
    [
      'a found player with no timing',
      [{ playerId: 'p-charlie' }],
      TIMINGS.slice(0, 1),
    ],
    ['a timing with no found player', [{ playerId: 'p-alfa' }], TIMINGS],
  ])('throws on %s', (_, found, timings) => {
    expect(() => timedFound(found, timings)).toThrow(/disagree/);
  });
});
