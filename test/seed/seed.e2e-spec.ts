import type { SeedDataInput } from '@scripts/seed/seed-data.schema.js';
import { seed, SEED_INPUT, SEED_TABLES } from '@scripts/seed/seed.js';
import { type Tx, useRolledBackDb } from '@test/schema/schema-test-utils.js';

const MATCH = 'match-continental-2005-final';
const PLAYER = 'pl-gareth-pennock';

function edited(change: (input: SeedDataInput) => void): SeedDataInput {
  const copy = structuredClone(SEED_INPUT);
  change(copy);
  return copy;
}

// Ids and update stamps of every seeded table
async function snapshot(tx: Tx) {
  const stamp = (rows: { id: string; updatedAt: Date }[]) =>
    rows.map((r) => `${r.id}@${r.updatedAt.getTime()}`).sort();
  const seeded = { slug: { in: SEED_INPUT.players.map((p) => p.id) } };
  return {
    competitions: stamp(await tx.competition.findMany()),
    seasons: stamp(await tx.season.findMany()),
    clubs: stamp(await tx.club.findMany()),
    players: stamp(await tx.player.findMany({ where: seeded })),
    aliases: stamp(
      await tx.playerAlias.findMany({ where: { player: seeded } }),
    ),
    matches: stamp(await tx.match.findMany()),
    teams: stamp(await tx.matchTeam.findMany()),
    lineups: stamp(await tx.lineup.findMany()),
  };
}

describe('Seed (e2e)', () => {
  const { rolledBack } = useRolledBackDb();

  it('changes nothing on a second run', async () => {
    const { before, after, report } = await rolledBack(async (tx) => {
      await seed(tx);
      const before = await snapshot(tx);
      const report = await seed(tx);
      return { before, after: await snapshot(tx), report };
    });

    expect(after).toEqual(before);
    for (const table of SEED_TABLES) {
      expect(report[table].changes).toBe(0);
    }
    expect(report.players.rows).toBe(167);
    expect(report.lineups.rows).toBe(220);
  });

  it('round-trips a match with both XIs', async () => {
    const match = await rolledBack(async (tx) => {
      await seed(tx);
      return tx.match.findUniqueOrThrow({
        where: { slug: MATCH },
        include: {
          season: { include: { competition: true } },
          teams: {
            orderBy: { side: 'asc' },
            include: {
              club: true,
              lineups: { orderBy: { slot: 'asc' }, include: { player: true } },
            },
          },
        },
      });
    });

    expect(match.date.toISOString().slice(0, 10)).toBe('2005-05-25');
    expect([match.stage, match.nickname]).toEqual([
      'Final',
      'The Night of the Six',
    ]);
    expect(match.season.label).toBe('2004-05');
    expect(match.season.competition.slug).toBe('comp-continental-cup');
    expect(
      match.teams.map((t) => [t.side, t.club.slug, t.goals, t.formation]),
    ).toEqual([
      ['home', 'club-real-solvara', 3, '4-2-3-1'],
      ['away', 'club-northgate', 3, '4-4-2'],
    ]);
    for (const team of match.teams) {
      expect(team.lineups.map((l) => l.slot)).toEqual([...Array(11).keys()]);
    }
    expect(match.teams[1].lineups[0].player.slug).toBe(PLAYER);
  });

  it('seeds national teams and leaves images empty', async () => {
    const clubs = await rolledBack(async (tx) => {
      await seed(tx);
      return tx.club.findMany({
        where: { slug: { in: SEED_INPUT.clubs.map((c) => c.id) } },
      });
    });

    expect(clubs.filter((c) => c.kind === 'national_team')).toHaveLength(4);
    expect(clubs.every((c) => c.crestKey === null)).toBe(true);
  });

  it('converges on an edited fixture', async () => {
    const input = edited((i) => {
      const player = i.players.find((p) => p.id === PLAYER)!;
      player.name = 'Gareth Pennock-Hale';
      player.aliases = player.aliases.filter((a) => a !== 'pennock');
      const lineup = i.matches[0].home.lineup;
      // Swaps two starters between their slots
      [lineup[1].playerId, lineup[4].playerId] = [
        lineup[4].playerId,
        lineup[1].playerId,
      ];
    });

    const { report, player, ids } = await rolledBack(async (tx) => {
      await seed(tx);
      const before = await tx.player.findUniqueOrThrow({
        where: { slug: PLAYER },
      });
      const report = await seed(tx, input);
      const player = await tx.player.findUniqueOrThrow({
        where: { slug: PLAYER },
        include: { aliases: { orderBy: { normalized: 'asc' } } },
      });
      return { report, player, ids: [before.id, player.id] };
    });

    expect(report.players.changes).toBe(1);
    expect(report.playerAliases.changes).toBe(1);
    expect(report.lineups.changes).toBe(11);
    expect(report.matches.changes).toBe(0);
    expect(player.name).toBe('Gareth Pennock-Hale');
    expect(player.aliases.map((a) => a.normalized)).toEqual(['gareth pennock']);
    expect(ids[1]).toBe(ids[0]);
  });

  it('updates a match and its side in place', async () => {
    const input = edited((i) => {
      const match = i.matches.find((m) => m.id === MATCH)!;
      match.date = '2005-05-26';
      match.nickname = null;
      match.score.home = 4;
      match.home.formation = '4-3-3';
    });

    const { report, match, ids } = await rolledBack(async (tx) => {
      await seed(tx);
      const teamIds = async () =>
        (await tx.matchTeam.findMany({ where: { match: { slug: MATCH } } }))
          .map((t) => t.id)
          .sort();
      const before = await teamIds();
      const report = await seed(tx, input);
      const match = await tx.match.findUniqueOrThrow({
        where: { slug: MATCH },
        include: { teams: { where: { side: 'home' } } },
      });
      return { report, match, ids: [before, await teamIds()] };
    });

    expect(report.matches.changes).toBe(1);
    expect(report.matchTeams.changes).toBe(1);
    expect(report.seasons.changes).toBe(0);
    expect(report.lineups.changes).toBe(0);
    expect(match.date.toISOString().slice(0, 10)).toBe('2005-05-26');
    expect(match.nickname).toBeNull();
    expect([match.teams[0].goals, match.teams[0].formation]).toEqual([
      4,
      '4-3-3',
    ]);
    expect(ids[1]).toEqual(ids[0]);
  });

  it('writes nothing when the data is invalid', async () => {
    const input = edited((i) => {
      i.matches[0].home.lineup[0].playerId = 'pl-nobody';
    });

    const { error, matches } = await rolledBack(async (tx) => {
      const before = await tx.match.count();
      const error = await seed(tx, input).catch((e: unknown) => e);
      return { error, matches: (await tx.match.count()) - before };
    });

    expect(error).toBeInstanceOf(Error);
    expect(matches).toBe(0);
  });
});
