import {
  type Tx,
  useRolledBackDb,
  violation,
} from '@test/schema/schema-test-utils.js';

describe('Player & alias schema (e2e)', () => {
  const { rolledBack, prisma } = useRolledBackDb();

  const player = (tx: Tx, slug = 'test-pennock', name = 'Gareth Pennock') =>
    tx.player.create({ data: { slug, name } });

  const aliasFor = (tx: Tx, playerId: string, normalized: string) =>
    tx.playerAlias.create({
      data: { playerId, alias: normalized, normalized },
    });

  it('round-trips a player with raw and normalized aliases', async () => {
    const read = await rolledBack(async (tx) => {
      const { id } = await tx.player.create({
        data: {
          slug: 'test-odonovan',
          name: "Ciarán O'Donovan",
          imageKey: 'players/odonovan.webp',
          aliases: {
            create: [
              { alias: "Ciarán O'Donovan", normalized: 'ciaran odonovan' },
              { alias: "O'Donovan", normalized: 'odonovan' },
              { alias: 'O Donovan', normalized: 'o donovan' },
            ],
          },
        },
      });
      return tx.player.findUniqueOrThrow({
        where: { id },
        include: { aliases: { orderBy: { normalized: 'asc' } } },
      });
    });

    expect(read.name).toBe("Ciarán O'Donovan");
    expect(read.imageKey).toBe('players/odonovan.webp');
    expect(
      read.aliases.map(({ alias, normalized }) => [alias, normalized]),
    ).toEqual([
      ["Ciarán O'Donovan", 'ciaran odonovan'],
      ['O Donovan', 'o donovan'],
      ["O'Donovan", 'odonovan'],
    ]);
  });

  it('leaves no rows behind', async () => {
    const leftovers = await prisma().player.count({
      where: { slug: { startsWith: 'test-' } },
    });
    expect(leftovers).toBe(0);
  });

  describe('alias uniqueness', () => {
    it('lets two players share a normalized alias', async () => {
      const shared = await rolledBack(async (tx) => {
        const dean = await player(tx, 'test-dean-harlow', 'Dean Harlow');
        const rhys = await player(tx, 'test-rhys-harlow', 'Rhys Harlow');
        await aliasFor(tx, dean.id, 'harlow');
        await aliasFor(tx, rhys.id, 'harlow');
        return tx.playerAlias.count({ where: { normalized: 'harlow' } });
      });
      expect(shared).toBeGreaterThanOrEqual(2);
    });

    it('treats two spellings that normalize alike as one alias', async () => {
      await expect(
        rolledBack(async (tx) => {
          const { id } = await player(tx, 'test-ibra', 'Zlatan Ibrahimović');
          await tx.playerAlias.createMany({
            data: [
              { playerId: id, alias: 'Ibrahimović', normalized: 'ibrahimovic' },
              { playerId: id, alias: 'Ibrahimovic', normalized: 'ibrahimovic' },
            ],
          });
        }),
      ).rejects.toMatchObject(
        violation('P2002', 'player_aliases_player_id_normalized_key'),
      );
    });

    it('rejects a duplicate player slug', async () => {
      await expect(
        rolledBack(async (tx) => {
          await player(tx);
          await player(tx);
        }),
      ).rejects.toMatchObject(violation('P2002', 'players_slug_key'));
    });

    it('rejects an alias for a player that does not exist', async () => {
      await expect(
        rolledBack((tx) =>
          aliasFor(tx, '00000000-0000-7000-8000-000000000000', 'ghost'),
        ),
      ).rejects.toMatchObject(
        violation('P2003', 'player_aliases_player_id_fkey'),
      );
    });
  });

  describe('CHECK constraints', () => {
    it.each(['ibra', 'ciaran odonovan', 'o donovan', 'ronaldo 9'])(
      'accepts the normalized form %j',
      async (normalized) => {
        const created = await rolledBack(async (tx) => {
          const { id } = await player(tx);
          return aliasFor(tx, id, normalized);
        });
        expect(created.normalized).toBe(normalized);
      },
    );

    it.each([
      ['uppercase', 'Ibra'],
      ['a leading space', ' ibra'],
      ['a trailing space', 'ibra '],
      ['a double space', 'o  donovan'],
      ['a tab', 'o\tdonovan'],
      ['an empty string', ''],
    ])('rejects a normalized alias with %s', async (_, normalized) => {
      // Valid raw alias: only `normalized` can fail
      await expect(
        rolledBack(async (tx) => {
          const { id } = await player(tx);
          return tx.playerAlias.create({
            data: { playerId: id, alias: 'Ibra', normalized },
          });
        }),
      ).rejects.toThrow('player_aliases_normalized_check');
    });

    it('rejects a blank raw alias', async () => {
      await expect(
        rolledBack(async (tx) => {
          const { id } = await player(tx);
          return tx.playerAlias.create({
            data: { playerId: id, alias: '  ', normalized: 'ibra' },
          });
        }),
      ).rejects.toThrow('player_aliases_alias_check');
    });

    it.each([
      ['name', { slug: 'test-blank', name: ' ' }],
      ['slug', { slug: '', name: 'Gareth Pennock' }],
    ])('rejects a blank player %s', async (_, data) => {
      await expect(
        rolledBack((tx) => tx.player.create({ data })),
      ).rejects.toThrow('players_text_check');
    });
  });

  it('deletes a player’s aliases with it', async () => {
    const remaining = await rolledBack(async (tx) => {
      const { id } = await player(tx);
      await aliasFor(tx, id, 'pennock');
      await tx.player.delete({ where: { id } });
      return tx.playerAlias.count({ where: { playerId: id } });
    });
    expect(remaining).toBe(0);
  });

  describe('extensions', () => {
    it('installs pg_trgm and unaccent', async () => {
      const rows = await prisma().$queryRaw<{ extname: string }[]>`
        SELECT extname FROM pg_extension
        WHERE extname IN ('pg_trgm', 'unaccent') ORDER BY extname`;
      expect(rows.map((row) => row.extname)).toEqual(['pg_trgm', 'unaccent']);
    });

    it('folds diacritics with unaccent()', async () => {
      const [row] = await prisma().$queryRaw<{ folded: string }[]>`
        SELECT unaccent('Ibrahimović Núñez Šimšek') AS folded`;
      expect(row.folded).toBe('Ibrahimovic Nunez Simsek');
    });

    // B28 trap: default limit matches Ronaldinho
    it('matches ronaldo to ronaldinho at the default trigram limit', async () => {
      const [row] = await prisma().$queryRaw<
        { score: number; limit: number; matches: boolean }[]
      >`
        SELECT similarity('ronaldo', 'ronaldinho')::float8 AS score,
               show_limit()::float8 AS limit,
               'ronaldo' % 'ronaldinho' AS matches`;
      expect(row.score).toBeCloseTo(0.4615, 4);
      expect(row.limit).toBeCloseTo(0.3, 4);
      expect(row.matches).toBe(true);
    });
  });
});
