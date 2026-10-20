import type { RevealedPlayer } from '@/contract/player.js';
import type { GuessResult } from '@/contract/round.js';
import type { GuessVerdict } from '@/game/collisions.js';
import type { LoadedSquad } from '@/matches/squad-loader.service.js';

// The only way a squad player reaches a payload
export function revealOf(squad: LoadedSquad, playerId: string): RevealedPlayer {
  const player = squad.players.find((entry) => entry.id === playerId);
  if (!player) throw new Error('A found player is missing from the squad');
  return player;
}

export function toGuessResult(
  verdict: GuessVerdict,
  squad: LoadedSquad,
): GuessResult {
  switch (verdict.kind) {
    case 'correct_new':
      return {
        outcome: 'correct_new',
        player: revealOf(squad, verdict.playerId),
      };
    case 'already_found':
      return { outcome: 'already_found', playerId: verdict.playerId };
    case 'not_in_xi':
      return { outcome: 'not_in_xi' };
  }
}
