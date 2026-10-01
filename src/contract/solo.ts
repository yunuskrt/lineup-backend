import { z } from 'zod';
import {
  guessTextSchema,
  idSchema,
  livesSchema,
  ratioSchema,
  sideSchema,
  squadCountSchema,
} from '@/contract/common.js';
import { SQUAD_SIZE } from '@/contract/constants.js';
import {
  clubRefSchema,
  matchIdentitySchema,
  matchInPlaySchema,
} from '@/contract/match.js';
import { revealedPlayerSchema } from '@/contract/player.js';
import { contractRegistry } from '@/contract/registry.js';
import { guessResultSchema, roundTimingSchema } from '@/contract/round.js';

export const soloSessionStatusSchema = z
  .enum(['active', 'over'])
  .register(contractRegistry, { id: 'SoloSessionStatus' });
export type SoloSessionStatus = z.infer<typeof soloSessionStatusSchema>;

export const soloEndReasonSchema = z
  .enum(['lives_out', 'quit', 'perfect_clear'])
  .register(contractRegistry, { id: 'SoloEndReason' });
export type SoloEndReason = z.infer<typeof soloEndReasonSchema>;

export const soloMatchOfferSchema = z
  .object({
    sessionId: idSchema,
    home: clubRefSchema,
    away: clubRefSchema,
  })
  .register(contractRegistry, { id: 'SoloMatchOffer' });
export type SoloMatchOffer = z.infer<typeof soloMatchOfferSchema>;

export const chooseSideRequestSchema = z
  .object({ side: sideSchema })
  .register(contractRegistry, { id: 'ChooseSideRequest' });
export type ChooseSideRequest = z.infer<typeof chooseSideRequestSchema>;

const foundPlayersSchema = z.array(revealedPlayerSchema).max(SQUAD_SIZE);

export const soloSessionSchema = z
  .object({
    sessionId: idSchema,
    status: soloSessionStatusSchema,
    match: matchInPlaySchema,
    lives: livesSchema,
    found: foundPlayersSchema,
    round: roundTimingSchema.nullable(),
  })
  .register(contractRegistry, { id: 'SoloSession' });
export type SoloSession = z.infer<typeof soloSessionSchema>;

export const soloGuessRequestSchema = z
  .object({
    sessionId: idSchema,
    guess: guessTextSchema,
  })
  .register(contractRegistry, { id: 'SoloGuessRequest' });
export type SoloGuessRequest = z.infer<typeof soloGuessRequestSchema>;

export const soloGuessResponseSchema = z
  .object({
    result: guessResultSchema,
    session: soloSessionSchema,
  })
  .register(contractRegistry, { id: 'SoloGuessResponse' });
export type SoloGuessResponse = z.infer<typeof soloGuessResponseSchema>;

export const soloSummarySchema = z
  .object({
    match: matchIdentitySchema,
    found: foundPlayersSchema,
    missedCount: squadCountSchema,
    // Pro gets the list, free gets null
    missed: foundPlayersSchema.nullable(),
    livesRemaining: livesSchema,
    endReason: soloEndReasonSchema,
    accuracy: ratioSchema,
    bestStreak: squadCountSchema,
    roundTimesMs: z.array(z.number().int().nonnegative()),
  })
  .register(contractRegistry, { id: 'SoloSummary' });
export type SoloSummary = z.infer<typeof soloSummarySchema>;
