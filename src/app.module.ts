import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ContractResponseInterceptor } from '@/common/contract-response.js';
import { EnvelopeExceptionFilter } from '@/common/envelope-exception.filter.js';
import { ConfigModule } from '@/config/config.module.js';

@Module({
  imports: [ConfigModule],
  providers: [
    { provide: APP_FILTER, useClass: EnvelopeExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ContractResponseInterceptor },
  ],
})
export class AppModule {}
