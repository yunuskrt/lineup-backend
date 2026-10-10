import { userStatsSchema } from '@/contract/profile.js';
import type { PrismaService } from '@/prisma/prisma.service.js';
import { UsersService } from '@/users/users.service.js';

const USER_ID = '01900000-0000-7000-8000-0000000000aa';
const CLUB = {
  id: '01900000-0000-7000-8000-000000000001',
  name: 'Yıldız SK',
  shortName: 'YLD',
  crestKey: null,
};

const row = (extra: object = {}) => ({
  userId: USER_ID,
  played: 12,
  wins: 5,
  losses: 3,
  draws: 1,
  perfectClears: 2,
  bestStreak: 7,
  correctGuesses: 30,
  totalGuesses: 40,
  favouriteClubId: null,
  favouriteClub: null,
  ...extra,
});

describe('UsersService', () => {
  // A read only: any write would throw here
  const prisma = { userStats: { findUnique: vi.fn() } };
  const service = new UsersService(prisma as unknown as PrismaService);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('statsOf', () => {
    it("reads the user's own row, with its favourite club", async () => {
      prisma.userStats.findUnique.mockResolvedValue(null);

      await service.statsOf(USER_ID);

      expect(prisma.userStats.findUnique).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        include: { favouriteClub: true },
      });
    });

    it('maps a stored row field by field', async () => {
      prisma.userStats.findUnique.mockResolvedValue(row());

      const stats = await service.statsOf(USER_ID);

      expect(stats).toEqual({
        played: 12,
        wins: 5,
        losses: 3,
        draws: 1,
        accuracy: 0.75,
        bestStreak: 7,
        perfectClears: 2,
        favouriteClub: null,
      });
      expect(userStatsSchema.parse(stats)).toEqual(stats);
    });

    it('gives an accuracy of 0 with no guesses', async () => {
      prisma.userStats.findUnique.mockResolvedValue(
        row({ correctGuesses: 0, totalGuesses: 0 }),
      );

      expect((await service.statsOf(USER_ID)).accuracy).toBe(0);
    });

    it('reads a missing row as zeros, writing nothing', async () => {
      prisma.userStats.findUnique.mockResolvedValue(null);

      const stats = await service.statsOf(USER_ID);

      expect(stats).toEqual({
        played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        accuracy: 0,
        bestStreak: 0,
        perfectClears: 0,
        favouriteClub: null,
      });
    });

    it('sends a favourite club as a ClubRef', async () => {
      prisma.userStats.findUnique.mockResolvedValue(
        row({ favouriteClubId: CLUB.id, favouriteClub: CLUB }),
      );

      expect((await service.statsOf(USER_ID)).favouriteClub).toEqual({
        id: CLUB.id,
        name: 'Yıldız SK',
        shortName: 'YLD',
        crestUrl: null,
      });
    });
  });
});
