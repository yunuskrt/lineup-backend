import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '@/auth/auth.module.js';
import { CatalogModule } from '@/catalog/catalog.module.js';
import { ContractResponseInterceptor } from '@/common/contract-response.js';
import { EnvelopeExceptionFilter } from '@/common/envelope-exception.filter.js';
import { OriginCheckMiddleware } from '@/common/origin-check.middleware.js';
import { ConfigModule } from '@/config/config.module.js';
import { MatchesModule } from '@/matches/matches.module.js';
import { PrismaModule } from '@/prisma/prisma.module.js';
import { UsersModule } from '@/users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    MatchesModule,
    CatalogModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: EnvelopeExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ContractResponseInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(OriginCheckMiddleware).forRoutes('*path');
  }
}
