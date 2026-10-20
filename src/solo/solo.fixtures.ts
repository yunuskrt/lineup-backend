import {
  applyTimed,
  createTimedGame,
  type TimedInput,
} from '@/game/timed-game.js';
import { IDENTITY, SQUAD } from '@/matches/squad.fixtures.js';
import type { OfferedRun, PlayedRun } from '@/solo/solo-run.js';

// Moved for the duel; re-exported for solo specs
export { IDENTITY, NAMES, SQUAD } from '@/matches/squad.fixtures.js';

export const T0 = 1_000_000;

export const guess = (text: string): TimedInput => ({
  kind: 'guess',
  seat: 0,
  text,
});

export function offeredRun(
  overrides: Partial<Pick<OfferedRun, 'id' | 'userId' | 'touchedAt'>> = {},
): OfferedRun {
  return {
    id: 'run-1',
    userId: 'user-1',
    match: IDENTITY,
    touchedAt: T0,
    side: null,
    squad: null,
    timed: null,
    firstRound: null,
    effects: [],
    ...overrides,
  };
}

// Each input lands at T0 + its offset
export function playedRun(...inputs: [TimedInput, number][]): PlayedRun {
  const start = createTimedGame({ mode: 'solo', squad: SQUAD.entries }, T0);
  let run: PlayedRun = {
    ...offeredRun(),
    side: 'home',
    squad: SQUAD,
    timed: start,
    firstRound: start.round!,
    effects: [],
    savedAt: null,
  };
  for (const [input, offset] of inputs) {
    const step = applyTimed(run.timed, input, T0 + offset);
    run = {
      ...run,
      timed: step.timed,
      effects: [...run.effects, ...step.effects],
      touchedAt: T0 + offset,
    };
  }
  return run;
}
