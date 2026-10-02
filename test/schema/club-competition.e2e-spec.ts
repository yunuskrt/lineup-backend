import { Test } from '@nestjs/testing';
import { ConfigModule } from '@/config/config.module.js';
import type { Prisma } from '@/generated/prisma/client.js';
import { PrismaModule } from '@/prisma/prisma.module.js';
import { PrismaService } from '@/prisma/prisma.service.js';

class Rollback extends Error {}

// P2002 = unique violation, P2003 = foreign-key violation
const violation = (code: 'P2002' | 'P2003', constraint: string) => ({
  code,
  meta: {
    driverAdapterError: { cause: { constraint: { index: constraint } } },
  },
});

type Tx = Prisma.TransactionClient;

describe('Club & competition schema (e2e)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PrismaModule],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Every case runs in its own transaction, always rolled back
  async function rolledBack<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    let result: T | undefined;
    try {
      await prisma.$transaction(
        async (tx) => {
          result = await work(tx);
          throw new Rollback();
        },
        { timeout: 15_000 },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    return result as T;
  }

  const competition = (tx: Tx, slug = 'test-crown-league') =>
    tx.competition.create({
      data: { slug, kind: 'league', name: 'Crown League' },
    });

  const club = (tx: Tx, slug = 'test-northgate') =>
    tx.club.create({
      data: { slug, kind: 'club', name: 'Northgate United', shortName: 'NGU' },
    });

  const season = async (tx: Tx, label: string, startYear: number) => {
    const { id } = await competition(tx);
    return tx.season.create({
      data: { competitionId: id, label, startYear },
    });
  };

  it('round-trips every model with its relations', async () => {
    const read = await rolledBack(async (tx) => {
      const { id: competitionId } = await competition(tx);
      await tx.season.create({
        data: { competitionId, label: '2004-05', startYear: 2004 },
      });
      const { id: clubId } = await tx.club.create({
        data: {
          slug: 'test-yildirimspor',
          kind: 'club',
          name: 'Yıldırımspor',
          shortName: 'YLD',
          crestKey: 'crests/yildirimspor.svg',
          aliases: { create: [{ alias: 'Yıldırım' }, { alias: 'YLD' }] },
        },
      });
      await tx.club.create({
        data: {
          slug: 'test-nation',
          kind: 'national_team',
          name: 'Solvaria',
          shortName: 'SOL',
        },
      });
      return {
        competition: await tx.competition.findUniqueOrThrow({
          where: { id: competitionId },
          include: { seasons: true },
        }),
        club: await tx.club.findUniqueOrThrow({
          where: { id: clubId },
          include: { aliases: { orderBy: { alias: 'asc' } } },
        }),
        nations: await tx.club.count({ where: { kind: 'national_team' } }),
      };
    });

    expect(read.competition).toMatchObject({
      kind: 'league',
      seasons: [{ label: '2004-05', startYear: 2004 }],
    });
    expect(read.competition.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(read.club.name).toBe('Yıldırımspor');
    expect(read.club.crestKey).toBe('crests/yildirimspor.svg');
    expect(read.club.aliases.map((a) => a.alias)).toEqual(['YLD', 'Yıldırım']);
    expect(read.nations).toBeGreaterThanOrEqual(1);
  });

  it('leaves no rows behind', async () => {
    const leftovers = await prisma.club.count({
      where: { slug: { startsWith: 'test-' } },
    });
    expect(leftovers).toBe(0);
  });

  describe('season CHECK constraints', () => {
    it.each([
      ['a league season', '2004-05', 2004],
      ['a tournament year', '2006', 2006],
      ['the first season', '2000-01', 2000],
      ['a decade rollover', '2009-10', 2009],
      ['the last season', '2025-26', 2025],
    ])('accepts %s', async (_, label, startYear) => {
      const created = await rolledBack((tx) => season(tx, label, startYear));
      expect(created.label).toBe(label);
    });

    it.each([
      ['a slash label', '2004/05', 2004, 'seasons_label_format_check'],
      ['a short label', '04-05', 2004, 'seasons_label_format_check'],
      ['a year before 2000', '1999-00', 1999, 'seasons_start_year_range_check'],
      ['a year after 2025', '2026-27', 2026, 'seasons_start_year_range_check'],
      ['a mismatched start', '2005', 2004, 'seasons_label_start_year_check'],
      [
        'a non-consecutive span',
        '2004-06',
        2004,
        'seasons_label_consecutive_check',
      ],
    ])('rejects %s', async (_, label, startYear, constraint) => {
      await expect(
        rolledBack((tx) => season(tx, label, startYear)),
      ).rejects.toThrow(constraint);
    });
  });

  describe('text CHECK constraints', () => {
    it('rejects a blank club name', async () => {
      await expect(
        rolledBack((tx) =>
          tx.club.create({
            data: {
              slug: 'test-blank',
              kind: 'club',
              name: '  ',
              shortName: 'X',
            },
          }),
        ),
      ).rejects.toThrow('clubs_text_check');
    });

    it('rejects a blank competition slug', async () => {
      await expect(rolledBack((tx) => competition(tx, ' '))).rejects.toThrow(
        'competitions_text_check',
      );
    });

    it('rejects a blank alias', async () => {
      await expect(
        rolledBack(async (tx) => {
          const { id } = await club(tx);
          return tx.clubAlias.create({ data: { clubId: id, alias: '' } });
        }),
      ).rejects.toThrow('club_aliases_alias_check');
    });
  });

  describe('unique constraints', () => {
    it('rejects a duplicate season label within a competition', async () => {
      await expect(
        rolledBack(async (tx) => {
          const { id } = await competition(tx);
          const data = { competitionId: id, label: '2004-05', startYear: 2004 };
          await tx.season.create({ data });
          await tx.season.create({ data });
        }),
      ).rejects.toMatchObject(
        violation('P2002', 'seasons_competition_id_label_key'),
      );
    });

    it('allows the same season label in two competitions', async () => {
      const count = await rolledBack(async (tx) => {
        for (const slug of ['test-a', 'test-b']) {
          const { id } = await competition(tx, slug);
          await tx.season.create({
            data: { competitionId: id, label: '2004-05', startYear: 2004 },
          });
        }
        return tx.season.count({ where: { label: '2004-05' } });
      });
      expect(count).toBeGreaterThanOrEqual(2);
    });

    it('rejects duplicate club and competition slugs', async () => {
      await expect(
        rolledBack(async (tx) => {
          await club(tx);
          await club(tx);
        }),
      ).rejects.toMatchObject(violation('P2002', 'clubs_slug_key'));
      await expect(
        rolledBack(async (tx) => {
          await competition(tx);
          await competition(tx);
        }),
      ).rejects.toMatchObject(violation('P2002', 'competitions_slug_key'));
    });

    it('lets two clubs share an alias, but not one club twice', async () => {
      const shared = await rolledBack(async (tx) => {
        const a = await club(tx, 'test-united-a');
        const b = await club(tx, 'test-united-b');
        await tx.clubAlias.createMany({
          data: [
            { clubId: a.id, alias: 'United' },
            { clubId: b.id, alias: 'United' },
          ],
        });
        return tx.clubAlias.count({ where: { alias: 'United' } });
      });
      expect(shared).toBeGreaterThanOrEqual(2);

      await expect(
        rolledBack(async (tx) => {
          const { id } = await club(tx);
          await tx.clubAlias.create({ data: { clubId: id, alias: 'United' } });
          await tx.clubAlias.create({ data: { clubId: id, alias: 'United' } });
        }),
      ).rejects.toMatchObject(
        violation('P2002', 'club_aliases_club_id_alias_key'),
      );
    });
  });

  describe('delete behaviour', () => {
    it('deletes a club’s aliases with it', async () => {
      const remaining = await rolledBack(async (tx) => {
        const { id } = await tx.club.create({
          data: {
            slug: 'test-cascade',
            kind: 'club',
            name: 'Cascade FC',
            shortName: 'CAS',
            aliases: { create: [{ alias: 'Cascade' }] },
          },
        });
        await tx.club.delete({ where: { id } });
        return tx.clubAlias.count({ where: { clubId: id } });
      });
      expect(remaining).toBe(0);
    });

    it('refuses to delete a competition that still has seasons', async () => {
      await expect(
        rolledBack(async (tx) => {
          const { competitionId } = await season(tx, '2004-05', 2004);
          await tx.competition.delete({ where: { id: competitionId } });
        }),
      ).rejects.toMatchObject(
        violation('P2003', 'seasons_competition_id_fkey'),
      );
    });
  });
});
