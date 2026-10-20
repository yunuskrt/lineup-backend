import type {
  CoinFlipResult,
  DuelSession,
  FilterSubmission,
} from '@/contract/duel.js';
import type { DuelActor } from '@/contract/player.js';
import type { Seat } from '@/game/engine.js';
import {
  type DuelRoom,
  otherSeat,
  type PlayingRoom,
} from '@/duel/duel-room.js';
import { toMatchInPlay } from '@/matches/match-refs.js';
import { revealOf } from '@/matches/squad-views.js';

// Every view is from the receiver's seat
const actorOf = (seat: Seat, receiver: Seat): DuelActor =>
  seat === receiver ? 'you' : 'opponent';

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

export function toDuelSession(room: PlayingRoom, receiver: Seat): DuelSession {
  const { game, round } = room.timed;
  if (!round) throw new Error('The duel has no live round');
  const player = (seat: Seat) => ({
    ...room.players[seat],
    lives: game.lives[seat],
  });
  return {
    sessionId: room.id,
    match: toMatchInPlay(room.match, room.side, room.squad.formation),
    you: player(receiver),
    opponent: player(otherSeat(receiver)),
    turn: actorOf(game.turn, receiver),
    round,
    found: game.found.map(({ playerId, foundBy }) => ({
      ...revealOf(room.squad, playerId),
      foundBy: actorOf(foundBy, receiver),
    })),
  };
}
