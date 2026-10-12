import { SidePickerService } from '@/matches/side-picker.service.js';
import type { PrismaService } from '@/prisma/prisma.service.js';
import { type Tx, useRolledBackDb } from '@test/schema/schema-test-utils.js';

const SLUG = 'test-side-picker';

// Strongly away: P(home) clamps to 0.3
const AWAY_LEANING = {
  drama: 0.8,
  sides: {
    home: { guessability: 0.2, starPower: 0.1 },
    away: { guessability: 0.9, starPower: 0.8 },
  },
};

async function addMatch(tx: Tx, name: string, signals?: object) {
  const competition = await tx.competition.create({
    data: { slug: `${SLUG}-${name}`, kind: 'league', name: `Side ${name}` },
  });
  const season = await tx.season.create({
    data: { competitionId: competition.id, label: '2010-11', startYear: 2010 },
  });
  const [home, away] = await Promise.all(
    (['h', 'a'] as const).map((key) =>
      tx.club.create({
        data: {
          slug: `${SLUG}-${name}-${key}`,
          kind: 'club',
          name: `Side ${name} ${key}`,
          shortName: key.toUpperCase().repeat(3),
        },
      }),
    ),
  );
  const match = await tx.match.create({
    data: {
      slug: `${SLUG}-${name}`,
      seasonId: season.id,
      date: new Date('2011-03-01'),
      teams: {
        create: [
          { side: 'home', clubId: home.id, goals: 2, formation: '4-4-2' },
          { side: 'away', clubId: away.id, goals: 1, formation: '4-4-2' },
        ],
      },
      ...(signals && {
        memorability: {
          create: {
            score: 70,
            signals,
            algorithmVersion: 'test',
            computedAt: new Date(),
          },
        },
      }),
    },
  });
  return match.id;
}

const picker = (tx: Tx) =>
  new SidePickerService(tx as unknown as PrismaService);

describe('SidePickerService (e2e)', () => {
  const { rolledBack } = useRolledBackDb();

  // 0.49 is home at 50/50, away below 0.3
  const AT = () => 0.49;

  it('tilts toward the side the stored signals favour', async () => {
    const side = await rolledBack(async (tx) => {
      const matchId = await addMatch(tx, 'tilted', AWAY_LEANING);
      return picker(tx).pick(matchId, AT);
    });
    expect(side).toBe('away');
  });

  it('splits evenly for a match with no score row', async () => {
    const side = await rolledBack(async (tx) => {
      const matchId = await addMatch(tx, 'unscored');
      return picker(tx).pick(matchId, AT);
    });
    expect(side).toBe('home');
  });

  it('splits evenly when the stored block is invalid', async () => {
    const side = await rolledBack(async (tx) => {
      const matchId = await addMatch(tx, 'invalid', {
        sides: { home: { guessability: 2, starPower: 0 } },
      });
      return picker(tx).pick(matchId, AT);
    });
    expect(side).toBe('home');
  });
});
