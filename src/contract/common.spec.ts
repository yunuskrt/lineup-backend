import {
  guessTextSchema,
  imageUrlSchema,
  isoDatetimeSchema,
  livesSchema,
  ratioSchema,
  squadCountSchema,
} from '@/contract/common.js';

describe('imageUrlSchema', () => {
  it.each([
    'https://cdn.lineup.gg/players/onur-isiklar.webp',
    'http://localhost:8080/crests/yld.svg',
    '/mock/crests/club-yildirimspor.svg',
  ])('accepts %s', (url) => {
    expect(imageUrlSchema.safeParse(url).success).toBe(true);
  });

  it.each([
    ['protocol-relative', '//evil.example/x.svg'],
    ['data URI', 'data:image/svg+xml;base64,PHN2Zy8+'],
    ['javascript', 'javascript:alert(1)'],
    ['other protocol', 'ftp://cdn.lineup.gg/x.png'],
    ['bare relative', 'mock/crests/x.svg'],
    ['dot relative', './mock/x.svg'],
    ['root only', '/'],
    ['whitespace', '/mock/a b.svg'],
    ['query', '/mock/a.svg?v=1'],
    ['fragment', '/mock/a.svg#x'],
    ['empty', ''],
  ])('rejects a %s path', (_, url) => {
    expect(imageUrlSchema.safeParse(url).success).toBe(false);
  });
});

describe('guessTextSchema', () => {
  it('trims before checking length', () => {
    expect(guessTextSchema.parse('  Xavi  ')).toBe('Xavi');
  });

  it.each([
    ['blank', '   '],
    ['too long', 'x'.repeat(65)],
  ])('rejects a %s guess', (_, guess) => {
    expect(guessTextSchema.safeParse(guess).success).toBe(false);
  });

  it('accepts 64 characters', () => {
    expect(guessTextSchema.safeParse('x'.repeat(64)).success).toBe(true);
  });
});

describe('bounded numbers', () => {
  it.each([0, 3])('accepts %i lives', (lives) => {
    expect(livesSchema.safeParse(lives).success).toBe(true);
  });

  it.each([-1, 4, 1.5])('rejects %s lives', (lives) => {
    expect(livesSchema.safeParse(lives).success).toBe(false);
  });

  it('caps squad counts at 11', () => {
    expect(squadCountSchema.safeParse(11).success).toBe(true);
    expect(squadCountSchema.safeParse(12).success).toBe(false);
  });

  it('keeps ratios within 0–1', () => {
    expect(ratioSchema.safeParse(0.5).success).toBe(true);
    expect(ratioSchema.safeParse(1.01).success).toBe(false);
  });
});

describe('isoDatetimeSchema', () => {
  it('accepts an ISO datetime and rejects a bare date', () => {
    expect(isoDatetimeSchema.safeParse('2025-01-02T03:04:05Z').success).toBe(
      true,
    );
    expect(isoDatetimeSchema.safeParse('2025-01-02').success).toBe(false);
  });
});
