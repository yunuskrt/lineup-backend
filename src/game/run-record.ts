import type { RoundTiming } from '@/contract/round.js';
import type { GuessVerdict } from '@/game/collisions.js';
import type { RoundEndReason, Seat } from '@/game/engine.js';
import type { TimedEffect } from '@/game/timed-game.js';

// Values match the guess_outcome enum
export type GuessRecord = {
  seat: Seat;
  text: string;
  outcome: GuessVerdict['kind'];
  playerId: string | null;
  receivedAt: number;
};

export type RoundRecord = {
  number: number;
  seat: Seat;
  startedAt: number;
  endsAt: number;
  endedAt: number;
  endReason: RoundEndReason;
  guesses: GuessRecord[];
};

type OpenRound = RoundTiming & { guesses: GuessRecord[] };

// Only ended rounds: a running one has no row yet
export function runRecord(
  firstRound: RoundTiming,
  effects: readonly TimedEffect[],
): RoundRecord[] {
  const rounds: RoundRecord[] = [];
  let open: OpenRound = { ...firstRound, guesses: [] };

  for (const effect of effects) {
    switch (effect.kind) {
      case 'guess_resolved': {
        const { verdict } = effect;
        open.guesses.push({
          seat: effect.seat,
          text: effect.text,
          outcome: verdict.kind,
          playerId: verdict.kind === 'not_in_xi' ? null : verdict.playerId,
          receivedAt: effect.receivedAt,
        });
        break;
      }
      case 'round_ended':
        rounds.push({
          number: effect.round,
          seat: effect.seat,
          startedAt: open.startedAt,
          endsAt: open.endsAt,
          endedAt: effect.endedAt,
          endReason: effect.reason,
          guesses: open.guesses,
        });
        break;
      case 'round_started':
        open = {
          startedAt: effect.startedAt,
          endsAt: effect.endsAt,
          guesses: [],
        };
        break;
    }
  }
  return rounds;
}
