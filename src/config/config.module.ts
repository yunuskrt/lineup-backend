import { Global, Module } from '@nestjs/common';
import type { Env } from '@/config/env.schema.js';
import { loadEnv } from '@/config/load-env.js';
import { formatEnvIssues } from '@/config/parse-env.js';

export const ENV = Symbol('ENV');

function provideEnv(): Env {
  const result = loadEnv();
  if (!result.success) {
    throw new Error(formatEnvIssues(result.error));
  }
  return result.data;
}

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: provideEnv }],
  exports: [ENV],
})
export class ConfigModule {}
