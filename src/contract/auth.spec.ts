import {
  signInRequestSchema,
  signUpRequestSchema,
  upgradeGuestRequestSchema,
  userSchema,
} from '@/contract/auth.js';

const signUp = {
  email: 'fan@lineup.gg',
  password: 'correct-horse',
  handle: 'istanbul05',
};

describe('signInRequestSchema', () => {
  it('accepts an email and an 8–128 character password', () => {
    expect(signInRequestSchema.safeParse(signUp).success).toBe(true);
  });

  it.each([
    ['bad email', { ...signUp, email: 'not-an-email' }],
    ['short password', { ...signUp, password: 'x'.repeat(7) }],
    ['long password', { ...signUp, password: 'x'.repeat(129) }],
  ])('rejects a %s', (_, body) => {
    expect(signInRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('signUpRequestSchema', () => {
  it('trims the handle before checking its length', () => {
    expect(
      signUpRequestSchema.parse({ ...signUp, handle: '  abc  ' }).handle,
    ).toBe('abc');
  });

  it.each(['Ist_05', 'a.b-c', 'x'.repeat(24)])(
    'accepts the handle %j',
    (handle) => {
      expect(signUpRequestSchema.safeParse({ ...signUp, handle }).success).toBe(
        true,
      );
    },
  );

  it.each([
    ['short', '  ab  '],
    ['long', 'x'.repeat(25)],
    ['spaced', 'ist 05'],
    ['accented', 'İstanbul'],
    ['emoji', 'fan⚽'],
    ['symbol', 'fan@lineup'],
  ])('rejects a %s handle', (_, handle) => {
    expect(signUpRequestSchema.safeParse({ ...signUp, handle }).success).toBe(
      false,
    );
  });

  it('has the same shape for a guest upgrade', () => {
    expect(upgradeGuestRequestSchema.parse(signUp)).toEqual(
      signUpRequestSchema.parse(signUp),
    );
  });
});

describe('userSchema', () => {
  it('only accepts known tiers', () => {
    const user = { id: 'u-1', handle: 'fan', isGuest: true, tier: 'free' };
    expect(userSchema.safeParse(user).success).toBe(true);
    expect(userSchema.safeParse({ ...user, tier: 'admin' }).success).toBe(
      false,
    );
  });
});
