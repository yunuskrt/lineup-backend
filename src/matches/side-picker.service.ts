import { Injectable } from '@nestjs/common';
import type { Side } from '@/contract/common.js';
import type { Random } from '@/matches/pool-rules.js';
import { pickSide } from '@/matches/side-rules.js';
import { readSideSignals } from '@/matches/side-signals.js';
import { PrismaService } from '@/prisma/prisma.service.js';

// Duel only: a solo player picks the side
@Injectable()
export class SidePickerService {
  constructor(private readonly prisma: PrismaService) {}

  async pick(matchId: string, random: Random = Math.random): Promise<Side> {
    const score = await this.prisma.memorabilityScore.findUnique({
      where: { matchId },
      select: { signals: true },
    });
    return pickSide(readSideSignals(score?.signals), random);
  }
}
