import { ROUND_MS } from '@/contract/constants.js';
import type { RoundTiming } from '@/contract/round.js';
import type { TimedEffect } from '@/game/timed-game.js';

export type RunFigures = {
  accuracy: number;
  bestStreak: number;
  roundTimesMs: number[];
};

// Practice rounds have no length to cap at
const capOf = (isPractice: boolean) => (isPractice ? Infinity : ROUND_MS);

export function runFigures(
  firstRound: RoundTiming,
  effects: readonly TimedEffect[],
  isPractice = false,
): RunFigures {
  const cap = capOf(isPractice);
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
        roundTimesMs.push(Math.min(cap, effect.endedAt - roundStart));
        break;
      case 'round_started':
        roundStart = effect.startedAt;
        break;
    }
  }

  const accuracy = guesses === 0 ? 0 : correct / guesses;
  return { accuracy, bestStreak, roundTimesMs };
}

export type NamedTiming = {
  playerId: string;
  order: number;
  elapsedMs: number;
};

// Each new name, in the order it was named
export function namedOrder(
  firstRound: RoundTiming,
  effects: readonly TimedEffect[],
  isPractice = false,
): NamedTiming[] {
  const cap = capOf(isPractice);
  let roundStart = firstRound.startedAt;
  const named: NamedTiming[] = [];

  for (const effect of effects) {
    if (effect.kind === 'round_started') roundStart = effect.startedAt;
    if (
      effect.kind === 'guess_resolved' &&
      effect.verdict.kind === 'correct_new'
    ) {
      named.push({
        playerId: effect.verdict.playerId,
        order: named.length + 1,
        // A grace-window guess reads as the full round
        elapsedMs: Math.min(cap, effect.receivedAt - roundStart),
      });
    }
  }
  return named;
}

// The found list with its timings, or a throw
export function timedFound<T extends { playerId: string }>(
  found: readonly T[],
  named: readonly NamedTiming[],
): (T & Omit<NamedTiming, 'playerId'>)[] {
  const byId = new Map(named.map((entry) => [entry.playerId, entry]));
  if (byId.size !== found.length) {
    throw new Error('Found players and named order disagree');
  }
  return found
    .map((entry) => {
      const timing = byId.get(entry.playerId);
      if (!timing) throw new Error('Found players and named order disagree');
      return { ...entry, order: timing.order, elapsedMs: timing.elapsedMs };
    })
    .sort((a, b) => a.order - b.order);
}
