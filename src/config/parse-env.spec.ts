import { formatEnvIssues, parseEnv } from '@/config/parse-env.js';

describe('parseEnv', () => {
  it('applies defaults when keys are unset', () => {
    expect(parseEnv({})).toEqual({
      success: true,
      data: { NODE_ENV: 'development', PORT: 8080 },
    });
  });

  it('coerces PORT to a number', () => {
    const result = parseEnv({ PORT: '8090', NODE_ENV: 'production' });
    expect(result).toEqual({
      success: true,
      data: { NODE_ENV: 'production', PORT: 8090 },
    });
  });

  it('ignores keys outside the schema', () => {
    const result = parseEnv({ PATH: '/usr/bin' });
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
    const result = parseEnv({ PORT: port });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.map((i) => i.key)).toEqual(['PORT']);
  });

  it('rejects an unknown NODE_ENV', () => {
    const result = parseEnv({ NODE_ENV: 'staging' });
    expect(!result.success && result.error.map((i) => i.key)).toEqual([
      'NODE_ENV',
    ]);
  });

  it('reports every bad key at once', () => {
    const result = parseEnv({ NODE_ENV: 'staging', PORT: 'abc' });
    expect(!result.success && result.error.map((i) => i.key)).toEqual([
      'NODE_ENV',
      'PORT',
    ]);
  });

  it('never echoes a rejected value', () => {
    const values = { NODE_ENV: 'hunter2-secret', PORT: 'leaked-token-9f3a' };
    const result = parseEnv(values);
    if (result.success) throw new Error('expected failure');
    const output = formatEnvIssues(result.error);
    expect(output).toContain('NODE_ENV');
    expect(output).toContain('PORT');
    expect(output).not.toContain(values.NODE_ENV);
    expect(output).not.toContain(values.PORT);
  });
});
