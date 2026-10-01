import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module.js';
import { loadEnv } from '@/config/load-env.js';
import { formatEnvIssues } from '@/config/parse-env.js';

async function bootstrap() {
  const env = loadEnv();
  if (!env.success) {
    new Logger('Config').error(formatEnvIssues(env.error));
    process.exitCode = 1;
    return;
  }

  // Better Auth parses its own bodies (B10)
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  await app.listen(env.data.PORT);
}
await bootstrap();
