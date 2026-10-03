const REQUIRED = {
  DATABASE_URL: 'postgresql://u:p@db.example.com/neondb',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:8080',
};
type Key = keyof typeof REQUIRED | 'PORT';
const KEYS: Key[] = ['PORT', ...(Object.keys(REQUIRED) as Key[])];

describe('loadEnv', () => {
  const original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, REQUIRED);
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('parses process.env once and reuses the result', async () => {
    process.env.PORT = '8091';
    const { loadEnv } = await import('@/config/load-env.js');
    const first = loadEnv();

    process.env.PORT = '8092';
    const second = loadEnv();

    expect(second).toBe(first);
    expect(first.success && first.data.PORT).toBe(8091);
  });

  it('carries a failure without throwing', async () => {
    process.env.PORT = 'abc';
    const { loadEnv } = await import('@/config/load-env.js');
    const result = loadEnv();

    expect(result.success).toBe(false);
    expect(!result.success && result.error.map((i) => i.key)).toEqual(['PORT']);
  });
});
