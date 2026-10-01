import { z } from 'zod';
import {
  idSchema,
  isoDatetimeSchema,
  livesSchema,
  ratioSchema,
  squadCountSchema,
} from '@/contract/common.js';
import {
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
} from '@/contract/constants.js';
import { userSchema } from '@/contract/auth.js';
import { duelOutcomeSchema } from '@/contract/duel.js';
import { clubRefSchema, matchIdentitySchema } from '@/contract/match.js';
import { contractRegistry } from '@/contract/registry.js';
import { soloEndReasonSchema } from '@/contract/solo.js';

const countSchema = z.number().int().nonnegative();

export const userStatsSchema = z
  .object({
    played: countSchema,
    wins: countSchema,
    losses: countSchema,
    draws: countSchema,
    accuracy: ratioSchema,
    bestStreak: countSchema,
    perfectClears: countSchema,
    favouriteClub: clubRefSchema.nullable(),
  })
  .register(contractRegistry, { id: 'UserStats' });
export type UserStats = z.infer<typeof userStatsSchema>;

export const profileSchema = z
  .object({
    user: userSchema,
    stats: userStatsSchema,
  })
  .register(contractRegistry, { id: 'Profile' });
export type Profile = z.infer<typeof profileSchema>;

const historyEntryBase = {
  id: idSchema,
  playedAt: isoDatetimeSchema,
  match: matchIdentitySchema,
  foundCount: squadCountSchema,
  livesRemaining: livesSchema,
};

export const historyEntrySchema = z
  .discriminatedUnion('mode', [
    z.object({
      ...historyEntryBase,
      mode: z.literal('solo'),
      outcome: soloEndReasonSchema,
    }),
    z.object({
      ...historyEntryBase,
      mode: z.literal('duel'),
      outcome: duelOutcomeSchema,
    }),
  ])
  .register(contractRegistry, { id: 'HistoryEntry' });
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

// Query-string input, so values arrive as text
export const historyQuerySchema = z
  .object({
    cursor: idSchema.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_HISTORY_LIMIT)
      .default(DEFAULT_HISTORY_LIMIT),
  })
  .register(contractRegistry, { id: 'HistoryQuery' });
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

export const historyPageSchema = z
  .object({
    entries: z.array(historyEntrySchema),
    nextCursor: idSchema.nullable(),
  })
  .register(contractRegistry, { id: 'HistoryPage' });
export type HistoryPage = z.infer<typeof historyPageSchema>;
