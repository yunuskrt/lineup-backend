import { guessResultSchema } from '@/contract/round.js';
import { soloSessionSchema, soloSummarySchema } from '@/contract/solo.js';
import type { TimedInput } from '@/game/timed-game.js';
import {
  guess,
  IDENTITY,
  NAMES,
  playedRun,
  SQUAD,
} from '@/solo/solo.fixtures.js';
import {
  toGuessResult,
  toSoloSession,
  toSoloSummary,
} from '@/solo/solo-views.js';

const QUIT: TimedInput = { kind: 'quit' };

// Every name and alias still hidden by the run
function hiddenOf(revealed: readonly string[]): string[] {
  return NAMES.filter((name) => !revealed.includes(name)).flatMap((name) => [
    `Secret ${name}`,
    `p-${name}`,
  ]);
}

function expectNoneOf(payload: unknown, hidden: readonly string[]) {
  const json = JSON.stringify(payload);
  for (const secret of hidden) expect(json).not.toContain(secret);
}

describe('toSoloSession', () => {
  it('shows a fresh run with no player of the XI', () => {
    const session = toSoloSession(playedRun());

    expect(soloSessionSchema.parse(session)).toEqual(session);
    expect(session).toMatchObject({
      sessionId: 'run-1',
      status: 'active',
      lives: 3,
      found: [],
      round: { startedAt: 1_000_000, endsAt: 1_015_000 },
    });
    expect(session.match).toEqual({
      ...IDENTITY,
      side: 'home',
      formation: '4-4-2',
    });
    expectNoneOf(session, hiddenOf([]));
  });

  it('reveals only the players found, in the order named', () => {
    const run = playedRun([guess('india'), 100], [guess('bravo'), 200]);
    const session = toSoloSession(run);

    expect(session.found.map((player) => player.id)).toEqual([
      'p-india',
      'p-bravo',
    ]);
    expect(session.found[0]).toEqual(SQUAD.players[8]);
    expectNoneOf(session, hiddenOf(['india', 'bravo']));
  });

  it('shows an ended run as over with no round', () => {
    const session = toSoloSession(playedRun([QUIT, 100]));
    expect(session).toMatchObject({ status: 'over', round: null });
  });

  it('shows the lives the clock has taken', () => {
    const session = toSoloSession(playedRun([{ kind: 'tick' }, 15_401]));
    expect(session.lives).toBe(2);
  });
});

describe('toGuessResult', () => {
  it('carries the revealed player for a new correct name', () => {
    const result = toGuessResult(
      { kind: 'correct_new', playerId: 'p-delta' },
      SQUAD,
    );
    expect(guessResultSchema.parse(result)).toEqual(result);
    expect(result).toEqual({
      outcome: 'correct_new',
      player: SQUAD.players[3],
    });
  });

  it('carries only the id for a name already found', () => {
    const result = toGuessResult(
      { kind: 'already_found', playerId: 'p-delta' },
      SQUAD,
    );
    expect(result).toEqual({ outcome: 'already_found', playerId: 'p-delta' });
  });

  it('carries nothing for a name not in the XI', () => {
    const result = toGuessResult({ kind: 'not_in_xi' }, SQUAD);
    expect(result).toEqual({ outcome: 'not_in_xi' });
  });

  it('refuses an id outside the squad without naming it', () => {
    expect(() =>
      toGuessResult({ kind: 'correct_new', playerId: 'p-zulu' }, SQUAD),
    ).toThrow('A found player is missing from the squad');
  });
});

describe('toSoloSummary', () => {
  const quitAfterTwo = () =>
    playedRun([guess('alfa'), 3_000], [guess('kilo'), 5_000], [QUIT, 6_000]);

  it('gives a free player the count but not the list', () => {
    const summary = toSoloSummary(quitAfterTwo(), 'free');

    expect(soloSummarySchema.parse(summary)).toEqual(summary);
    expect(summary).toEqual({
      match: IDENTITY,
      found: [SQUAD.players[0], SQUAD.players[10]],
      missedCount: 9,
      missed: null,
      livesRemaining: 3,
      endReason: 'quit',
      accuracy: 1,
      bestStreak: 2,
      roundTimesMs: [3_000, 2_000, 1_000],
    });
    expectNoneOf(summary, hiddenOf(['alfa', 'kilo']));
  });

  it('gives a pro player the missed list in slot order', () => {
    const summary = toSoloSummary(quitAfterTwo(), 'pro');

    expect(soloSummarySchema.parse(summary)).toEqual(summary);
    expect(summary.missed).toEqual(SQUAD.players.slice(1, 10));
  });

  it('reports a perfect clear', () => {
    const run = playedRun(
      ...NAMES.map((name, index): [TimedInput, number] => [
        guess(name),
        (index + 1) * 100,
      ]),
    );
    const summary = toSoloSummary(run, 'free');

    expect(summary).toMatchObject({
      endReason: 'perfect_clear',
      missedCount: 0,
      livesRemaining: 3,
      bestStreak: 11,
    });
  });

  it('reports a run lost to the clock', () => {
    const summary = toSoloSummary(
      playedRun([{ kind: 'tick' }, 50_000]),
      'free',
    );
    expect(summary).toMatchObject({
      endReason: 'lives_out',
      livesRemaining: 0,
      missedCount: 11,
    });
  });

  it('refuses a run still in play', () => {
    expect(() => toSoloSummary(playedRun(), 'pro')).toThrow(
      'The run is not over',
    );
  });
});
