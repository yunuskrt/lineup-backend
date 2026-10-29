import type { Club, Prisma } from '@/generated/prisma/client.js';
import type { Side } from '@/contract/common.js';
import type {
  ClubRef,
  CompetitionRef,
  MatchIdentity,
  MatchInPlay,
} from '@/contract/match.js';
import { assetUrl } from '@/matches/asset-url.js';

type ClubRow = Pick<Club, 'id' | 'name' | 'shortName' | 'crestKey'>;

const CLUB_REF_SELECT = {
  id: true,
  name: true,
  shortName: true,
  crestKey: true,
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

export function toClubRef(
  club: ClubRow,
  assetBase: string | undefined,
): ClubRef {
  return {
    id: club.id,
    name: club.name,
    shortName: club.shortName,
    crestUrl: assetUrl(assetBase, club.crestKey),
  };
}

export function toCompetitionRef(
  competition: MatchRow['season']['competition'],
): CompetitionRef {
  return { id: competition.id, kind: competition.kind, name: competition.name };
}

export function toMatchIdentity(
  match: MatchRow,
  assetBase: string | undefined,
): MatchIdentity {
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
    home: toClubRef(home.club, assetBase),
    away: toClubRef(away.club, assetBase),
    score: { home: home.goals, away: away.goals },
    nickname: match.nickname,
  };
}

// Formation comes from the squad, never a lineup
export function toMatchInPlay(
  identity: MatchIdentity,
  side: Side,
  formation: string,
): MatchInPlay {
  return { ...identity, side, formation };
}
