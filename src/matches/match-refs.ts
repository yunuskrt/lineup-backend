import type { Club, Prisma } from '@/generated/prisma/client.js';
import type {
  ClubRef,
  CompetitionRef,
  MatchIdentity,
} from '@/contract/match.js';

type ClubRow = Pick<Club, 'id' | 'name' | 'shortName'>;

const CLUB_REF_SELECT = {
  id: true,
  name: true,
  shortName: true,
} satisfies Prisma.ClubSelect;

// Never selects a lineup: the squad stays put
export const MATCH_IDENTITY_SELECT = {
  id: true,
  date: true,
  stage: true,
  nickname: true,
  season: {
    select: {
      label: true,
      competition: { select: { id: true, kind: true, name: true } },
    },
  },
  teams: {
    select: { side: true, goals: true, club: { select: CLUB_REF_SELECT } },
  },
} satisfies Prisma.MatchSelect;

type MatchRow = Prisma.MatchGetPayload<{
  select: typeof MATCH_IDENTITY_SELECT;
}>;

// crest_key is a bucket key; URLs arrive with B23
export function toClubRef(club: ClubRow): ClubRef {
  return {
    id: club.id,
    name: club.name,
    shortName: club.shortName,
    crestUrl: null,
  };
}

export function toCompetitionRef(
  competition: MatchRow['season']['competition'],
): CompetitionRef {
  return { id: competition.id, kind: competition.kind, name: competition.name };
}

export function toMatchIdentity(match: MatchRow): MatchIdentity {
  const home = match.teams.find((team) => team.side === 'home');
  const away = match.teams.find((team) => team.side === 'away');
  if (!home || !away) throw new Error(`Match ${match.id} lacks a side`);

  return {
    id: match.id,
    competition: toCompetitionRef(match.season.competition),
    season: match.season.label,
    // A DATE column arrives as UTC midnight
    date: match.date.toISOString().slice(0, 10),
    stage: match.stage,
    home: toClubRef(home.club),
    away: toClubRef(away.club),
    score: { home: home.goals, away: away.goals },
    nickname: match.nickname,
  };
}
