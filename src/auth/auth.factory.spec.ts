import { createAuth } from '@/auth/auth.factory.js';
import type { Env } from '@/config/env.schema.js';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@/contract/constants.js';
import { PrismaService } from '@/prisma/prisma.service.js';

const env: Env = {
  NODE_ENV: 'test',
  PORT: 8080,
  DATABASE_URL: 'postgresql://u:p@db.example.com/neondb',
  BETTER_AUTH_SECRET: 'k'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:8080',
};

describe('createAuth', () => {
  // The pg pool is lazy: no network here
  const { options } = createAuth(new PrismaService(env), env);

  it('enforces the contract password lengths', () => {
    expect(options.emailAndPassword).toMatchObject({
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
    });
  });

  it('offers no social sign-in', () => {
    expect(options).not.toHaveProperty('socialProviders');
  });

  it('leaves ids to Prisma and prefixes its cookies', () => {
    expect(options.advanced).toMatchObject({
      cookiePrefix: 'lineup',
      database: { generateId: false },
    });
  });

  it('requires a handle that passes the contract rule', () => {
    const handle = options.user?.additionalFields?.handle;
    expect(handle?.required).toBe(true);

    const validate = (value: string) =>
      handle?.validator?.input?.['~standard'].validate(value);
    expect(validate('  ist_05  ')).toEqual({ value: 'ist_05' });
    expect(validate('ist 05')).toHaveProperty('issues');
  });

  it('takes its secret and URL from the environment', () => {
    expect([options.secret, options.baseURL]).toEqual([
      env.BETTER_AUTH_SECRET,
      env.BETTER_AUTH_URL,
    ]);
  });
});
