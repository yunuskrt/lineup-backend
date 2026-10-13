import { ROUND_MS } from '@/contract/constants.js';
import type { RoundTiming } from '@/contract/round.js';
import type { TimedEffect } from '@/game/timed-game.js';

export type RunFigures = {
  accuracy: number;
  bestStreak: number;
  roundTimesMs: number[];
};

export function runFigures(
  firstRound: RoundTiming,
  effects: readonly TimedEffect[],
): RunFigures {
  let guesses = 0;
  let correct = 0;
  let streak = 0;
  let bestStreak = 0;
  let roundStart = firstRound.startedAt;
  const roundTimesMs: number[] = [];

  for (const effect of effects) {
    switch (effect.kind) {
      case 'guess_resolved': {
        guesses += 1;
        const isCorrect = effect.verdict.kind === 'correct_new';
        correct += isCorrect ? 1 : 0;
        streak = isCorrect ? streak + 1 : 0;
        bestStreak = Math.max(bestStreak, streak);
        break;
      }
      case 'life_lost':
        streak = 0;
        break;
      // An expired round runs into the grace window
      case 'round_ended':
        roundTimesMs.push(Math.min(ROUND_MS, effect.endedAt - roundStart));
        break;
      case 'round_started':
        roundStart = effect.startedAt;
        break;
    }
  }

  const accuracy = guesses === 0 ? 0 : correct / guesses;
  return { accuracy, bestStreak, roundTimesMs };
}
