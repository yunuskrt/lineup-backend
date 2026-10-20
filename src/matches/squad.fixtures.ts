import type { PositionGroup } from '@/contract/common.js';
import { matchInPlay } from '@/contract/contract.fixtures.js';
import { type MatchIdentity, matchIdentitySchema } from '@/contract/match.js';
import type { LoadedSquad } from '@/matches/squad-loader.service.js';

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
