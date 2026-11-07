import {
  directoryPlayerSchema,
  playerDirectorySchema,
} from '@/contract/catalog.js';

const PLAYER = {
  key: 'AbCdEfGhIjKlMnOpQrStUv',
  name: 'Oğuzhan Şimşek',
  imageUrl: null,
  terms: ['oguzhan simsek', 'simsek'],
};

describe('directoryPlayerSchema', () => {
  it('accepts a player with a key, a name and terms', () => {
    expect(directoryPlayerSchema.safeParse(PLAYER).success).toBe(true);
  });

  it.each([
    ['no terms', { terms: [] }],
    ['an empty term', { terms: [''] }],
    ['an empty name', { name: '' }],
    ['a short key', { key: 'abc' }],
    ['a bare image key', { imageUrl: 'players/x.webp' }],
  ])('rejects %s', (_, change) => {
    expect(
      directoryPlayerSchema.safeParse({ ...PLAYER, ...change }).success,
    ).toBe(false);
  });

  it('drops any field outside the four', () => {
    const parsed = playerDirectorySchema.parse({
      players: [{ ...PLAYER, id: 'p-1', slug: 'x' }],
    });
    expect(Object.keys(parsed.players[0] ?? {}).sort()).toEqual([
      'imageUrl',
      'key',
      'name',
      'terms',
    ]);
  });
});
