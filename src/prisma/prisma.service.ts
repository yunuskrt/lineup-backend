import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import { PrismaClient } from '@/generated/prisma/client.js';

const CONNECT_TIMEOUT_MS = 10_000;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(@Inject(ENV) env: Env) {
    super({
      adapter: new PrismaPg({
        connectionString: env.DATABASE_URL,
        connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      }),
      // Never `query`: it would print lineup rows
      log: ['warn', 'error'],
      errorFormat: 'minimal',
    });
  }

  // With an adapter, $connect() opens nothing
  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
