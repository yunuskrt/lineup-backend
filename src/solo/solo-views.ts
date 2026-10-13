import type { Tier } from '@/contract/common.js';
import type { RevealedPlayer } from '@/contract/player.js';
import type { GuessResult } from '@/contract/round.js';
import type { SoloSession, SoloSummary } from '@/contract/solo.js';
import type { GuessVerdict } from '@/game/collisions.js';
import { runFigures } from '@/game/summary.js';
import { toMatchInPlay } from '@/matches/match-refs.js';
import type { LoadedSquad } from '@/matches/squad-loader.service.js';
import type { PlayedRun } from '@/solo/solo-run.js';

// The only way a squad player reaches a payload
function revealOf(squad: LoadedSquad, playerId: string): RevealedPlayer {
  const player = squad.players.find((entry) => entry.id === playerId);
  if (!player) throw new Error('A found player is missing from the squad');
  return player;
}

function foundOf(run: PlayedRun): RevealedPlayer[] {
  return run.timed.game.found.map(({ playerId }) =>
    revealOf(run.squad, playerId),
  );
}

export function toSoloSession(run: PlayedRun): SoloSession {
  const { game, round } = run.timed;
  return {
    sessionId: run.id,
    status: game.result === null ? 'active' : 'over',
    match: toMatchInPlay(run.match, run.side, run.squad.formation),
    lives: game.lives[0],
    found: foundOf(run),
    round,
  };
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

export function toSoloSummary(run: PlayedRun, tier: Tier): SoloSummary {
  const result = run.timed.game.result;
  if (result?.mode !== 'solo') throw new Error('The run is not over');

  const found = foundOf(run);
  const foundIds = new Set(found.map((player) => player.id));
  const missed = run.squad.players.filter((player) => !foundIds.has(player.id));

  return {
    match: run.match,
    found,
    missedCount: missed.length,
    // The tier comes from the session, never the client
    missed: tier === 'pro' ? missed : null,
    livesRemaining: result.livesRemaining,
    endReason: result.endReason,
    ...runFigures(run.firstRound, run.effects),
  };
}
