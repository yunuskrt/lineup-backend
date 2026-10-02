import { Test } from '@nestjs/testing';
import { ConfigModule } from '@/config/config.module.js';
import type { Prisma } from '@/generated/prisma/client.js';
import { PrismaModule } from '@/prisma/prisma.module.js';
import { PrismaService } from '@/prisma/prisma.service.js';

export type Tx = Prisma.TransactionClient;

class Rollback extends Error {}

// P2002 unique, P2003 foreign key
export const violation = (code: 'P2002' | 'P2003', constraint: string) => ({
  code,
  meta: {
    driverAdapterError: { cause: { constraint: { index: constraint } } },
  },
});

// Call in a describe; opens and closes Prisma
export function useRolledBackDb() {
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PrismaModule],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // One transaction per case, always rolled back
  async function rolledBack<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    let result: T | undefined;
    try {
      await prisma.$transaction(
        async (tx) => {
          result = await work(tx);
          throw new Rollback();
        },
        { timeout: 15_000 },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    return result as T;
  }

  return { rolledBack, prisma: () => prisma };
}
