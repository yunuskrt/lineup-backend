import { Module } from '@nestjs/common';
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import { AuthFlowService } from '@/auth/auth-flow.service.js';
import { AuthController } from '@/auth/auth.controller.js';
import { createAuth } from '@/auth/auth.factory.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import { PrismaService } from '@/prisma/prisma.service.js';

// Mounted as Express middleware on /api/auth/*
@Module({
  imports: [
    BetterAuthModule.forRootAsync({
      inject: [PrismaService, ENV],
      useFactory: (prisma: PrismaService, env: Env) => ({
        auth: createAuth(prisma, env),
        // JSON only: a form post can't sign anyone in
        bodyParser: {
          json: { limit: '16kb' },
          urlencoded: { enabled: false },
        },
      }),
      // Route guards belong to B12
      disableGlobalAuthGuard: true,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthFlowService],
})
export class AuthModule {}
