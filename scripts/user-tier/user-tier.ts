import { type Tier, tierSchema } from '@/contract/common.js';
import type { Prisma } from '@/generated/prisma/client.js';

export const USAGE = 'Usage: npm run user:tier -- <email or handle> <free|pro>';

// Handles never hold an @ (handleSchema)
export type UserTarget = { email: string } | { handle: string };

export type TierArgs =
  | { success: true; data: { target: UserTarget; tier: Tier } }
  | { success: false; error: string };

export type TierChange = { handle: string; before: Tier; after: Tier };

export function parseTierArgs(argv: readonly string[]): TierArgs {
  const [who, raw, ...rest] = argv.map((arg) => arg.trim());
  if (!who || !raw || rest.length > 0) return { success: false, error: USAGE };
  const tier = tierSchema.safeParse(raw);
  if (!tier.success) {
    return { success: false, error: `Unknown tier "${raw}". ${USAGE}` };
  }
  const target = who.includes('@')
    ? { email: who.toLowerCase() }
    : { handle: who };
  return { success: true, data: { target, tier: tier.data } };
}

type Found = { id: string; handle: string; tier: Tier };

async function findUser(
  db: Prisma.TransactionClient,
  target: UserTarget,
): Promise<Found | null> {
  if ('email' in target) {
    return db.user.findUnique({
      where: { email: target.email },
      select: { id: true, handle: true, tier: true },
    });
  }
  // As the unique index: lower(handle)
  const [row] = await db.$queryRaw<Found[]>`
    SELECT id, handle, tier::text AS tier FROM users
    WHERE lower(handle) = lower(${target.handle})`;
  return row ?? null;
}

// null when no user matches
export async function setUserTier(
  db: Prisma.TransactionClient,
  target: UserTarget,
  tier: Tier,
): Promise<TierChange | null> {
  const found = await findUser(db, target);
  if (!found) return null;
  await db.user.update({ where: { id: found.id }, data: { tier } });
  return { handle: found.handle, before: found.tier, after: tier };
}
