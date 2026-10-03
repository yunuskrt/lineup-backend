import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import type { Env } from '@/config/env.schema.js';
import { handleSchema } from '@/contract/auth.js';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@/contract/constants.js';
import type { PrismaService } from '@/prisma/prisma.service.js';

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
    advanced: {
      cookiePrefix: 'lineup',
      // Prisma fills uuid(7) ids, as on every table
      database: { generateId: false },
    },
    // Clients use /auth/*, which applies the handle rules
    disabledPaths: ['/sign-up/email', '/sign-in/email'],
    // Its info logs carry emails
    logger: { level: 'warn' },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
