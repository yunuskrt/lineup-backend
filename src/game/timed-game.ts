import type { RoundTiming } from '@/contract/round.js';
import { deadline, hasExpired, startRound } from '@/game/clock.js';
import {
  applyInput,
  createGame,
  type GameEffect,
  type GameInput,
  type GameState,
  type NewGame,
  type Rejection,
  type Seat,
} from '@/game/engine.js';

export type TimedGame = {
  readonly game: GameState;
  readonly round: RoundTiming | null;
};

// No expire: only the clock costs a life
export type TimedInput =
  | { kind: 'guess'; seat: Seat; text: string }
  | { kind: 'quit' }
  | { kind: 'forfeit'; seat: Seat }
  | { kind: 'tick' };

type GuessResolved = Extract<GameEffect, { kind: 'guess_resolved' }>;
type RoundStarted = Extract<GameEffect, { kind: 'round_started' }>;
type RoundEnded = Extract<GameEffect, { kind: 'round_ended' }>;

export type TimedEffect =
  | Exclude<GameEffect, GuessResolved | RoundStarted | RoundEnded>
  | (GuessResolved & { receivedAt: number })
  | (RoundStarted & RoundTiming)
  | (RoundEnded & { endedAt: number });

export type TimedRejection = Rejection | 'round_over';

export type TimedStep = {
  timed: TimedGame;
  effects: TimedEffect[];
  rejected: TimedRejection | null;
};

type Applied = { timed: TimedGame; effects: TimedEffect[] };

export function createTimedGame(newGame: NewGame, now: number): TimedGame {
  return { game: createGame(newGame), round: startRound(now) };
}

export function nextDeadline(timed: TimedGame): number | null {
  return timed.round === null ? null : deadline(timed.round);
}

function stamp(effect: GameEffect, at: number): TimedEffect {
  if (effect.kind === 'guess_resolved') return { ...effect, receivedAt: at };
  if (effect.kind === 'round_ended') return { ...effect, endedAt: at };
  if (effect.kind === 'round_started') return { ...effect, ...startRound(at) };
  return effect;
}

function applyAt(
  timed: TimedGame,
  input: GameInput,
  at: number,
): Applied | { rejected: Rejection } {
  const step = applyInput(timed.game, input);
  if ('rejected' in step) return step;

  const effects = step.effects.map((effect) => stamp(effect, at));
  if (step.state === timed.game) return { timed, effects };

  // A changed state means a new round or the end
  const round = step.state.result === null ? startRound(at) : null;
  return { timed: { game: step.state, round }, effects };
}

// Each expiry lands on its deadline: no pause
function catchUp(timed: TimedGame, now: number): Applied {
  let current = timed;
  const effects: TimedEffect[] = [];
  while (current.round !== null && hasExpired(current.round, now)) {
    const step = applyAt(current, { kind: 'expire' }, deadline(current.round));
    if ('rejected' in step) break;
    current = step.timed;
    effects.push(...step.effects);
  }
  return { timed: current, effects };
}

export function applyTimed(
  timed: TimedGame,
  input: TimedInput,
  receivedAt: number,
): TimedStep {
  // A wall clock stepping back must not end a round early
  const now = Math.max(receivedAt, timed.round?.startedAt ?? receivedAt);
  const caught = catchUp(timed, now);
  if (input.kind === 'tick') return { ...caught, rejected: null };

  // The player never saw the round that replaced it
  const isLate = caught.effects.length > 0 && caught.timed.round !== null;
  if (input.kind === 'guess' && isLate) {
    return { ...caught, rejected: 'round_over' };
  }

  const step = applyAt(caught.timed, input, now);
  if ('rejected' in step) return { ...caught, rejected: step.rejected };
  return {
    timed: step.timed,
    effects: [...caught.effects, ...step.effects],
    rejected: null,
  };
}
