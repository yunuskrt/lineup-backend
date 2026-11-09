import type { CatalogOverview } from '@/contract/catalog.js';
import { TOP_CLUBS_LIMIT } from '@/contract/constants.js';
import type { Prisma } from '@/generated/prisma/client.js';

// Stage names are curated by the scraper
const FINAL_STAGE = 'Final';

// Lineups are counted elsewhere, never selected
export const OVERVIEW_SELECT = {
  stage: true,
  extraTime: true,
  shootoutHome: true,
  season: {
    select: {
      startYear: true,
      competition: {
        select: { id: true, kind: true, name: true, logoKey: true },
      },
    },
  },
  teams: {
    select: {
      goals: true,
      club: {
        select: {
          id: true,
          kind: true,
          name: true,
          shortName: true,
          crestKey: true,
        },
      },
    },
  },
} satisfies Prisma.MatchSelect;

export type OverviewRow = Prisma.MatchGetPayload<{
  select: typeof OVERVIEW_SELECT;
}>;
type ClubRow = OverviewRow['teams'][number]['club'];
type CompetitionRow = OverviewRow['season']['competition'];

export type OverviewFigures = {
  counts: Omit<CatalogOverview['counts'], 'players'>;
  highlights: CatalogOverview['highlights'];
};

type Named = { id: string; name: string };

// Fixed locale, id tie-break: a stable order
export const byName = (a: Named, b: Named) =>
  a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en');

export function overviewFigures(rows: readonly OverviewRow[]): OverviewFigures {
  const sides = new Map<string, ClubRow['kind']>();
  const seasons = new Set<number>();
  const highlights = { finals: 0, shootouts: 0, extraTime: 0, goals: 0 };

  for (const row of rows) {
    seasons.add(row.season.startYear);
    if (row.stage === FINAL_STAGE) highlights.finals += 1;
    if (row.shootoutHome !== null) highlights.shootouts += 1;
    if (row.extraTime) highlights.extraTime += 1;
    for (const { club, goals } of row.teams) {
      sides.set(club.id, club.kind);
      highlights.goals += goals;
    }
  }

  const kinds = [...sides.values()];
  return {
    counts: {
      matches: rows.length,
      clubs: kinds.filter((kind) => kind === 'club').length,
      nationalTeams: kinds.filter((kind) => kind === 'national_team').length,
      seasons: seasons.size,
    },
    highlights,
  };
}

// Clubs only, by pool matches, then by name
export function topClubs(rows: readonly OverviewRow[]): ClubRow[] {
  const tally = new Map<string, { club: ClubRow; matches: number }>();
  for (const { teams } of rows) {
    for (const { club } of teams) {
      if (club.kind !== 'club') continue;
      const entry = tally.get(club.id) ?? { club, matches: 0 };
      entry.matches += 1;
      tally.set(club.id, entry);
    }
  }
  return [...tally.values()]
    .sort((a, b) => b.matches - a.matches || byName(a.club, b.club))
    .slice(0, TOP_CLUBS_LIMIT)
    .map(({ club }) => club);
}

export function poolCompetitions(
  rows: readonly OverviewRow[],
): CompetitionRow[] {
  const byId = new Map(
    rows.map(({ season }) => [season.competition.id, season.competition]),
  );
  return [...byId.values()].sort(byName);
}
