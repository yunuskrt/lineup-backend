import { formatEnvIssues, parseEnv } from '@/config/parse-env.js';

const DATABASE_URL = 'postgresql://lineup:secret@db.example.com/neondb';
const base = { DATABASE_URL };

describe('parseEnv', () => {
  it('applies defaults when optional keys are unset', () => {
    expect(parseEnv(base)).toEqual({
      success: true,
      data: { NODE_ENV: 'development', PORT: 8080, DATABASE_URL },
    });
  });

  it('coerces PORT to a number', () => {
    const result = parseEnv({ ...base, PORT: '8090', NODE_ENV: 'production' });
    expect(result).toEqual({
      success: true,
      data: { NODE_ENV: 'production', PORT: 8090, DATABASE_URL },
    });
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
      expect(parseEnv({ DATABASE_URL: url }).success).toBe(true);
    }
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a URL', 'neondb'],
    ['another scheme', 'mysql://u:p@localhost/db'],
  ])('rejects a %s DATABASE_URL', (_, url) => {
    const result = parseEnv({ DATABASE_URL: url });
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
    ]);
  });

  it('never echoes a rejected value', () => {
    const values = {
      NODE_ENV: 'hunter2-secret',
      PORT: 'leaked-token-9f3a',
      DATABASE_URL: 'mysql://admin:s3cr3t-pw@db.internal/prod',
    };
    const result = parseEnv(values);
    if (result.success) throw new Error('expected failure');
    const output = formatEnvIssues(result.error);
    for (const key of Object.keys(values)) expect(output).toContain(key);
    expect(output).not.toContain(values.NODE_ENV);
    expect(output).not.toContain(values.PORT);
    expect(output).not.toContain('s3cr3t-pw');
    expect(output).not.toContain('db.internal');
  });
});
