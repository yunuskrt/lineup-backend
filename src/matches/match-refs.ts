import type { Club } from '@/generated/prisma/client.js';
import type { ClubRef } from '@/contract/match.js';

type ClubRow = Pick<Club, 'id' | 'name' | 'shortName'>;

// crest_key is a bucket key; URLs arrive with B23
export function toClubRef(club: ClubRow): ClubRef {
  return {
    id: club.id,
    name: club.name,
    shortName: club.shortName,
    crestUrl: null,
  };
}
