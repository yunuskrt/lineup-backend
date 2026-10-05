import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import { AuthFlowService } from '@/auth/auth-flow.service.js';
import { AuthController } from '@/auth/auth.controller.js';
import { createAuth } from '@/auth/auth.factory.js';
import { SessionGuard } from '@/auth/session.guard.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import { MailModule } from '@/mail/mail.module.js';
import { MAILER, type Mailer } from '@/mail/mailer.js';
import { PrismaService } from '@/prisma/prisma.service.js';

// Mounted as Express middleware on /api/auth/*
@Module({
  imports: [
    MailModule,
    BetterAuthModule.forRootAsync({
      imports: [MailModule],
      inject: [PrismaService, ENV, MAILER],
      useFactory: (prisma: PrismaService, env: Env, mailer: Mailer) => ({
        auth: createAuth(prisma, env, mailer),
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
  providers: [AuthFlowService, { provide: APP_GUARD, useClass: SessionGuard }],
})
export class AuthModule {}
