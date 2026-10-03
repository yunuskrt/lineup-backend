import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '@/auth/auth.module.js';
import { ContractResponseInterceptor } from '@/common/contract-response.js';
import { EnvelopeExceptionFilter } from '@/common/envelope-exception.filter.js';
import { ConfigModule } from '@/config/config.module.js';
import { PrismaModule } from '@/prisma/prisma.module.js';

@Module({
  imports: [ConfigModule, PrismaModule, AuthModule],
  providers: [
    { provide: APP_FILTER, useClass: EnvelopeExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ContractResponseInterceptor },
  ],
})
export class AppModule {}
