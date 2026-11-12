import { Inject, Injectable } from '@nestjs/common';
import { effectiveTier, storedTier } from '@/auth/tier.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import type { Tier } from '@/contract/common.js';
import { PrismaService } from '@/prisma/prisma.service.js';

// For gates outside a request's own session read
@Injectable()
export class TierService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // The row at the call: never a handshake's User
  async effectiveTierOf(userId: string): Promise<Tier> {
    if (!this.env.PRO_ENABLED) return 'pro';
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tier: true },
    });
    return effectiveTier(storedTier(row?.tier), true);
  }
}
