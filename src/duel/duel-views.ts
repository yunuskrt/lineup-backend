import type {
  CoinFlipResult,
  DuelLifeLost,
  DuelPlayer,
  DuelResult,
  DuelSession,
  FilterSubmission,
} from '@/contract/duel.js';
import type { DuelActor, DuelFoundPlayer } from '@/contract/player.js';
import type { RoundTiming } from '@/contract/round.js';
import type { FoundPlayer, GameResult, Seat } from '@/game/engine.js';
import {
  type DuelRoom,
  otherSeat,
  type PlayingRoom,
} from '@/duel/duel-room.js';
import { toMatchInPlay } from '@/matches/match-refs.js';
import { revealOf } from '@/matches/squad-views.js';

// The duel at one instant, mid-step included
export type Moment = {
  readonly lives: readonly number[];
  readonly found: readonly FoundPlayer[];
  readonly turn: Seat;
  readonly round: RoundTiming | null;
};

// Every view is from the receiver's seat
const actorOf = (seat: Seat, receiver: Seat): DuelActor =>
  seat === receiver ? 'you' : 'opponent';

export function momentOf(room: PlayingRoom): Moment {
  const { game, round } = room.timed;
  return { lives: game.lives, found: game.found, turn: game.turn, round };
}

export function toFilterSubmission(
  submissions: readonly [unknown, unknown],
  receiver: Seat,
): FilterSubmission {
  const status = (seat: Seat) =>
    submissions[seat] === null ? 'pending' : 'submitted';
  return { yours: status(receiver), theirs: status(otherSeat(receiver)) };
}

export function toCoinFlip(
  room: Extract<DuelRoom, { flip: unknown }>,
  receiver: Seat,
): CoinFlipResult {
  return {
    winner: actorOf(room.flip.winner, receiver),
    filters: room.flip.filters,
  };
}

export function toFoundPlayer(
  room: PlayingRoom,
  found: FoundPlayer,
  receiver: Seat,
): DuelFoundPlayer {
  return {
    ...revealOf(room.squad, found.playerId),
    foundBy: actorOf(found.foundBy, receiver),
  };
}

export function toLifeLost(
  effect: { seat: Seat; lives: number },
  receiver: Seat,
): DuelLifeLost {
  return { who: actorOf(effect.seat, receiver), lives: effect.lives };
}

function playersAt(room: PlayingRoom, moment: Moment, receiver: Seat) {
  const player = (seat: Seat): DuelPlayer => ({
    ...room.players[seat],
    lives: moment.lives[seat],
  });
  return { you: player(receiver), opponent: player(otherSeat(receiver)) };
}

function foundAt(room: PlayingRoom, moment: Moment, receiver: Seat) {
  return moment.found.map((found) => toFoundPlayer(room, found, receiver));
}

export function toDuelSession(
  room: PlayingRoom,
  receiver: Seat,
  moment: Moment = momentOf(room),
): DuelSession {
  if (!moment.round) throw new Error('The duel has no live round');
  return {
    sessionId: room.id,
    match: toMatchInPlay(room.match, room.side, room.squad.formation),
    ...playersAt(room, moment, receiver),
    turn: actorOf(moment.turn, receiver),
    round: moment.round,
    found: foundAt(room, moment, receiver),
  };
}

export function toDuelResult(
  room: PlayingRoom,
  result: GameResult,
  receiver: Seat,
  moment: Moment = momentOf(room),
): DuelResult {
  if (result.mode !== 'duel') throw new Error('Not a duel result');
  return {
    outcome: result.outcomes[receiver],
    match: room.match,
    found: foundAt(room, moment, receiver),
    ...playersAt(room, moment, receiver),
    isForfeit: result.isForfeit,
  };
}
