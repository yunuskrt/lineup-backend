import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { loadEnv } from '@/config/load-env.js';
import { formatEnvIssues } from '@/config/parse-env.js';
import { PrismaClient } from '@/generated/prisma/client.js';
import { seed, SEED_TABLES, type SeedReport } from '@scripts/seed/seed.js';

// Neon round-trips add up over ~900 rows
const TRANSACTION_TIMEOUT_MS = 120_000;

// Counts only: names and XIs never reach stdout
function printReport(report: SeedReport): void {
  for (const table of SEED_TABLES) {
    const { rows, changes } = report[table];
    console.log(
      `${table.padEnd(14)} ${String(rows).padStart(4)} rows, ${changes} changed`,
    );
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof z.ZodError) return z.prettifyError(error);
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.success) throw new Error(formatEnvIssues(env.error));
  if (env.data.NODE_ENV === 'production') {
    throw new Error('Refusing to seed with NODE_ENV=production');
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
    const report = await prisma.$transaction((tx) => seed(tx), {
      maxWait: 10_000,
      timeout: TRANSACTION_TIMEOUT_MS,
    });
    printReport(report);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`Seed failed: ${describeFailure(error)}`);
  process.exitCode = 1;
});
