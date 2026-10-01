import { z } from 'zod';
import { epochMsSchema, idSchema } from '@/contract/common.js';
import { revealedPlayerSchema } from '@/contract/player.js';
import { contractRegistry } from '@/contract/registry.js';

export const roundTimingSchema = z
  .object({
    startedAt: epochMsSchema,
    endsAt: epochMsSchema,
  })
  .refine((round) => round.endsAt > round.startedAt, {
    error: 'Round must end after it starts',
    path: ['endsAt'],
  })
  .register(contractRegistry, { id: 'RoundTiming' });
export type RoundTiming = z.infer<typeof roundTimingSchema>;

// Unknown names and wrong players look alike
export const guessResultSchema = z
  .discriminatedUnion('outcome', [
    z.object({
      outcome: z.literal('correct_new'),
      player: revealedPlayerSchema,
    }),
    z.object({
      outcome: z.literal('already_found'),
      playerId: idSchema,
    }),
    z.object({
      outcome: z.literal('not_in_xi'),
    }),
  ])
  .register(contractRegistry, { id: 'GuessResult' });
export type GuessResult = z.infer<typeof guessResultSchema>;
