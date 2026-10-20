import type { DuelEventMap } from '@/contract/duel.js';
import type { Seat } from '@/game/engine.js';
import type { TimedEffect } from '@/game/timed-game.js';
import type { PlayingRoom } from '@/duel/duel-room.js';
import {
  type Moment,
  momentOf,
  toDuelResult,
  toDuelSession,
  toFoundPlayer,
  toLifeLost,
} from '@/duel/duel-views.js';
import { toGuessResult } from '@/matches/squad-views.js';

export type Outbound = {
  [E in keyof DuelEventMap]: {
    seat: Seat;
    event: E;
    payload: DuelEventMap[E];
  };
}[keyof DuelEventMap];

const SEATS: readonly Seat[] = [0, 1];

// Replays the step over the room before it
export function eventsFor(
  before: PlayingRoom,
  effects: readonly TimedEffect[],
): Outbound[] {
  let moment: Moment = momentOf(before);
  const out: Outbound[] = [];
  const toBoth = (build: (seat: Seat) => Outbound) => {
    for (const seat of SEATS) out.push(build(seat));
  };

  for (const effect of effects) {
    switch (effect.kind) {
      case 'guess_resolved':
        // The guesser only; the text never leaves
        out.push({
          seat: effect.seat,
          event: 'guessResolved',
          payload: toGuessResult(effect.verdict, before.squad),
        });
        break;
      case 'player_revealed': {
        const found = { playerId: effect.playerId, foundBy: effect.seat };
        moment = { ...moment, found: [...moment.found, found] };
        toBoth((seat) => ({
          seat,
          event: 'playerRevealed',
          payload: toFoundPlayer(before, found, seat),
        }));
        break;
      }
      case 'life_lost':
        moment = {
          ...moment,
          lives: moment.lives.map((lives, seat) =>
            seat === effect.seat ? effect.lives : lives,
          ),
        };
        toBoth((seat) => ({
          seat,
          event: 'lifeLost',
          payload: toLifeLost(effect, seat),
        }));
        break;
      case 'round_ended':
        moment = { ...moment, round: null };
        break;
      case 'round_started': {
        const { startedAt, endsAt } = effect;
        moment = { ...moment, turn: effect.seat, round: { startedAt, endsAt } };
        const at = moment;
        toBoth((seat) => ({
          seat,
          event: 'turnChanged',
          payload: toDuelSession(before, seat, at),
        }));
        toBoth((seat) => ({
          seat,
          event: 'roundStarted',
          payload: toDuelSession(before, seat, at),
        }));
        break;
      }
      case 'game_over': {
        const at = moment;
        toBoth((seat) => ({
          seat,
          event: 'finished',
          payload: toDuelResult(before, effect.result, seat, at),
        }));
        break;
      }
    }
  }
  return out;
}
