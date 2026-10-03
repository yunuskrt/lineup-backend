import type { PositionGroup, Side } from '@/generated/prisma/client.js';
import type { Tx } from '@test/schema/schema-test-utils.js';

export const POSITIONS_442: PositionGroup[] = [
  'GK',
  ...Array<PositionGroup>(4).fill('DF'),
  ...Array<PositionGroup>(4).fill('MF'),
  ...Array<PositionGroup>(2).fill('FW'),
];

export type Built = Awaited<ReturnType<typeof buildMatch>>;

// A full fixture: season, two clubs, two XIs of 11
export async function buildMatch(tx: Tx, slug = 'test-mudbath-derby') {
  const competition = await tx.competition.create({
    data: { slug: `${slug}-comp`, kind: 'league', name: 'Crown League' },
  });
  const season = await tx.season.create({
    data: { competitionId: competition.id, label: '2002-03', startYear: 2002 },
  });
  const clubs = await tx.club.createManyAndReturn({
    data: (['home', 'away'] as const).map((side) => ({
      slug: `${slug}-${side}`,
      kind: 'club' as const,
      name: `${side} club`,
      shortName: side.slice(0, 3).toUpperCase(),
    })),
  });
  const players = await tx.player.createManyAndReturn({
    data: Array.from({ length: 22 }, (_, i) => ({
      slug: `${slug}-player-${i}`,
      name: `Player ${i}`,
    })),
  });
  const match = await tx.match.create({
    data: {
      slug,
      seasonId: season.id,
      date: new Date('2003-05-03'),
      stage: 'Matchday 34',
      nickname: 'The Mudbath Derby',
    },
  });

  const teams = [];
  for (const [index, side] of (['home', 'away'] as Side[]).entries()) {
    const team = await tx.matchTeam.create({
      data: {
        matchId: match.id,
        side,
        clubId: clubs[index].id,
        goals: side === 'home' ? 3 : 2,
        formation: '4-4-2',
      },
    });
    await tx.lineup.createMany({
      data: POSITIONS_442.map((position, slot) => ({
        matchTeamId: team.id,
        playerId: players[index * 11 + slot].id,
        slot,
        position,
      })),
    });
    teams.push(team);
  }

  return { season, clubs, players, match, home: teams[0], away: teams[1] };
}
