import type { Tier } from '@/contract/common.js';
import type { NamedPlayer, RevealedPlayer } from '@/contract/player.js';
import type { SoloSession, SoloSummary } from '@/contract/solo.js';
import { namedOrder, runFigures, timedFound } from '@/game/summary.js';
import { toMatchInPlay } from '@/matches/match-refs.js';
import { revealOf } from '@/matches/squad-views.js';
import type { PlayedRun } from '@/solo/solo-run.js';

function foundOf(run: PlayedRun): RevealedPlayer[] {
  return run.timed.game.found.map(({ playerId }) =>
    revealOf(run.squad, playerId),
  );
}

// The run's names, in order, with their times
function namedOf(run: PlayedRun): NamedPlayer[] {
  const named = namedOrder(run.firstRound, run.effects);
  return timedFound(run.timed.game.found, named).map(
    ({ playerId, order, elapsedMs }) => ({
      ...revealOf(run.squad, playerId),
      order,
      elapsedMs,
    }),
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

export function toSoloSummary(run: PlayedRun, tier: Tier): SoloSummary {
  const result = run.timed.game.result;
  if (result?.mode !== 'solo') throw new Error('The run is not over');

  const found = namedOf(run);
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
