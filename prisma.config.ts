import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// The Prisma 7 CLI no longer reads .env itself
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // May be unset for `generate` on a fresh clone
  datasource: { url: process.env.DATABASE_URL },
});
