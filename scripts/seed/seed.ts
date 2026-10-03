import type { Prisma } from '@/generated/prisma/client.js';
import { CLUBS } from '@scripts/seed/data/clubs.js';
import { COMPETITIONS } from '@scripts/seed/data/competitions.js';
import { MATCHES } from '@scripts/seed/data/matches.js';
import { PLAYERS } from '@scripts/seed/data/players.js';
import {
  type SeedData,
  type SeedDataInput,
  seedDataSchema,
} from '@scripts/seed/seed-data.schema.js';

type Tx = Prisma.TransactionClient;

export const SEED_INPUT: SeedDataInput = {
  competitions: COMPETITIONS,
  clubs: CLUBS,
  players: PLAYERS,
  matches: MATCHES,
};

export const SEED_TABLES = [
  'competitions',
  'seasons',
  'clubs',
  'players',
  'playerAliases',
  'matches',
  'matchTeams',
  'lineups',
] as const;

export type TableReport = { rows: number; changes: number };
export type SeedReport = Record<(typeof SEED_TABLES)[number], TableReport>;

type Row = Record<string, unknown>;
type Stored = Row & { id: string };
type Synced = { ids: Map<string, string>; report: TableReport };

type Writer<W, S> = {
  create: (rows: W[]) => Promise<S[]>;
  update: (id: string, row: W) => Promise<unknown>;
  remove?: (ids: string[]) => Promise<unknown>;
};

const same = (a: unknown, b: unknown) =>
  a instanceof Date && b instanceof Date
    ? a.getTime() === b.getTime()
    : a === b;

const differs = (wanted: Row, stored: Row) =>
  Object.keys(wanted).some((key) => !same(wanted[key], stored[key]));

function idFor(ids: Map<string, string>, key: string): string {
  const id = ids.get(key);
  if (!id) throw new Error(`Seed lost track of ${key}`);
  return id;
}

// Writes only what differs, so a rerun is a no-op
async function sync<W extends Row, S extends Stored>(
  wanted: readonly W[],
  stored: readonly S[],
  keyOf: (row: W | S) => string,
  writer: Writer<W, S>,
): Promise<Synced> {
  const byKey = new Map(stored.map((row) => [keyOf(row), row]));
  const wantedKeys = new Set(wanted.map(keyOf));
  const ids = new Map(stored.map((row) => [keyOf(row), row.id]));
  let changes = 0;

  for (const row of wanted) {
    const current = byKey.get(keyOf(row));
    if (current && differs(row, current)) {
      await writer.update(current.id, row);
      changes += 1;
    }
  }

  const missing = wanted.filter((row) => !byKey.has(keyOf(row)));
  if (missing.length > 0) {
    for (const row of await writer.create(missing)) {
      ids.set(keyOf(row), row.id);
    }
    changes += missing.length;
  }

  const extra = stored.filter((row) => !wantedKeys.has(keyOf(row)));
  if (writer.remove && extra.length > 0) {
    await writer.remove(extra.map((row) => row.id));
    changes += extra.length;
  }

  return { ids, report: { rows: wanted.length, changes } };
}

const bySlug = (row: { slug: string }) => row.slug;

async function syncCompetitions(tx: Tx, data: SeedData): Promise<Synced> {
  const wanted = data.competitions.map((c) => ({
    slug: c.id,
    kind: c.kind,
    name: c.name,
  }));
  const stored = await tx.competition.findMany({
    where: { slug: { in: wanted.map(bySlug) } },
  });
  return sync(wanted, stored, bySlug, {
    create: (rows) => tx.competition.createManyAndReturn({ data: rows }),
    update: (id, row) => tx.competition.update({ where: { id }, data: row }),
  });
}

async function syncSeasons(
  tx: Tx,
  data: SeedData,
  competitionIds: Map<string, string>,
): Promise<Synced> {
  const byKey = new Map(
    data.matches.map((m) => {
      const competitionId = idFor(competitionIds, m.competitionId);
      const row = {
        competitionId,
        label: m.season,
        startYear: Number(m.season.slice(0, 4)),
      };
      return [`${competitionId}|${m.season}`, row];
    }),
  );
  const stored = await tx.season.findMany({
    where: { competitionId: { in: [...competitionIds.values()] } },
  });
  return sync([...byKey.values()], stored, seasonKey, {
    create: (rows) => tx.season.createManyAndReturn({ data: rows }),
    update: (id, row) => tx.season.update({ where: { id }, data: row }),
  });
}

const seasonKey = (row: { competitionId: string; label: string }) =>
  `${row.competitionId}|${row.label}`;

async function syncClubs(tx: Tx, data: SeedData): Promise<Synced> {
  const wanted = data.clubs.map((club) => ({
    slug: club.id,
    kind: club.id.startsWith('nat-')
      ? ('national_team' as const)
      : ('club' as const),
    name: club.name,
    shortName: club.shortName,
  }));
  const stored = await tx.club.findMany({
    where: { slug: { in: wanted.map(bySlug) } },
  });
  return sync(wanted, stored, bySlug, {
    create: (rows) => tx.club.createManyAndReturn({ data: rows }),
    update: (id, row) => tx.club.update({ where: { id }, data: row }),
  });
}

async function syncPlayers(tx: Tx, data: SeedData): Promise<Synced> {
  const wanted = data.players.map((p) => ({ slug: p.id, name: p.name }));
  const stored = await tx.player.findMany({
    where: { slug: { in: wanted.map(bySlug) } },
  });
  return sync(wanted, stored, bySlug, {
    create: (rows) => tx.player.createManyAndReturn({ data: rows }),
    update: (id, row) => tx.player.update({ where: { id }, data: row }),
  });
}

// Mock aliases are already normalized (B27 checks)
async function syncAliases(
  tx: Tx,
  data: SeedData,
  playerIds: Map<string, string>,
): Promise<Synced> {
  const wanted = data.players.flatMap((p) =>
    p.aliases.map((alias) => ({
      playerId: idFor(playerIds, p.id),
      alias,
      normalized: alias,
    })),
  );
  const stored = await tx.playerAlias.findMany({
    where: { playerId: { in: [...playerIds.values()] } },
  });
  const key = (row: { playerId: string; normalized: string }) =>
    `${row.playerId}|${row.normalized}`;
  return sync(wanted, stored, key, {
    create: (rows) => tx.playerAlias.createManyAndReturn({ data: rows }),
    update: (id, row) => tx.playerAlias.update({ where: { id }, data: row }),
    remove: (ids) => tx.playerAlias.deleteMany({ where: { id: { in: ids } } }),
  });
}

async function syncMatches(
  tx: Tx,
  data: SeedData,
  competitionIds: Map<string, string>,
  seasonIds: Map<string, string>,
): Promise<Synced> {
  const wanted = data.matches.map((m) => ({
    slug: m.id,
    seasonId: idFor(
      seasonIds,
      `${idFor(competitionIds, m.competitionId)}|${m.season}`,
    ),
    date: new Date(`${m.date}T00:00:00Z`),
    stage: m.stage,
    nickname: m.nickname,
  }));
  const stored = await tx.match.findMany({
    where: { slug: { in: wanted.map(bySlug) } },
  });
  return sync(wanted, stored, bySlug, {
    create: (rows) => tx.match.createManyAndReturn({ data: rows }),
    update: (id, row) => tx.match.update({ where: { id }, data: row }),
  });
}

const SIDES = ['home', 'away'] as const;

const teamKey = (row: { matchId: string; side: string }) =>
  `${row.matchId}|${row.side}`;

async function syncMatchTeams(
  tx: Tx,
  data: SeedData,
  matchIds: Map<string, string>,
  clubIds: Map<string, string>,
): Promise<Synced> {
  const wanted = data.matches.flatMap((m) =>
    SIDES.map((side) => ({
      matchId: idFor(matchIds, m.id),
      side,
      clubId: idFor(clubIds, side === 'home' ? m.homeClubId : m.awayClubId),
      goals: m.score[side],
      formation: m[side].formation,
    })),
  );
  const stored = await tx.matchTeam.findMany({
    where: { matchId: { in: [...matchIds.values()] } },
  });
  return sync(wanted, stored, teamKey, {
    create: (rows) => tx.matchTeam.createManyAndReturn({ data: rows }),
    update: (id, row) => tx.matchTeam.update({ where: { id }, data: row }),
  });
}

// Replaces a whole XI: a slot swap breaks uniqueness
async function syncLineups(
  tx: Tx,
  data: SeedData,
  matchIds: Map<string, string>,
  teamIds: Map<string, string>,
  playerIds: Map<string, string>,
): Promise<TableReport> {
  const wanted = data.matches.flatMap((m) =>
    SIDES.flatMap((side) => {
      const matchTeamId = idFor(teamIds, `${idFor(matchIds, m.id)}|${side}`);
      return m[side].lineup.map((entry) => ({
        matchTeamId,
        playerId: idFor(playerIds, entry.playerId),
        slot: entry.slot,
        position: entry.position,
      }));
    }),
  );
  const stored = await tx.lineup.findMany({
    where: { matchTeamId: { in: [...teamIds.values()] } },
  });

  const key = (row: { matchTeamId: string; slot: number }) =>
    `${row.matchTeamId}|${row.slot}`;
  const storedByKey = new Map(stored.map((row) => [key(row), row]));
  const wantedKeys = new Set(wanted.map(key));
  const stale = new Set(
    stored
      .filter((row) => !wantedKeys.has(key(row)))
      .map((row) => row.matchTeamId),
  );
  for (const row of wanted) {
    const current = storedByKey.get(key(row));
    if (!current || differs(row, current)) stale.add(row.matchTeamId);
  }

  const rewrite = wanted.filter((row) => stale.has(row.matchTeamId));
  if (stale.size > 0) {
    await tx.lineup.deleteMany({ where: { matchTeamId: { in: [...stale] } } });
    await tx.lineup.createMany({ data: rewrite });
  }
  return { rows: wanted.length, changes: rewrite.length };
}

export async function seed(
  tx: Tx,
  input: SeedDataInput = SEED_INPUT,
): Promise<SeedReport> {
  const data = seedDataSchema.parse(input);

  const competitions = await syncCompetitions(tx, data);
  const seasons = await syncSeasons(tx, data, competitions.ids);
  const clubs = await syncClubs(tx, data);
  const players = await syncPlayers(tx, data);
  const playerAliases = await syncAliases(tx, data, players.ids);
  const matches = await syncMatches(tx, data, competitions.ids, seasons.ids);
  const matchTeams = await syncMatchTeams(tx, data, matches.ids, clubs.ids);
  const lineups = await syncLineups(
    tx,
    data,
    matches.ids,
    matchTeams.ids,
    players.ids,
  );

  return {
    competitions: competitions.report,
    seasons: seasons.report,
    clubs: clubs.report,
    players: players.report,
    playerAliases: playerAliases.report,
    matches: matches.report,
    matchTeams: matchTeams.report,
    lineups,
  };
}
