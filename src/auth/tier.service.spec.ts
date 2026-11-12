import { TierService } from '@/auth/tier.service.js';
import type { Env } from '@/config/env.schema.js';
import type { PrismaService } from '@/prisma/prisma.service.js';

function setup(proEnabled: boolean, row: { tier: unknown } | null) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const service = new TierService(
    { user: { findUnique } } as unknown as PrismaService,
    { PRO_ENABLED: proEnabled } as Env,
  );
  return { service, findUnique };
}

describe('TierService', () => {
  it('reads pro with the switch off, with no query', async () => {
    const { service, findUnique } = setup(false, { tier: 'free' });
    expect(await service.effectiveTierOf('u-1')).toBe('pro');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each(['free', 'pro'] as const)(
    'reads a stored %s from the row with the switch on',
    async (tier) => {
      const { service, findUnique } = setup(true, { tier });
      expect(await service.effectiveTierOf('u-1')).toBe(tier);
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        select: { tier: true },
      });
    },
  );

  it('reads a missing row as free', async () => {
    const { service } = setup(true, null);
    expect(await service.effectiveTierOf('gone')).toBe('free');
  });
});
