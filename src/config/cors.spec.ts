import { corsOptions } from '@/config/cors.js';
import type { Env } from '@/config/env.schema.js';

describe('corsOptions', () => {
  const env = { WEB_APP_URL: 'https://app.lineup.gg' } as Env;

  it('allows only the web app, with credentials', () => {
    expect(corsOptions(env)).toEqual({
      origin: ['https://app.lineup.gg'],
      credentials: true,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    });
  });

  it('exposes no response headers', () => {
    expect(corsOptions(env)).not.toHaveProperty('exposedHeaders');
  });
});
