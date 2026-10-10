import type { INestApplication } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import type { Env } from '@/config/env.schema.js';

// Only the web app may call with credentials
export function corsOptions(env: Env): CorsOptions {
  return {
    origin: [env.WEB_APP_URL],
    credentials: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  };
}

// Before init, so it runs ahead of Better Auth too
export function applyCors(app: INestApplication, env: Env): void {
  app.enableCors(corsOptions(env));
}
