describe('loadEnv', () => {
  const originalPort = process.env.PORT;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
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
