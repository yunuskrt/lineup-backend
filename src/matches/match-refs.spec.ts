import { clubRefSchema } from '@/contract/match.js';
import { toClubRef } from '@/matches/match-refs.js';

const CLUB = {
  id: '01900000-0000-7000-8000-000000000001',
  slug: 'yildiz',
  kind: 'club' as const,
  name: 'Yıldız SK',
  shortName: 'YLD',
  crestKey: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('toClubRef', () => {
  it('maps a club to a contract ClubRef', () => {
    const ref = toClubRef(CLUB);

    expect(ref).toEqual({
      id: CLUB.id,
      name: 'Yıldız SK',
      shortName: 'YLD',
      crestUrl: null,
    });
    expect(clubRefSchema.parse(ref)).toEqual(ref);
  });

  it('never sends a bucket key as a URL', () => {
    expect(toClubRef({ ...CLUB, crestKey: 'crests/yildiz.svg' }).crestUrl).toBe(
      null,
    );
  });
});
