import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module.js';
import { loadEnv } from '@/config/load-env.js';
import { formatEnvIssues } from '@/config/parse-env.js';
import { setupDocs } from '@/docs/setup-docs.js';

async function bootstrap() {
  const env = loadEnv();
  if (!env.success) {
    new Logger('Config').error(formatEnvIssues(env.error));
    process.exitCode = 1;
    return;
  }

  // Better Auth parses its own bodies (B10)
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Lets SIGTERM close the database pool cleanly
  app.enableShutdownHooks();
  setupDocs(app);
  await app.listen(env.data.PORT);
}

try {
  await bootstrap();
} catch (error) {
  // e.g. the database is unreachable at startup
  const reason = error instanceof Error ? error.message : String(error);
  new Logger('Bootstrap').error(`Startup failed: ${reason.trim()}`);
  process.exitCode = 1;
}
