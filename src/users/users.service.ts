import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import type { UserStats } from '@/contract/profile.js';
import { toClubRef } from '@/matches/match-refs.js';
import { PrismaService } from '@/prisma/prisma.service.js';

// Written by B34 and B41 when a game ends
const NO_STATS: UserStats = {
  played: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  accuracy: 0,
  bestStreak: 0,
  perfectClears: 0,
  favouriteClub: null,
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async statsOf(userId: string): Promise<UserStats> {
    const row = await this.prisma.userStats.findUnique({
      where: { userId },
      include: { favouriteClub: true },
    });
    if (!row) return NO_STATS;

    return {
      played: row.played,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      accuracy:
        row.totalGuesses === 0 ? 0 : row.correctGuesses / row.totalGuesses,
      bestStreak: row.bestStreak,
      perfectClears: row.perfectClears,
      favouriteClub: row.favouriteClub
        ? toClubRef(row.favouriteClub, this.env.ASSET_BASE_URL)
        : null,
    };
  }
}
