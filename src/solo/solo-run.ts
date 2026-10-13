import type { Side } from '@/contract/common.js';
import type { MatchIdentity } from '@/contract/match.js';
import type { RoundTiming } from '@/contract/round.js';
import type { TimedEffect, TimedGame } from '@/game/timed-game.js';
import type { LoadedSquad } from '@/matches/squad-loader.service.js';

type RunBase = {
  readonly id: string;
  readonly userId: string;
  readonly match: MatchIdentity;
  readonly touchedAt: number;
};

// Offered: no side, so no squad and no clock
export type OfferedRun = RunBase & {
  readonly side: null;
  readonly squad: null;
  readonly timed: null;
  readonly firstRound: null;
  readonly effects: readonly [];
};

// Holds the squad: never leaves the server
export type PlayedRun = RunBase & {
  readonly side: Side;
  readonly squad: LoadedSquad;
  readonly timed: TimedGame;
  readonly firstRound: RoundTiming;
  readonly effects: readonly TimedEffect[];
};

export type SoloRun = OfferedRun | PlayedRun;

export const RUN_IDLE_MS = 30 * 60_000;

export function isOver(run: SoloRun): boolean {
  return run.timed !== null && run.timed.game.result !== null;
}
