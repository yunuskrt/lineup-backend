import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Env } from '@/config/env.schema.js';

// 0 trusts no proxy: req.ip is the socket's address
export function applyTrustProxy(app: NestExpressApplication, env: Env): void {
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
}
