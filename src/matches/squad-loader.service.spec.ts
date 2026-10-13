import type { PositionGroup } from '@/contract/common.js';
import { SquadLoaderService } from '@/matches/squad-loader.service.js';
import type { PrismaService } from '@/prisma/prisma.service.js';

// 4-4-2: GK, 4 DF, 4 MF, 2 FW
const POSITIONS: PositionGroup[] = [
  'GK',
  'DF',
  'DF',
  'DF',
  'DF',
  'MF',
  'MF',
  'MF',
  'MF',
  'FW',
  'FW',
];

const lineup = (slot: number) => ({
  slot,
  position: POSITIONS[slot],
  player: {
    id: `p-${slot}`,
    name: `Secret Name ${slot}`,
    aliases: [
      { normalized: `secret name ${slot}` },
      { normalized: `n${slot}` },
    ],
  },
});

const XI = POSITIONS.map((_, slot) => lineup(slot));
const team = (overrides: object = {}) => ({
  formation: '4-4-2',
  lineups: XI,
  ...overrides,
});

function loaderWith(row: unknown) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const prisma = { matchTeam: { findUnique } };
  const loader = new SquadLoaderService(prisma as unknown as PrismaService);
  return { findUnique, loader };
}

async function failureOf(row: unknown): Promise<string> {
  const error: unknown = await loaderWith(row)
    .loader.load('m-1', 'home')
    .catch((thrown: unknown) => thrown);
  if (!(error instanceof Error)) throw new Error('Expected a failure');
  return error.message;
}

describe('SquadLoaderService', () => {
  it('reads one side of one match by id', async () => {
    const { findUnique, loader } = loaderWith(team());
    await loader.load('m-1', 'away');
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matchId_side: { matchId: 'm-1', side: 'away' } },
      }),
    );
  });

  it('builds the engine entries and the reveal views', async () => {
    const squad = await loaderWith(team()).loader.load('m-1', 'home');

    expect(squad.formation).toBe('4-4-2');
    expect(squad.entries).toHaveLength(11);
    expect(squad.entries[3]).toEqual({
      playerId: 'p-3',
      aliases: ['secret name 3', 'n3'],
    });
    expect(squad.players[0]).toEqual({
      id: 'p-0',
      name: 'Secret Name 0',
      slot: 0,
      position: 'GK',
      imageUrl: null,
    });
  });

  it.each([
    ['no team row', null, 'has no formation'],
    ['no formation', team({ formation: null }), 'has no formation'],
    ['10 starters', team({ lineups: XI.slice(0, 10) }), 'has 10 starters'],
    [
      'a slot out of its line',
      team({
        lineups: [...XI.slice(0, 10), { ...lineup(10), position: 'DF' }],
      }),
      'slot 10 breaks 4-4-2',
    ],
    [
      'a starter with no alias',
      team({
        lineups: [
          ...XI.slice(0, 10),
          { ...lineup(10), player: { ...lineup(10).player, aliases: [] } },
        ],
      }),
      'slot 10 has no alias',
    ],
  ])('refuses %s, naming the match only', async (_, row, why) => {
    const message = await failureOf(row);
    expect(message).toBe(`Match m-1 home XI ${why}`);
    expect(message).not.toMatch(/secret|p-\d/i);
  });
});
