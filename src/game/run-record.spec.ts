import { GRACE_MS, ROUND_MS } from '@/contract/constants.js';
import type { Seat } from '@/game/engine.js';
import type { SquadEntry } from '@/game/matcher.js';
import { runRecord } from '@/game/run-record.js';
import {
  applyTimed,
  createTimedGame,
  type TimedEffect,
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
const guess = (text: string, seat: Seat = 0): TimedInput => ({
  kind: 'guess',
  seat,
  text,
});
const QUIT: TimedInput = { kind: 'quit' };
const TICK: TimedInput = { kind: 'tick' };

// Each input lands at T0 + its offset
function play(start: TimedGame, ...inputs: [TimedInput, number][]) {
  let timed = start;
  const effects: TimedEffect[] = [];
  for (const [input, offset] of inputs) {
    const step = applyTimed(timed, input, T0 + offset);
    timed = step.timed;
    effects.push(...step.effects);
  }
  return runRecord(start.round!, effects);
}

const solo = () => createTimedGame({ mode: 'solo', squad: SQUAD }, T0);

describe('runRecord', () => {
  it('has no rows before a round ends', () => {
    expect(play(solo(), [guess('zulu'), 1_000])).toEqual([]);
  });

  it('files every judged guess under its round', () => {
    const rounds = play(
      solo(),
      [guess('zulu'), 1_000],
      [guess('alfa'), 2_000],
      [guess('alfa'), 3_000],
      [guess('bravo'), 4_000],
      [QUIT, 5_000],
    );

    expect(rounds).toEqual([
      {
        number: 1,
        seat: 0,
        startedAt: T0,
        endsAt: T0 + ROUND_MS,
        endedAt: T0 + 2_000,
        endReason: 'found',
        guesses: [
          {
            seat: 0,
            text: 'zulu',
            outcome: 'not_in_xi',
            playerId: null,
            receivedAt: T0 + 1_000,
          },
          {
            seat: 0,
            text: 'alfa',
            outcome: 'correct_new',
            playerId: 'p-alfa',
            receivedAt: T0 + 2_000,
          },
        ],
      },
      {
        number: 2,
        seat: 0,
        startedAt: T0 + 2_000,
        endsAt: T0 + 2_000 + ROUND_MS,
        endedAt: T0 + 4_000,
        endReason: 'found',
        guesses: [
          expect.objectContaining({
            outcome: 'already_found',
            playerId: 'p-alfa',
          }),
          expect.objectContaining({
            outcome: 'correct_new',
            playerId: 'p-bravo',
          }),
        ],
      },
      {
        number: 3,
        seat: 0,
        startedAt: T0 + 4_000,
        endsAt: T0 + 4_000 + ROUND_MS,
        endedAt: T0 + 5_000,
        endReason: 'ended',
        guesses: [],
      },
    ]);
  });

  it('ends expired rounds at their deadlines, back to back', () => {
    const deadline = ROUND_MS + GRACE_MS;
    const rounds = play(solo(), [TICK, 3 * deadline + 1]);

    expect(rounds.map((round) => round.endReason)).toEqual([
      'expired',
      'expired',
      'expired',
    ]);
    expect(rounds.map((round) => round.endedAt - T0)).toEqual([
      deadline,
      2 * deadline,
      3 * deadline,
    ]);
    for (const [index, round] of rounds.entries()) {
      expect(round.number).toBe(index + 1);
      expect(round.startedAt - T0).toBe(index * deadline);
    }
  });

  it('keeps no row for a guess the clock refused', () => {
    const rounds = play(solo(), [guess('alfa'), 15_401], [QUIT, 15_500]);
    expect(rounds.flatMap((round) => round.guesses)).toEqual([]);
  });

  it('records a perfect clear as eleven found rounds', () => {
    const rounds = play(
      solo(),
      ...NAMES.map((name, index): [TimedInput, number] => [
        guess(name),
        (index + 1) * 100,
      ]),
    );
    expect(rounds).toHaveLength(11);
    expect(rounds.every((round) => round.endReason === 'found')).toBe(true);
    expect(rounds.at(-1)?.guesses[0].playerId).toBe('p-kilo');
  });

  it('follows the seat of each duel round', () => {
    const duel = createTimedGame(
      { mode: 'duel', squad: SQUAD, firstSeat: 1 },
      T0,
    );
    const rounds = play(
      duel,
      [guess('alfa', 1), 1_000],
      [guess('zulu', 0), 2_000],
      [guess('bravo', 0), 3_000],
    );

    expect(rounds.map((round) => round.seat)).toEqual([1, 0]);
    expect(rounds[1].guesses.map((entry) => entry.seat)).toEqual([0, 0]);
  });
});
