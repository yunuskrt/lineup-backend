import { type Built, buildMatch } from '@test/schema/schema-fixtures.js';
import {
  type Tx,
  useRolledBackDb,
  violation,
} from '@test/schema/schema-test-utils.js';

const SLUG = 'test-tm-ids';
// High ids: no clash with any real page id
const ID = '9990001';

type Row = { transfermarktId: string | null };

type Target = {
  table: 'clubs' | 'players' | 'matches';
  // Two existing rows of the table
  pair: (tx: Tx, built: Built) => Promise<[string, string]>;
  set: (tx: Tx, id: string, transfermarktId: string | null) => Promise<Row>;
};

const TARGETS: Target[] = [
  {
    table: 'clubs',
    pair: async (_, { clubs }) => [clubs[0].id, clubs[1].id],
    set: (tx, id, transfermarktId) =>
      tx.club.update({ where: { id }, data: { transfermarktId } }),
  },
  {
    table: 'players',
    pair: async (_, { players }) => [players[0].id, players[1].id],
    set: (tx, id, transfermarktId) =>
      tx.player.update({ where: { id }, data: { transfermarktId } }),
  },
  {
    table: 'matches',
    pair: async (tx, { match, season }) => {
      const second = await tx.match.create({
        data: {
          slug: `${SLUG}-second`,
          seasonId: season.id,
          date: new Date('2003-05-10'),
        },
      });
      return [match.id, second.id];
    },
    set: (tx, id, transfermarktId) =>
      tx.match.update({ where: { id }, data: { transfermarktId } }),
  },
];

describe('Transfermarkt id columns (e2e)', () => {
  const { rolledBack, prisma } = useRolledBackDb();

  const withPair = <T>(
    target: Target,
    change: (tx: Tx, ids: [string, string]) => Promise<T>,
  ) =>
    rolledBack(async (tx) => {
      const built = await buildMatch(tx, SLUG);
      return change(tx, await target.pair(tx, built));
    });

  it('leaves no rows behind', async () => {
    const own = { slug: { startsWith: SLUG } };
    const counts = await Promise.all([
      prisma().club.count({ where: own }),
      prisma().player.count({ where: own }),
      prisma().match.count({ where: own }),
    ]);
    expect(counts).toEqual([0, 0, 0]);
  });

  describe.each(TARGETS)('$table', (target) => {
    it('stores a digit id', async () => {
      const row = await withPair(target, (tx, [id]) => target.set(tx, id, ID));
      expect(row.transfermarktId).toBe(ID);
    });

    // The fixture inserts every row without an id
    it('allows null on many rows', async () => {
      const rows = await withPair(target, async (tx, [a, b]) => [
        await target.set(tx, a, null),
        await target.set(tx, b, null),
      ]);
      expect(rows.map((row) => row.transfermarktId)).toEqual([null, null]);
    });

    it.each(['', 'abc', '12a', ' 123', '123 ', '-1', '1.5'])(
      'rejects %j',
      async (bad) => {
        await expect(
          withPair(target, (tx, [id]) => target.set(tx, id, bad)),
        ).rejects.toThrow(`${target.table}_transfermarkt_id_check`);
      },
    );

    it('rejects the same id on two rows', async () => {
      await expect(
        withPair(target, async (tx, [a, b]) => {
          await target.set(tx, a, ID);
          await target.set(tx, b, ID);
        }),
      ).rejects.toMatchObject(
        violation('P2002', `${target.table}_transfermarkt_id_key`),
      );
    });
  });
});
