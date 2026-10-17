import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import { AuthFlowService } from '@/auth/auth-flow.service.js';
import { AuthController } from '@/auth/auth.controller.js';
import { createAuth } from '@/auth/auth.factory.js';
import { GatewayTokenController } from '@/auth/gateway-token.controller.js';
import { GatewayTokenService } from '@/auth/gateway-token.service.js';
import { SessionGuard } from '@/auth/session.guard.js';
import { RateLimitGuard } from '@/common/rate-limit.guard.js';
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
        // CORS is ours: src/config/cors.ts, in main.ts
        disableTrustedOriginsCors: true,
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
  controllers: [AuthController, GatewayTokenController],
  providers: [
    AuthFlowService,
    GatewayTokenService,
    { provide: APP_GUARD, useClass: SessionGuard },
    // Global guards run in order: limits need the user
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  // B36's handshake verifies tokens with it
  exports: [GatewayTokenService],
})
export class AuthModule {}
