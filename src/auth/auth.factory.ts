import { Logger } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { anonymous } from 'better-auth/plugins';
import { generateGuestHandle } from '@/auth/guest-handle.js';
import { verificationEmail } from '@/auth/verification-email.js';
import type { Env } from '@/config/env.schema.js';
import { handleSchema } from '@/contract/auth.js';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@/contract/constants.js';
import type { Mailer } from '@/mail/mailer.js';
import type { PrismaService } from '@/prisma/prisma.service.js';

// .invalid can never receive mail
export const GUEST_EMAIL_DOMAIN = 'guest.lineup.invalid';
export const SESSION_LIFETIME_S = 30 * 24 * 60 * 60;
export const VERIFICATION_LIFETIME_S = 24 * 60 * 60;

// Not awaited: a failed send can't block sign-up
export function sendVerification(
  mailer: Mailer,
  user: { email: string } & Record<string, unknown>,
  url: string,
  logger = new Logger('Auth'),
): void {
  if (user.isAnonymous === true) return;
  mailer.send(verificationEmail(user.email, url)).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : 'unknown error';
    logger.error(`Verification mail not sent: ${reason}`);
  });
}

export function createAuth(prisma: PrismaService, env: Env, mailer: Mailer) {
  return betterAuth({
    appName: 'Lineup',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // Off by default: user and account in one commit
    database: prismaAdapter(prisma, {
      provider: 'postgresql',
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      // Soft: an unverified address blocks nothing
      requireEmailVerification: false,
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: VERIFICATION_LIFETIME_S,
      autoSignInAfterVerification: false,
      sendVerificationEmail: ({ user, url }) => {
        sendVerification(mailer, user, url);
        return Promise.resolve();
      },
    },
    // The verification link redirects back to the web
    trustedOrigins: [env.WEB_APP_URL],
    user: {
      additionalFields: {
        handle: {
          type: 'string',
          required: true,
          validator: { input: handleSchema },
        },
      },
    },
    // A guest's cookie is its only identity
    session: { expiresIn: SESSION_LIFETIME_S },
    databaseHooks: {
      user: {
        create: {
          // The plugin sends no handle; reuse its name
          before: (user) =>
            Promise.resolve(
              user.isAnonymous === true
                ? { data: { handle: user.name } }
                : undefined,
            ),
        },
      },
    },
    plugins: [
      anonymous({
        // Kept, never merged: B34 decides on history
        disableDeleteAnonymousUser: true,
        emailDomainName: GUEST_EMAIL_DOMAIN,
        generateName: () => generateGuestHandle(),
      }),
    ],
    advanced: {
      cookiePrefix: 'lineup',
      // Prisma fills uuid(7) ids, as on every table
      database: { generateId: false },
      // Off by default under test; keep tests like prod
      disableOriginCheck: false,
    },
    // Clients use /auth/*, which applies the handle rules
    disabledPaths: [
      '/sign-up/email',
      '/sign-in/email',
      '/sign-in/anonymous',
      '/delete-anonymous-user',
      // Open to anyone, it would mail any address
      '/send-verification-email',
    ],
    // Its info logs carry emails
    logger: { level: 'warn' },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
