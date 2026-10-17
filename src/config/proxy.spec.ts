import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Env } from '@/config/env.schema.js';
import { applyTrustProxy } from '@/config/proxy.js';

describe('applyTrustProxy', () => {
  it.each([0, 1, 2])('trusts %i proxy hops', (hops) => {
    const set = vi.fn();
    const app = { set } as unknown as NestExpressApplication;
    applyTrustProxy(app, { TRUST_PROXY_HOPS: hops } as Env);
    expect(set).toHaveBeenCalledWith('trust proxy', hops);
  });
});
