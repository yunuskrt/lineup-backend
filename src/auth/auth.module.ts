import { Module } from '@nestjs/common';
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import { createAuth } from '@/auth/auth.factory.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import { PrismaService } from '@/prisma/prisma.service.js';

const BODY_LIMIT = '16kb';

// Mounted as Express middleware on /api/auth/*
@Module({
  imports: [
    BetterAuthModule.forRootAsync({
      inject: [PrismaService, ENV],
      useFactory: (prisma: PrismaService, env: Env) => ({
        auth: createAuth(prisma, env),
        // Parses bodies for every route but /api/auth
        bodyParser: {
          json: { limit: BODY_LIMIT },
          urlencoded: { limit: BODY_LIMIT },
        },
      }),
      // Route guards belong to B12
      disableGlobalAuthGuard: true,
    }),
  ],
})
export class AuthModule {}
