import type { PositionGroup } from '@/contract/common.js';
import { matchInPlay } from '@/contract/contract.fixtures.js';
import { type MatchIdentity, matchIdentitySchema } from '@/contract/match.js';
import {
  applyTimed,
  createTimedGame,
  type TimedInput,
} from '@/game/timed-game.js';
import type { LoadedSquad } from '@/matches/squad-loader.service.js';
import type { OfferedRun, PlayedRun } from '@/solo/solo-run.js';

export const T0 = 1_000_000;

export const NAMES = [
  'alfa',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf',
  'hotel',
  'india',
  'juliett',
  'kilo',
];

// 4-4-2: GK, 4 DF, 4 MF, 2 FW
const POSITIONS: PositionGroup[] = [
  'GK',
  ...Array<PositionGroup>(4).fill('DF'),
  ...Array<PositionGroup>(4).fill('MF'),
  'FW',
  'FW',
];

export const SQUAD: LoadedSquad = {
  formation: '4-4-2',
  entries: NAMES.map((name) => ({ playerId: `p-${name}`, aliases: [name] })),
  players: NAMES.map((name, slot) => ({
    id: `p-${name}`,
    name: `Secret ${name}`,
    slot,
    position: POSITIONS[slot],
    imageUrl: null,
  })),
};

// Parsing strips the side and formation
export const IDENTITY: MatchIdentity = matchIdentitySchema.parse(matchInPlay);

export const guess = (text: string): TimedInput => ({
  kind: 'guess',
  seat: 0,
  text,
});

export function offeredRun(
  overrides: Partial<Pick<OfferedRun, 'id' | 'userId' | 'touchedAt'>> = {},
): OfferedRun {
  return {
    id: 'run-1',
    userId: 'user-1',
    match: IDENTITY,
    touchedAt: T0,
    side: null,
    squad: null,
    timed: null,
    firstRound: null,
    effects: [],
    ...overrides,
  };
}

// Each input lands at T0 + its offset
export function playedRun(...inputs: [TimedInput, number][]): PlayedRun {
  const start = createTimedGame({ mode: 'solo', squad: SQUAD.entries }, T0);
  let run: PlayedRun = {
    ...offeredRun(),
    side: 'home',
    squad: SQUAD,
    timed: start,
    firstRound: start.round!,
    effects: [],
  };
  for (const [input, offset] of inputs) {
    const step = applyTimed(run.timed, input, T0 + offset);
    run = {
      ...run,
      timed: step.timed,
      effects: [...run.effects, ...step.effects],
      touchedAt: T0 + offset,
    };
  }
  return run;
}
