import { MAX_LIVES, SQUAD_SIZE } from '@/contract/constants.js';
import type { DuelOutcome } from '@/contract/duel.js';
import type { SoloEndReason } from '@/contract/solo.js';
import { classifyGuess, type GuessVerdict } from '@/game/collisions.js';
import type { SquadEntry } from '@/game/matcher.js';

export type GameMode = 'solo' | 'duel';
export type Seat = 0 | 1;
export type RoundEndReason = 'found' | 'expired' | 'ended';

export type FoundPlayer = { playerId: string; foundBy: Seat };

export type GameResult =
  | { mode: 'solo'; endReason: SoloEndReason; livesRemaining: number }
  | {
      mode: 'duel';
      outcomes: readonly [DuelOutcome, DuelOutcome];
      isForfeit: boolean;
    };

// Holds the squad: server-only, never serialized
export type GameState = {
  readonly mode: GameMode;
  readonly squad: readonly SquadEntry[];
  readonly lives: readonly number[];
  readonly found: readonly FoundPlayer[];
  readonly turn: Seat;
  readonly round: number;
  readonly result: GameResult | null;
};

export type NewGame =
  | { mode: 'solo'; squad: readonly SquadEntry[] }
  | { mode: 'duel'; squad: readonly SquadEntry[]; firstSeat: Seat };

export type GameInput =
  | { kind: 'guess'; seat: Seat; text: string }
  | { kind: 'expire' }
  | { kind: 'quit' }
  | { kind: 'forfeit'; seat: Seat };

export type GameEffect =
  | { kind: 'guess_resolved'; seat: Seat; verdict: GuessVerdict }
  | { kind: 'player_revealed'; seat: Seat; playerId: string }
  | { kind: 'life_lost'; seat: Seat; lives: number }
  | { kind: 'round_ended'; round: number; seat: Seat; reason: RoundEndReason }
  | { kind: 'round_started'; round: number; seat: Seat }
  | { kind: 'game_over'; result: GameResult };

export type Rejection =
  'session_over' | 'not_your_turn' | 'wrong_mode' | 'unknown_seat';

export type Step =
  { state: GameState; effects: GameEffect[] } | { rejected: Rejection };

export function createGame(game: NewGame): GameState {
  if (game.squad.length !== SQUAD_SIZE) {
    throw new Error('A game needs exactly 11 starters');
  }
  const isDuel = game.mode === 'duel';
  return {
    mode: game.mode,
    squad: game.squad,
    lives: isDuel ? [MAX_LIVES, MAX_LIVES] : [MAX_LIVES],
    found: [],
    turn: isDuel ? game.firstSeat : 0,
    round: 1,
    result: null,
  };
}

function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

function isSeat(state: GameState, seat: number): boolean {
  return Number.isInteger(seat) && seat >= 0 && seat < state.lives.length;
}

function roundEnded(state: GameState, reason: RoundEndReason): GameEffect {
  return { kind: 'round_ended', round: state.round, seat: state.turn, reason };
}

// Solo keeps the seat; a duel hands it over
function nextRound(state: GameState, effects: GameEffect[]): Step {
  const turn = state.mode === 'duel' ? other(state.turn) : state.turn;
  const round = state.round + 1;
  return {
    state: { ...state, turn, round },
    effects: [...effects, { kind: 'round_started', round, seat: turn }],
  };
}

function finish(
  state: GameState,
  effects: GameEffect[],
  result: GameResult,
): Step {
  return {
    state: { ...state, result },
    effects: [...effects, { kind: 'game_over', result }],
  };
}

function duelLoss(
  loser: Seat,
  winner: DuelOutcome,
  isForfeit: boolean,
): GameResult {
  const outcomes: [DuelOutcome, DuelOutcome] =
    loser === 0 ? ['loss', winner] : [winner, 'loss'];
  return { mode: 'duel', outcomes, isForfeit };
}

function soloEnd(state: GameState, endReason: SoloEndReason): GameResult {
  return { mode: 'solo', endReason, livesRemaining: state.lives[0] };
}

function applyGuess(state: GameState, seat: Seat, text: string): Step {
  if (!isSeat(state, seat)) return { rejected: 'unknown_seat' };
  if (seat !== state.turn) return { rejected: 'not_your_turn' };

  const foundIds = state.found.map((entry) => entry.playerId);
  const verdict = classifyGuess(text, state.squad, foundIds);
  const resolved: GameEffect = { kind: 'guess_resolved', seat, verdict };
  if (verdict.kind !== 'correct_new') return { state, effects: [resolved] };

  const next = {
    ...state,
    found: [...state.found, { playerId: verdict.playerId, foundBy: seat }],
  };
  const effects: GameEffect[] = [
    resolved,
    { kind: 'player_revealed', seat, playerId: verdict.playerId },
    roundEnded(state, 'found'),
  ];
  if (next.found.length < SQUAD_SIZE) return nextRound(next, effects);

  // All 11 named: a draw, or a solo perfect clear
  const result: GameResult =
    state.mode === 'duel'
      ? { mode: 'duel', outcomes: ['draw', 'draw'], isForfeit: false }
      : soloEnd(next, 'perfect_clear');
  return finish(next, effects, result);
}

function applyExpiry(state: GameState): Step {
  const seat = state.turn;
  const left = state.lives[seat] - 1;
  const next = {
    ...state,
    lives: state.lives.map((lives, index) => (index === seat ? left : lives)),
  };
  const effects: GameEffect[] = [
    { kind: 'life_lost', seat, lives: left },
    roundEnded(state, 'expired'),
  ];
  if (left > 0) return nextRound(next, effects);

  const result =
    state.mode === 'duel'
      ? duelLoss(seat, 'win', false)
      : soloEnd(next, 'lives_out');
  return finish(next, effects, result);
}

function applyQuit(state: GameState): Step {
  if (state.mode !== 'solo') return { rejected: 'wrong_mode' };
  return finish(state, [roundEnded(state, 'ended')], soloEnd(state, 'quit'));
}

function applyForfeit(state: GameState, seat: Seat): Step {
  if (state.mode !== 'duel') return { rejected: 'wrong_mode' };
  if (!isSeat(state, seat)) return { rejected: 'unknown_seat' };
  const result = duelLoss(seat, 'forfeit_win', true);
  return finish(state, [roundEnded(state, 'ended')], result);
}

export function applyInput(state: GameState, input: GameInput): Step {
  if (state.result !== null) return { rejected: 'session_over' };
  switch (input.kind) {
    case 'guess':
      return applyGuess(state, input.seat, input.text);
    case 'expire':
      return applyExpiry(state);
    case 'quit':
      return applyQuit(state);
    case 'forfeit':
      return applyForfeit(state, input.seat);
  }
}
