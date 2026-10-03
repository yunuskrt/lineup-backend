import type { PositionGroup, Side } from '@/generated/prisma/client.js';
import {
  type Tx,
  useRolledBackDb,
  violation,
} from '@test/schema/schema-test-utils.js';

const POSITIONS_442: PositionGroup[] = [
  'GK',
  ...Array<PositionGroup>(4).fill('DF'),
  ...Array<PositionGroup>(4).fill('MF'),
  ...Array<PositionGroup>(2).fill('FW'),
];

type Built = Awaited<ReturnType<typeof buildMatch>>;

// A full fixture: season, two clubs, two XIs of 11
async function buildMatch(tx: Tx, slug = 'test-mudbath-derby') {
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

describe('Match & lineup schema (e2e)', () => {
  const { rolledBack, prisma } = useRolledBackDb();

  // Builds a fixture, then runs one change against it
  const withMatch = <T>(change: (tx: Tx, built: Built) => Promise<T>) =>
    rolledBack(async (tx) => change(tx, await buildMatch(tx)));

  it('round-trips a match with both XIs and its events', async () => {
    const m = await withMatch(async (tx, { match, players }) => {
      await tx.matchEvent.createMany({
        data: [
          {
            matchId: match.id,
            kind: 'goal',
            minute: 12,
            side: 'home',
            playerId: players[9].id,
          },
          {
            matchId: match.id,
            kind: 'own_goal',
            minute: 45,
            addedTime: 2,
            side: 'away',
          },
          {
            matchId: match.id,
            kind: 'penalty_goal',
            minute: 90,
            addedTime: 3,
            side: 'home',
            playerId: players[10].id,
          },
          {
            matchId: match.id,
            kind: 'red_card',
            minute: 77,
            side: 'away',
            playerId: players[13].id,
          },
        ],
      });
      return tx.match.findUniqueOrThrow({
        where: { id: match.id },
        include: {
          season: true,
          teams: {
            orderBy: { side: 'asc' },
            include: { club: true, lineups: { orderBy: { slot: 'asc' } } },
          },
          events: { orderBy: [{ minute: 'asc' }] },
        },
      });
    });

    expect(m.date.toISOString().slice(0, 10)).toBe('2003-05-03');
    expect(m.season.label).toBe('2002-03');
    expect(m.teams.map((t) => [t.side, t.goals, t.formation])).toEqual([
      ['home', 3, '4-4-2'],
      ['away', 2, '4-4-2'],
    ]);
    for (const team of m.teams) {
      expect(team.lineups).toHaveLength(11);
      expect(team.lineups.map((l) => l.position)).toEqual(POSITIONS_442);
    }
    expect(m.events.map((e) => [e.kind, e.minute, e.addedTime])).toEqual([
      ['goal', 12, null],
      ['own_goal', 45, 2],
      ['red_card', 77, null],
      ['penalty_goal', 90, 3],
    ]);
  });

  it('leaves no rows behind', async () => {
    const leftovers = await prisma().match.count({
      where: { slug: { startsWith: 'test-' } },
    });
    expect(leftovers).toBe(0);
  });

  describe('matches', () => {
    it.each([
      ['a blank stage', { stage: ' ' }],
      ['an empty nickname', { nickname: '' }],
    ])('rejects %s', async (_, data) => {
      await expect(
        withMatch((tx, { match }) =>
          tx.match.update({ where: { id: match.id }, data }),
        ),
      ).rejects.toThrow('matches_text_check');
    });

    it('accepts a decided shootout after extra time', async () => {
      const updated = await withMatch((tx, { match }) =>
        tx.match.update({
          where: { id: match.id },
          data: { extraTime: true, shootoutHome: 3, shootoutAway: 2 },
        }),
      );
      expect([updated.shootoutHome, updated.shootoutAway]).toEqual([3, 2]);
    });

    // Some competitions go straight to penalties at 90'
    it('accepts a shootout without extra time', async () => {
      const updated = await withMatch((tx, { match }) =>
        tx.match.update({
          where: { id: match.id },
          data: { shootoutHome: 5, shootoutAway: 4 },
        }),
      );
      expect(updated.extraTime).toBe(false);
    });

    it.each([
      ['a one-sided shootout', { shootoutHome: 3 }],
      ['a drawn shootout', { shootoutHome: 4, shootoutAway: 4 }],
      ['a negative shootout score', { shootoutHome: -1, shootoutAway: 2 }],
    ])('rejects %s', async (_, data) => {
      await expect(
        withMatch((tx, { match }) =>
          tx.match.update({ where: { id: match.id }, data }),
        ),
      ).rejects.toThrow('matches_shootout_check');
    });

    it('refuses to delete a season that has matches', async () => {
      await expect(
        withMatch((tx, { season }) =>
          tx.season.delete({ where: { id: season.id } }),
        ),
      ).rejects.toMatchObject(violation('P2003', 'matches_season_id_fkey'));
    });
  });

  describe('match_teams', () => {
    it.each(['4-4-2', '4-2-3-1', '4-1-2-1-2', '3-5-2', null])(
      'accepts the formation %j',
      async (formation) => {
        const team = await withMatch((tx, { home }) =>
          tx.matchTeam.update({ where: { id: home.id }, data: { formation } }),
        );
        expect(team.formation).toBe(formation);
      },
    );

    it.each([
      ['eleven outfield', '4-4-3'],
      ['nine outfield', '4-4-1'],
      ['an empty line', '4-0-6'],
      ['two lines', '6-4'],
      ['six lines', '2-2-2-1-2-1'],
      ['a letter', '4-a-2'],
      ['a double digit', '10-0-0'],
      ['an empty string', ''],
    ])('rejects a formation with %s', async (_, formation) => {
      await expect(
        withMatch((tx, { home }) =>
          tx.matchTeam.update({ where: { id: home.id }, data: { formation } }),
        ),
      ).rejects.toThrow('match_teams_formation_check');
    });

    it('rejects negative goals', async () => {
      await expect(
        withMatch((tx, { home }) =>
          tx.matchTeam.update({ where: { id: home.id }, data: { goals: -1 } }),
        ),
      ).rejects.toThrow('match_teams_goals_check');
    });

    it('allows one row per side', async () => {
      await expect(
        withMatch((tx, { match, clubs }) =>
          tx.matchTeam.update({
            where: { matchId_side: { matchId: match.id, side: 'away' } },
            data: { side: 'home', clubId: clubs[1].id },
          }),
        ),
      ).rejects.toMatchObject(
        violation('P2002', 'match_teams_match_id_side_key'),
      );
    });

    it('refuses the same club on both sides', async () => {
      await expect(
        withMatch((tx, { away, clubs }) =>
          tx.matchTeam.update({
            where: { id: away.id },
            data: { clubId: clubs[0].id },
          }),
        ),
      ).rejects.toMatchObject(
        violation('P2002', 'match_teams_match_id_club_id_key'),
      );
    });

    it('refuses to delete a club that played a match', async () => {
      await expect(
        withMatch((tx, { clubs }) =>
          tx.club.delete({ where: { id: clubs[0].id } }),
        ),
      ).rejects.toMatchObject(violation('P2003', 'match_teams_club_id_fkey'));
    });
  });

  describe('lineups', () => {
    const moveStarter = (slot: number, position: PositionGroup) =>
      withMatch((tx, { home }) =>
        tx.lineup.update({
          where: { matchTeamId_slot: { matchTeamId: home.id, slot: 5 } },
          data: { slot, position },
        }),
      );

    it.each([
      ['slot 11', 11],
      ['slot -1', -1],
    ])('rejects %s', async (_, slot) => {
      await expect(moveStarter(slot, 'MF')).rejects.toThrow(
        'lineups_slot_check',
      );
    });

    it('rejects a goalkeeper outside slot 0', async () => {
      await expect(
        withMatch((tx, { home }) =>
          tx.lineup.update({
            where: { matchTeamId_slot: { matchTeamId: home.id, slot: 5 } },
            data: { position: 'GK' },
          }),
        ),
      ).rejects.toThrow('lineups_goalkeeper_check');
    });

    it('rejects an outfield player in slot 0', async () => {
      await expect(
        withMatch((tx, { home }) =>
          tx.lineup.update({
            where: { matchTeamId_slot: { matchTeamId: home.id, slot: 0 } },
            data: { position: 'DF' },
          }),
        ),
      ).rejects.toThrow('lineups_goalkeeper_check');
    });

    it('rejects a twelfth starter in a taken slot', async () => {
      await expect(
        withMatch(async (tx, { home }) => {
          const sub = await tx.player.create({
            data: { slug: 'test-twelfth', name: 'Twelfth Man' },
          });
          return tx.lineup.create({
            data: {
              matchTeamId: home.id,
              playerId: sub.id,
              slot: 10,
              position: 'FW',
            },
          });
        }),
      ).rejects.toMatchObject(
        violation('P2002', 'lineups_match_team_id_slot_key'),
      );
    });

    it('rejects a player starting twice in one XI', async () => {
      // players[9] already starts at slot 9
      await expect(
        withMatch((tx, { home, players }) =>
          tx.lineup.update({
            where: { matchTeamId_slot: { matchTeamId: home.id, slot: 10 } },
            data: { playerId: players[9].id },
          }),
        ),
      ).rejects.toMatchObject(
        violation('P2002', 'lineups_match_team_id_player_id_key'),
      );
    });

    it('refuses to delete a player who started a match', async () => {
      await expect(
        withMatch((tx, { players }) =>
          tx.player.delete({ where: { id: players[0].id } }),
        ),
      ).rejects.toMatchObject(violation('P2003', 'lineups_player_id_fkey'));
    });
  });

  describe('match_events', () => {
    const addEvent = (minute: number, addedTime: number | null) =>
      withMatch((tx, { match }) =>
        tx.matchEvent.create({
          data: {
            matchId: match.id,
            kind: 'goal',
            minute,
            addedTime,
            side: 'home',
          },
        }),
      );

    it.each([
      [1, null],
      [90, 3],
      [120, 2],
      [105, 1],
    ])('accepts minute %i with added time %j', async (minute, addedTime) => {
      const event = await addEvent(minute, addedTime);
      expect([event.minute, event.addedTime]).toEqual([minute, addedTime]);
    });

    it.each([0, 121])('rejects minute %i', async (minute) => {
      await expect(addEvent(minute, null)).rejects.toThrow(
        'match_events_minute_check',
      );
    });

    it.each([
      ['mid-half', 60, 2],
      ['zero added time', 90, 0],
      ['over 30 minutes added', 90, 31],
    ])('rejects added time %s', async (_, minute, addedTime) => {
      await expect(addEvent(minute, addedTime)).rejects.toThrow(
        'match_events_added_time_check',
      );
    });

    it('refuses to delete a player with a recorded event', async () => {
      await expect(
        withMatch(async (tx, { match }) => {
          const scorer = await tx.player.create({
            data: { slug: 'test-sub-scorer', name: 'Super Sub' },
          });
          await tx.matchEvent.create({
            data: {
              matchId: match.id,
              kind: 'goal',
              minute: 88,
              side: 'away',
              playerId: scorer.id,
            },
          });
          return tx.player.delete({ where: { id: scorer.id } });
        }),
      ).rejects.toMatchObject(
        violation('P2003', 'match_events_player_id_fkey'),
      );
    });
  });

  describe('formation_outfield_total()', () => {
    it.each([
      ['4-2-3-1', 10],
      ['4-4-3', 11],
      ['3-5-2', 10],
      ['4-a-2', null],
      ['10-0', null],
      ['', null],
    ])('sums %j to %j', async (formation, total) => {
      const [row] = await prisma().$queryRaw<{ total: number | null }[]>`
        SELECT formation_outfield_total(${formation}) AS total`;
      expect(row.total).toBe(total);
    });

    it('returns null for a null formation', async () => {
      const [row] = await prisma().$queryRaw<{ total: number | null }[]>`
        SELECT formation_outfield_total(NULL) AS total`;
      expect(row.total).toBeNull();
    });
  });

  it('deletes a match’s sides, lineups and events with it', async () => {
    const remaining = await withMatch(async (tx, { match, home, away }) => {
      await tx.matchEvent.create({
        data: { matchId: match.id, kind: 'goal', minute: 5, side: 'home' },
      });
      await tx.match.delete({ where: { id: match.id } });
      return {
        teams: await tx.matchTeam.count({ where: { matchId: match.id } }),
        lineups: await tx.lineup.count({
          where: { matchTeamId: { in: [home.id, away.id] } },
        }),
        events: await tx.matchEvent.count({ where: { matchId: match.id } }),
      };
    });
    expect(remaining).toEqual({ teams: 0, lineups: 0, events: 0 });
  });
});
