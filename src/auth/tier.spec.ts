import { effectiveTier, storedTier } from '@/auth/tier.js';

describe('effectiveTier', () => {
  it.each([
    ['free', true, 'free'],
    ['pro', true, 'pro'],
    ['free', false, 'pro'],
    ['pro', false, 'pro'],
  ] as const)('stored %s, switch %s: %s', (stored, proEnabled, expected) => {
    expect(effectiveTier(stored, proEnabled)).toBe(expected);
  });
});

describe('storedTier', () => {
  it('keeps a known tier', () => {
    expect(storedTier('pro')).toBe('pro');
    expect(storedTier('free')).toBe('free');
  });

  it.each([undefined, null, '', 'gold', 'PRO', 1])(
    'reads %s as free',
    (value) => {
      expect(storedTier(value)).toBe('free');
    },
  );
});
