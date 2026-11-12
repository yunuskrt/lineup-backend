import { existsSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { loadEnv } from '@/config/load-env.js';
import { formatEnvIssues } from '@/config/parse-env.js';
import { PrismaClient } from '@/generated/prisma/client.js';
import { parseTierArgs, setUserTier } from '@scripts/user-tier/user-tier.js';

async function main(): Promise<void> {
  const args = parseTierArgs(process.argv.slice(2));
  if (!args.success) throw new Error(args.error);

  // Run by tsx, not Prisma: nothing loads .env
  if (existsSync('.env')) process.loadEnvFile('.env');
  const env = loadEnv();
  if (!env.success) throw new Error(formatEnvIssues(env.error));
  if (env.data.NODE_ENV === 'production') {
    throw new Error('Refusing to set a tier with NODE_ENV=production');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: env.data.DATABASE_URL,
      connectionTimeoutMillis: 10_000,
    }),
    log: ['warn', 'error'],
    errorFormat: 'minimal',
  });
  try {
    const { target, tier } = args.data;
    const change = await prisma.$transaction((tx) =>
      setUserTier(tx, target, tier),
    );
    if (!change) throw new Error('No user has that email or handle');
    console.log(`${change.handle}: ${change.before} -> ${change.after}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`user:tier failed: ${reason}`);
  process.exitCode = 1;
});
