import {
  deriveDirectorySecret,
  directoryKeyOf,
  secretFingerprint,
} from '@/matches/directory-key.js';

const SECRET = deriveDirectorySecret('k'.repeat(32));
const OTHER = deriveDirectorySecret('o'.repeat(32));
const ID = '0199a8c2-0000-7000-8000-000000000001';

describe('directoryKeyOf', () => {
  it('is 22 base64url characters', () => {
    expect(directoryKeyOf(SECRET, ID)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('is the same for the same id and secret', () => {
    expect(directoryKeyOf(SECRET, ID)).toBe(directoryKeyOf(SECRET, ID));
  });

  it('differs for another id', () => {
    const next = '0199a8c2-0000-7000-8000-000000000002';
    expect(directoryKeyOf(SECRET, next)).not.toBe(directoryKeyOf(SECRET, ID));
  });

  it('differs for another secret', () => {
    expect(directoryKeyOf(OTHER, ID)).not.toBe(directoryKeyOf(SECRET, ID));
  });

  it('does not keep the order of the ids', () => {
    const ids = Array.from(
      { length: 50 },
      (_, i) => `0199a8c2-0000-7000-8000-${String(i).padStart(12, '0')}`,
    );
    const keys = ids.map((id) => directoryKeyOf(SECRET, id));
    expect([...keys].sort()).not.toEqual(keys);
  });
});

describe('deriveDirectorySecret', () => {
  it('is 32 bytes and not the auth secret', () => {
    const secret = deriveDirectorySecret('k'.repeat(32));
    expect(secret).toHaveLength(32);
    expect(secret.toString()).not.toContain('k'.repeat(32));
  });
});

describe('secretFingerprint', () => {
  it('is stable per secret and differs between secrets', () => {
    expect(secretFingerprint(SECRET)).toBe(secretFingerprint(SECRET));
    expect(secretFingerprint(OTHER)).not.toBe(secretFingerprint(SECRET));
    expect(secretFingerprint(SECRET)).toMatch(/^[0-9a-f]{16}$/);
  });
});
