import {
  type DirectoryRow,
  directoryTag,
  matchesTag,
  pickEncoding,
  toPlayerDirectory,
} from '@/catalog/player-directory.js';
import { playerDirectorySchema } from '@/contract/catalog.js';
import {
  deriveDirectorySecret,
  directoryKeyOf,
} from '@/matches/directory-key.js';

const SECRET = deriveDirectorySecret('k'.repeat(32));
const keyOf = (id: string) => directoryKeyOf(SECRET, id);
const BASE = 'https://bucket.example.com/images';

const row = (
  id: string,
  aliases: string[],
  imageKey: string | null = null,
): DirectoryRow => ({
  id,
  name: `Name ${id}`,
  imageKey,
  aliases: aliases.map((normalized) => ({ normalized })),
});

const ROWS = Array.from({ length: 30 }, (_, i) =>
  row(`p-${String(i).padStart(2, '0')}`, [`alias ${i}`]),
);

describe('toPlayerDirectory', () => {
  it('lists every player with an alias and passes the contract', () => {
    const directory = toPlayerDirectory(ROWS, BASE, keyOf);
    expect(directory.players).toHaveLength(30);
    expect(playerDirectorySchema.safeParse(directory).success).toBe(true);
  });

  it('leaves out a player with no alias', () => {
    const directory = toPlayerDirectory(
      [row('p-1', ['one']), row('p-2', [])],
      BASE,
      keyOf,
    );
    expect(directory.players.map((p) => p.key)).toEqual([keyOf('p-1')]);
  });

  it('sends distinct terms, sorted', () => {
    const [player] = toPlayerDirectory(
      [row('p-1', ['zeta', 'alfa', 'zeta', 'mu'])],
      BASE,
      keyOf,
    ).players;
    expect(player?.terms).toEqual(['alfa', 'mu', 'zeta']);
  });

  it('sends a photo URL under the base, else null', () => {
    const rows = [
      row('p-1', ['one'], 'players/one/0123456789ab.webp'),
      row('p-2', ['two']),
    ];
    const byKey = (base: string | undefined) =>
      new Map(
        toPlayerDirectory(rows, base, keyOf).players.map((p) => [
          p.key,
          p.imageUrl,
        ]),
      );
    expect(byKey(BASE).get(keyOf('p-1'))).toBe(
      `${BASE}/players/one/0123456789ab.webp`,
    );
    expect(byKey(BASE).get(keyOf('p-2'))).toBeNull();
    expect(byKey(undefined).get(keyOf('p-1'))).toBeNull();
  });

  it('sorts by key, whatever order the rows came in', () => {
    const keys = toPlayerDirectory(ROWS, BASE, keyOf).players.map((p) => p.key);
    expect(keys).toEqual([...keys].sort());
    const reversed = toPlayerDirectory([...ROWS].reverse(), BASE, keyOf);
    expect(reversed.players.map((p) => p.key)).toEqual(keys);
  });

  it('sends only key, name, imageUrl and terms', () => {
    const rows = [
      { ...row('p-1', ['one'], 'players/one/x.webp'), slug: 'one' },
    ] as unknown as DirectoryRow[];
    const [player] = toPlayerDirectory(rows, BASE, keyOf).players;
    expect(Object.keys(player ?? {}).sort()).toEqual([
      'imageUrl',
      'key',
      'name',
      'terms',
    ]);
    expect(JSON.stringify(player)).not.toContain('"p-1"');
  });
});

describe('directoryTag', () => {
  const parts = {
    version: '3787:123:9517:456',
    assetBase: BASE,
    keyFingerprint: '0123456789abcdef',
  };

  it('is a strong, quoted tag, the same for the same parts', () => {
    expect(directoryTag(parts)).toMatch(/^"[A-Za-z0-9_-]{32}"$/);
    expect(directoryTag({ ...parts })).toBe(directoryTag(parts));
  });

  it.each([
    ['version', { version: '3788:123:9517:456' }],
    ['asset base', { assetBase: undefined }],
    ['key fingerprint', { keyFingerprint: 'fedcba9876543210' }],
  ])('changes with the %s', (_, change) => {
    expect(directoryTag({ ...parts, ...change })).not.toBe(directoryTag(parts));
  });
});

describe('matchesTag', () => {
  const TAG = '"abc"';

  it.each([
    ['the exact tag', '"abc"', true],
    ['the weak form', 'W/"abc"', true],
    ['a list holding it', '"old", "abc"', true],
    ['a wildcard', '*', true],
    ['a stale tag', '"old"', false],
    ['an unquoted value', 'abc', false],
    ['an empty header', '', false],
  ])('%s → %s', (_, header, expected) => {
    expect(matchesTag(header, TAG)).toBe(expected);
  });

  it('is false with no header', () => {
    expect(matchesTag(undefined, TAG)).toBe(false);
  });
});

describe('pickEncoding', () => {
  it.each([
    ['br', 'br'],
    ['gzip', 'gzip'],
    ['gzip, deflate, br', 'br'],
    ['br;q=0, gzip', 'gzip'],
    ['br;q=0, gzip;q=0', 'identity'],
    ['deflate', 'identity'],
    ['*', 'br'],
    ['*, br;q=0', 'gzip'],
    ['GZIP', 'gzip'],
    ['', 'identity'],
  ])('%j → %s', (header, expected) => {
    expect(pickEncoding(header)).toBe(expected);
  });

  it('sends it uncompressed with no header', () => {
    expect(pickEncoding(undefined)).toBe('identity');
  });
});
