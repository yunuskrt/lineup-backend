import { duelPlayer } from '@/contract/contract.fixtures.js';
import { NO_PREFERENCE } from '@/game/coin-flip.js';
import type { Seat } from '@/game/engine.js';
import { createTimedGame } from '@/game/timed-game.js';
import type { PlayingRoom } from '@/duel/duel-room.js';
import { IDENTITY, SQUAD } from '@/matches/squad.fixtures.js';

export const T0 = 1_000_000;

// Users a and b; round 1 starts at T0
export function playingRoom(firstSeat: Seat = 0): PlayingRoom {
  const timed = createTimedGame(
    { mode: 'duel', squad: SQUAD.entries, firstSeat },
    T0,
  );
  return {
    id: 'room-1',
    players: [duelPlayer('a'), duelPlayer('b')],
    pairedAt: T0,
    phase: 'playing',
    flip: { winner: firstSeat === 0 ? 1 : 0, filters: NO_PREFERENCE },
    match: IDENTITY,
    side: 'home',
    squad: SQUAD,
    timed,
    firstRound: timed.round!,
  };
}
