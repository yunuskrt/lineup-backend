import type { Side } from '@/contract/common.js';
import type { DuelPlayer } from '@/contract/duel.js';
import type { Filters, MatchIdentity } from '@/contract/match.js';
import type { RoundTiming } from '@/contract/round.js';
import type { CoinFlip } from '@/game/coin-flip.js';
import type { Seat } from '@/game/engine.js';
import type { TimedEffect, TimedGame } from '@/game/timed-game.js';
import type { LoadedSquad } from '@/matches/squad-loader.service.js';

// Seat 0 queued first; the id is the sessionId
type RoomBase = {
  readonly id: string;
  readonly players: readonly [DuelPlayer, DuelPlayer];
  readonly pairedAt: number;
};

export type FiltersRoom = RoomBase & {
  readonly phase: 'filters';
  readonly submissions: readonly [Filters | null, Filters | null];
};

export type FlippingRoom = RoomBase & {
  readonly phase: 'flipping';
  readonly flip: CoinFlip;
};

// Holds the squad: never leaves the server
export type PlayingRoom = RoomBase & {
  readonly phase: 'playing';
  readonly flip: CoinFlip;
  readonly match: MatchIdentity;
  readonly side: Side;
  readonly squad: LoadedSquad;
  readonly timed: TimedGame;
  readonly firstRound: RoundTiming;
  // Holds guess texts: never logged or sent
  readonly effects: readonly TimedEffect[];
  // Each seat's reconnect deadline, while away
  readonly away: readonly [number | null, number | null];
};

export type DuelRoom = FiltersRoom | FlippingRoom | PlayingRoom;

export function seatOf(room: DuelRoom, userId: string): Seat {
  return room.players[0].id === userId ? 0 : 1;
}

export function otherSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

export function withSeat<T>(
  pair: readonly [T, T],
  seat: Seat,
  value: T,
): readonly [T, T] {
  return seat === 0 ? [value, pair[1]] : [pair[0], value];
}
