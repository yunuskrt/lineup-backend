import { formatEnvIssues, parseEnv } from '@/config/parse-env.js';

const DATABASE_URL = 'postgresql://lineup:secret@db.example.com/neondb';
const BETTER_AUTH_SECRET = 'k'.repeat(32);
const BETTER_AUTH_URL = 'http://localhost:8080';
const WEB_APP_URL = 'http://localhost:3000';
const MAIL_FROM = 'Lineup <onboarding@resend.dev>';
const RESEND_API_KEY = 're_test_key';
const base = {
  DATABASE_URL,
  BETTER_AUTH_SECRET,
  BETTER_AUTH_URL,
  WEB_APP_URL,
  MAIL_FROM,
};

describe('parseEnv', () => {
  it('applies defaults when optional keys are unset', () => {
    expect(parseEnv(base)).toEqual({
      success: true,
      data: { NODE_ENV: 'development', PORT: 8080, ...base },
    });
  });

  it('coerces PORT to a number', () => {
    const prod = { ...base, NODE_ENV: 'production', RESEND_API_KEY };
    const result = parseEnv({ ...prod, PORT: '8090' });
    expect(result).toEqual({ success: true, data: { ...prod, PORT: 8090 } });
  });

  it('ignores keys outside the schema', () => {
    const result = parseEnv({ ...base, PATH: '/usr/bin' });
    if (!result.success) throw new Error('expected success');
    expect(result.data).not.toHaveProperty('PATH');
  });

  it.each([
    ['empty', ''],
    ['whitespace', '  '],
    ['non-numeric', 'abc'],
    ['fractional', '80.5'],
    ['zero', '0'],
    ['out of range', '65536'],
  ])('rejects a %s PORT', (_, port) => {
    const result = parseEnv({ ...base, PORT: port });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.map((i) => i.key)).toEqual(['PORT']);
  });

  it('rejects an unknown NODE_ENV', () => {
    const result = parseEnv({ ...base, NODE_ENV: 'staging' });
    expect(!result.success && result.error.map((i) => i.key)).toEqual([
      'NODE_ENV',
    ]);
  });

  it('accepts both postgres URL schemes', () => {
    for (const url of [DATABASE_URL, 'postgres://u:p@localhost:5432/db']) {
      expect(parseEnv({ ...base, DATABASE_URL: url }).success).toBe(true);
    }
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a URL', 'neondb'],
    ['another scheme', 'mysql://u:p@localhost/db'],
  ])('rejects a %s DATABASE_URL', (_, url) => {
    const result = parseEnv({ ...base, DATABASE_URL: url });
    expect(!result.success && result.error.map((i) => i.key)).toEqual([
      'DATABASE_URL',
    ]);
  });

  it('reports every bad key at once', () => {
    const result = parseEnv({ NODE_ENV: 'staging', PORT: 'abc' });
    expect(!result.success && result.error.map((i) => i.key)).toEqual([
      'NODE_ENV',
      'PORT',
      'DATABASE_URL',
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_URL',
      'WEB_APP_URL',
      'MAIL_FROM',
    ]);
  });

  describe('mail keys', () => {
    it('keeps WEB_APP_URL as an origin', () => {
      const result = parseEnv({
        ...base,
        WEB_APP_URL: 'https://app.lineup.gg/',
      });
      expect(result.success && result.data.WEB_APP_URL).toBe(
        'https://app.lineup.gg',
      );
    });

    it.each([
      ['missing', undefined],
      ['not a URL', 'localhost:3000'],
      ['another scheme', 'ftp://localhost'],
    ])('rejects a %s WEB_APP_URL', (_, url) => {
      const result = parseEnv({ ...base, WEB_APP_URL: url });
      expect(!result.success && result.error.map((i) => i.key)).toEqual([
        'WEB_APP_URL',
      ]);
    });

    it.each(['Lineup <no-reply@lineup.gg>', 'no-reply@lineup.gg'])(
      'accepts the sender %s',
      (from) => {
        expect(parseEnv({ ...base, MAIL_FROM: from }).success).toBe(true);
      },
    );

    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['no address', 'Lineup'],
      ['an unclosed bracket', 'Lineup <no-reply@lineup.gg'],
    ])('rejects a %s MAIL_FROM', (_, from) => {
      const result = parseEnv({ ...base, MAIL_FROM: from });
      expect(!result.success && result.error.map((i) => i.key)).toEqual([
        'MAIL_FROM',
      ]);
    });

    it('leaves RESEND_API_KEY optional outside production', () => {
      for (const NODE_ENV of ['development', 'test']) {
        const result = parseEnv({ ...base, NODE_ENV });
        expect(result.success && result.data.RESEND_API_KEY).toBeUndefined();
      }
    });

    it('requires RESEND_API_KEY in production', () => {
      const result = parseEnv({ ...base, NODE_ENV: 'production' });
      expect(!result.success && result.error).toEqual([
        { key: 'RESEND_API_KEY', reason: 'Required in production' },
      ]);
      expect(
        parseEnv({ ...base, NODE_ENV: 'production', RESEND_API_KEY }).success,
      ).toBe(true);
    });

    it('reports a missing production key with the other bad keys', () => {
      const result = parseEnv({ NODE_ENV: 'production' });
      expect(!result.success && result.error.map((i) => i.key)).toContain(
        'RESEND_API_KEY',
      );
    });

    it.each([
      ['empty', ''],
      ['not a Resend key', 'sk_live_123'],
    ])('rejects an %s RESEND_API_KEY', (_, key) => {
      const result = parseEnv({ ...base, RESEND_API_KEY: key });
      expect(!result.success && result.error.map((i) => i.key)).toEqual([
        'RESEND_API_KEY',
      ]);
    });
  });

  it.each([
    ['missing', undefined],
    ['31 characters', 'k'.repeat(31)],
  ])('rejects a %s BETTER_AUTH_SECRET', (_, secret) => {
    const result = parseEnv({ ...base, BETTER_AUTH_SECRET: secret });
    expect(!result.success && result.error.map((i) => i.key)).toEqual([
      'BETTER_AUTH_SECRET',
    ]);
  });

  it.each([
    ['missing', undefined],
    ['not a URL', 'localhost:8080'],
    ['another scheme', 'ftp://localhost'],
  ])('rejects a %s BETTER_AUTH_URL', (_, url) => {
    const result = parseEnv({ ...base, BETTER_AUTH_URL: url });
    expect(!result.success && result.error.map((i) => i.key)).toEqual([
      'BETTER_AUTH_URL',
    ]);
  });

  it('never echoes a rejected value', () => {
    const values = {
      NODE_ENV: 'hunter2-secret',
      PORT: 'leaked-token-9f3a',
      DATABASE_URL: 'mysql://admin:s3cr3t-pw@db.internal/prod',
      BETTER_AUTH_SECRET: 'short-auth-secret-x9',
      RESEND_API_KEY: 'sk_leaked_resend_9f3a',
    };
    const result = parseEnv(values);
    if (result.success) throw new Error('expected failure');
    const output = formatEnvIssues(result.error);
    for (const key of Object.keys(values)) expect(output).toContain(key);
    expect(output).not.toContain(values.NODE_ENV);
    expect(output).not.toContain(values.PORT);
    expect(output).not.toContain('s3cr3t-pw');
    expect(output).not.toContain('db.internal');
    expect(output).not.toContain(values.BETTER_AUTH_SECRET);
    expect(output).not.toContain(values.RESEND_API_KEY);
  });
});
