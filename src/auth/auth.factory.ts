import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { anonymous } from 'better-auth/plugins';
import { generateGuestHandle } from '@/auth/guest-handle.js';
import type { Env } from '@/config/env.schema.js';
import { handleSchema } from '@/contract/auth.js';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@/contract/constants.js';
import type { PrismaService } from '@/prisma/prisma.service.js';

// .invalid can never receive mail
export const GUEST_EMAIL_DOMAIN = 'guest.lineup.invalid';
export const SESSION_LIFETIME_S = 30 * 24 * 60 * 60;

export function createAuth(prisma: PrismaService, env: Env) {
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
    },
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
    },
    // Clients use /auth/*, which applies the handle rules
    disabledPaths: [
      '/sign-up/email',
      '/sign-in/email',
      '/sign-in/anonymous',
      '/delete-anonymous-user',
    ],
    // Its info logs carry emails
    logger: { level: 'warn' },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
