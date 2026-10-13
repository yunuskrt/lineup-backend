import { normalizeName } from '@/game/normalize.js';
import { SquadLoaderService } from '@/matches/squad-loader.service.js';
import type { PrismaService } from '@/prisma/prisma.service.js';
import { type Tx, useRolledBackDb } from '@test/schema/schema-test-utils.js';

const loader = (tx: Tx) =>
  new SquadLoaderService(tx as unknown as PrismaService);

// Any seeded match with both XIs complete
async function seededMatchId(tx: Tx): Promise<string> {
  const match = await tx.match.findFirst({
    where: { teams: { every: { formation: { not: null } } } },
    orderBy: { slug: 'asc' },
    select: { id: true },
  });
  if (!match) throw new Error('E2E expects the seeded dev branch');
  return match.id;
}

describe('SquadLoaderService (e2e)', () => {
  const { rolledBack } = useRolledBackDb();

  it.each(['home', 'away'] as const)('loads the seeded %s XI', async (side) => {
    const { squad, starterIds } = await rolledBack(async (tx) => {
      const matchId = await seededMatchId(tx);
      const lineups = await tx.lineup.findMany({
        where: { matchTeam: { matchId, side } },
        select: { playerId: true },
      });
      return {
        squad: await loader(tx).load(matchId, side),
        starterIds: lineups.map((row) => row.playerId),
      };
    });

    expect(squad.entries).toHaveLength(11);
    expect(squad.players.map((player) => player.slot)).toEqual(
      Array.from({ length: 11 }, (_, slot) => slot),
    );
    expect(squad.entries.map((entry) => entry.playerId).sort()).toEqual(
      starterIds.sort(),
    );
    for (const entry of squad.entries) {
      expect(entry.aliases.length).toBeGreaterThan(0);
      for (const alias of entry.aliases) {
        expect(alias).toBe(normalizeName(alias));
      }
    }
  });

  // The slot rule must agree with every seeded XI
  it('loads every complete seeded XI', async () => {
    const formations = await rolledBack(async (tx) => {
      const teams = await tx.matchTeam.findMany({
        where: { formation: { not: null } },
        select: { matchId: true, side: true },
      });
      return Promise.all(
        teams.map(async ({ matchId, side }) => {
          const squad = await loader(tx).load(matchId, side);
          return squad.formation;
        }),
      );
    });
    expect(formations.length).toBeGreaterThanOrEqual(20);
  });
});
