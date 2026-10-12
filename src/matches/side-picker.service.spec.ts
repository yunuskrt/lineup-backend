import { SidePickerService } from '@/matches/side-picker.service.js';
import type { PrismaService } from '@/prisma/prisma.service.js';

// Strongly away: P(home) clamps to 0.3
const AWAY_LEANING = {
  sides: {
    home: { guessability: 0.1, starPower: 0.1 },
    away: { guessability: 0.9, starPower: 0.9 },
  },
};

function serviceWith(row: { signals: unknown } | null) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const prisma = { memorabilityScore: { findUnique } };
  const service = new SidePickerService(prisma as unknown as PrismaService);
  return { findUnique, service };
}

describe('SidePickerService', () => {
  it('reads only the signals of the match score row', async () => {
    const { findUnique, service } = serviceWith(null);
    await service.pick('match-1', () => 0);
    expect(findUnique).toHaveBeenCalledWith({
      where: { matchId: 'match-1' },
      select: { signals: true },
    });
  });

  it('splits evenly with no score row', async () => {
    const { service } = serviceWith(null);
    await expect(service.pick('m', () => 0.49)).resolves.toBe('home');
    await expect(service.pick('m', () => 0.5)).resolves.toBe('away');
  });

  it('splits evenly when the row has no sides block', async () => {
    const { service } = serviceWith({ signals: { drama: 0.8 } });
    await expect(service.pick('m', () => 0.49)).resolves.toBe('home');
  });

  it('tilts by the sides block', async () => {
    const { service } = serviceWith({ signals: AWAY_LEANING });
    await expect(service.pick('m', () => 0.29)).resolves.toBe('home');
    await expect(service.pick('m', () => 0.31)).resolves.toBe('away');
  });

  it('defaults to Math.random', async () => {
    const { service } = serviceWith(null);
    await expect(service.pick('m')).resolves.toMatch(/^(home|away)$/);
  });
});
