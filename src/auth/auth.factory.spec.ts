import {
  createAuth,
  GUEST_EMAIL_DOMAIN,
  SESSION_LIFETIME_S,
} from '@/auth/auth.factory.js';
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

  it('closes the native email and guest routes, keeps info logs off', () => {
    expect(options.disabledPaths).toEqual([
      '/sign-up/email',
      '/sign-in/email',
      '/sign-in/anonymous',
      '/delete-anonymous-user',
    ]);
    expect(options.logger).toEqual({ level: 'warn' });
  });

  it('keeps guests, on an address that takes no mail', () => {
    const [plugin] = options.plugins;
    expect(plugin.id).toBe('anonymous');
    expect(plugin.options).toMatchObject({
      disableDeleteAnonymousUser: true,
      emailDomainName: GUEST_EMAIL_DOMAIN,
    });
    expect(GUEST_EMAIL_DOMAIN).toMatch(/\.invalid$/);
  });

  it('names a guest with a generated handle', async () => {
    const name = await options.plugins[0].options?.generateName?.({} as never);
    expect(name).toMatch(/^guest-[0-9a-z]{8}$/);
  });

  it('copies a guest name into its handle, and only a guest', async () => {
    const before = options.databaseHooks?.user?.create?.before;
    const user = { name: 'guest-abc12345', email: 'x@y.z' };

    // Better Auth merges data into the row
    expect(await before?.({ ...user, isAnonymous: true } as never)).toEqual({
      data: { handle: 'guest-abc12345' },
    });
    expect(await before?.({ ...user, handle: 'fan_05' } as never)).toBe(
      undefined,
    );
  });

  it('keeps sessions for 30 days', () => {
    expect(options.session?.expiresIn).toBe(SESSION_LIFETIME_S);
    expect(SESSION_LIFETIME_S).toBe(2_592_000);
  });

  it('takes its secret and URL from the environment', () => {
    expect([options.secret, options.baseURL]).toEqual([
      env.BETTER_AUTH_SECRET,
      env.BETTER_AUTH_URL,
    ]);
  });
});
