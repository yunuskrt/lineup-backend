import { Logger } from '@nestjs/common';
import {
  createAuth,
  GUEST_EMAIL_DOMAIN,
  sendVerification,
  SESSION_LIFETIME_S,
  VERIFICATION_LIFETIME_S,
} from '@/auth/auth.factory.js';
import { VERIFICATION_SUBJECT } from '@/auth/verification-email.js';
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
  WEB_APP_URL: 'http://localhost:3000',
  MAIL_FROM: 'Lineup <onboarding@resend.dev>',
};

describe('createAuth', () => {
  // The pg pool is lazy: no network here
  const mailer = { send: vi.fn(() => Promise.resolve()) };
  const { options } = createAuth(new PrismaService(env), env, mailer);

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

  it('checks origins under test too, as in production', () => {
    expect(options.advanced?.disableOriginCheck).toBe(false);
  });

  it('requires a handle that passes the contract rule', () => {
    const handle = options.user?.additionalFields?.handle;
    expect(handle?.required).toBe(true);

    const validate = (value: string) =>
      handle?.validator?.input?.['~standard'].validate(value);
    expect(validate('  ist_05  ')).toEqual({ value: 'ist_05' });
    expect(validate('ist 05')).toHaveProperty('issues');
  });

  it('closes the native email, guest and send routes, keeps info logs off', () => {
    expect(options.disabledPaths).toEqual([
      '/sign-up/email',
      '/sign-in/email',
      '/sign-in/anonymous',
      '/delete-anonymous-user',
      '/send-verification-email',
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

  it('sends a soft verification mail on sign-up, valid for 24 hours', () => {
    expect(options.emailAndPassword?.requireEmailVerification).toBe(false);
    expect(options.emailVerification).toMatchObject({
      sendOnSignUp: true,
      expiresIn: VERIFICATION_LIFETIME_S,
      autoSignInAfterVerification: false,
    });
    expect(VERIFICATION_LIFETIME_S).toBe(86_400);
  });

  it('trusts the web app as the verification redirect', () => {
    expect(options.trustedOrigins).toEqual([env.WEB_APP_URL]);
  });

  it('mails the verification link through the mailer', async () => {
    mailer.send.mockClear();
    const user = { id: 'u-1', email: 'fan@lineup.gg', isAnonymous: false };

    await options.emailVerification?.sendVerificationEmail?.({
      user,
      url: 'http://localhost:8080/api/auth/verify-email?token=t',
      token: 't',
    } as never);

    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'fan@lineup.gg',
        subject: VERIFICATION_SUBJECT,
        text: expect.stringContaining('/api/auth/verify-email?token=t'),
      }),
    );
  });

  it('takes its secret and URL from the environment', () => {
    expect([options.secret, options.baseURL]).toEqual([
      env.BETTER_AUTH_SECRET,
      env.BETTER_AUTH_URL,
    ]);
  });
});

describe('sendVerification', () => {
  const logger = new Logger('test');
  const logError = vi.spyOn(logger, 'error');
  const URL = 'http://localhost:8080/api/auth/verify-email?token=t';

  beforeEach(() => {
    logError.mockReset().mockImplementation(() => undefined);
  });

  it('never mails a guest', () => {
    const mailer = { send: vi.fn(() => Promise.resolve()) };
    const guest = { email: `temp-1@${GUEST_EMAIL_DOMAIN}`, isAnonymous: true };

    sendVerification(mailer, guest, URL, logger);

    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('swallows a failed send, logging no address', async () => {
    const mailer = {
      send: vi.fn(() =>
        Promise.reject(new Error('Resend refused the mail with 403')),
      ),
    };

    expect(() =>
      sendVerification(mailer, { email: 'fan@lineup.gg' }, URL, logger),
    ).not.toThrow();
    await vi.waitFor(() => expect(logError).toHaveBeenCalled());

    expect(logError).toHaveBeenCalledWith(
      'Verification mail not sent: Resend refused the mail with 403',
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain('fan@');
  });

  it('logs no detail when the failure is not an Error', async () => {
    const mailer = {
      send: vi.fn(() => Promise.reject({ to: 'fan@lineup.gg', code: 403 })),
    };

    sendVerification(mailer, { email: 'fan@lineup.gg' }, URL, logger);
    await vi.waitFor(() => expect(logError).toHaveBeenCalled());

    expect(logError).toHaveBeenCalledWith(
      'Verification mail not sent: unknown error',
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain('fan@');
  });

  it('returns before the send finishes', () => {
    let settle = () => undefined as void;
    const mailer = {
      send: vi.fn(
        () => new Promise<void>((resolve) => (settle = () => resolve())),
      ),
    };

    sendVerification(mailer, { email: 'fan@lineup.gg' }, URL, logger);

    expect(mailer.send).toHaveBeenCalledTimes(1);
    settle();
  });
});
