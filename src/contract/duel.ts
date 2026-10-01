import { z } from 'zod';
import {
  epochMsSchema,
  guessTextSchema,
  idSchema,
  livesSchema,
} from '@/contract/common.js';
import { SQUAD_SIZE } from '@/contract/constants.js';
import { apiErrorSchema } from '@/contract/envelope.js';
import {
  filtersSchema,
  matchIdentitySchema,
  matchInPlaySchema,
} from '@/contract/match.js';
import { duelActorSchema, duelFoundPlayerSchema } from '@/contract/player.js';
import { contractRegistry } from '@/contract/registry.js';
import { guessResultSchema, roundTimingSchema } from '@/contract/round.js';

export const duelOutcomeSchema = z
  .enum(['win', 'loss', 'draw', 'forfeit_win'])
  .register(contractRegistry, { id: 'DuelOutcome' });
export type DuelOutcome = z.infer<typeof duelOutcomeSchema>;

export const duelPhaseSchema = z
  .enum(['queued', 'paired', 'filters', 'match_ready', 'playing', 'finished'])
  .register(contractRegistry, { id: 'DuelPhase' });
export type DuelPhase = z.infer<typeof duelPhaseSchema>;

export const connectionStatusSchema = z
  .enum(['connected', 'reconnecting', 'forfeited'])
  .register(contractRegistry, { id: 'ConnectionStatus' });
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const filterSubmissionStatusSchema = z
  .enum(['pending', 'submitted'])
  .register(contractRegistry, { id: 'FilterSubmissionStatus' });
export type FilterSubmissionStatus = z.infer<
  typeof filterSubmissionStatusSchema
>;

export const duelPlayerSchema = z
  .object({
    id: idSchema,
    handle: z.string().min(1),
    lives: livesSchema,
  })
  .register(contractRegistry, { id: 'DuelPlayer' });
export type DuelPlayer = z.infer<typeof duelPlayerSchema>;

export const queueStateSchema = z
  .object({
    phase: z.literal('queued'),
    since: epochMsSchema,
  })
  .register(contractRegistry, { id: 'QueueState' });
export type QueueState = z.infer<typeof queueStateSchema>;

export const queueTimeoutSchema = z
  .object({
    phase: z.literal('queued'),
    waitedMs: z.number().int().nonnegative(),
  })
  .register(contractRegistry, { id: 'QueueTimeout' });
export type QueueTimeout = z.infer<typeof queueTimeoutSchema>;

export const pairedStateSchema = z
  .object({
    phase: z.literal('paired'),
    opponent: duelPlayerSchema,
  })
  .register(contractRegistry, { id: 'PairedState' });
export type PairedState = z.infer<typeof pairedStateSchema>;

export const filterSubmissionSchema = z
  .object({
    yours: filterSubmissionStatusSchema,
    theirs: filterSubmissionStatusSchema,
  })
  .register(contractRegistry, { id: 'FilterSubmission' });
export type FilterSubmission = z.infer<typeof filterSubmissionSchema>;

export const coinFlipResultSchema = z
  .object({
    winner: duelActorSchema,
    // Applied whole, never merged
    filters: filtersSchema,
  })
  .register(contractRegistry, { id: 'CoinFlipResult' });
export type CoinFlipResult = z.infer<typeof coinFlipResultSchema>;

const sharedFoundSchema = z.array(duelFoundPlayerSchema).max(SQUAD_SIZE);

export const duelSessionSchema = z
  .object({
    sessionId: idSchema,
    match: matchInPlaySchema,
    you: duelPlayerSchema,
    opponent: duelPlayerSchema,
    turn: duelActorSchema,
    round: roundTimingSchema,
    found: sharedFoundSchema,
  })
  .register(contractRegistry, { id: 'DuelSession' });
export type DuelSession = z.infer<typeof duelSessionSchema>;

export const duelLifeLostSchema = z
  .object({
    who: duelActorSchema,
    lives: livesSchema,
  })
  .register(contractRegistry, { id: 'DuelLifeLost' });
export type DuelLifeLost = z.infer<typeof duelLifeLostSchema>;

export const connectionStateSchema = z
  .object({
    status: connectionStatusSchema,
    reconnectDeadline: epochMsSchema.nullable(),
  })
  .register(contractRegistry, { id: 'ConnectionState' });
export type ConnectionState = z.infer<typeof connectionStateSchema>;

export const duelResultSchema = z
  .object({
    outcome: duelOutcomeSchema,
    match: matchIdentitySchema,
    found: sharedFoundSchema,
    you: duelPlayerSchema,
    opponent: duelPlayerSchema,
    isForfeit: z.boolean(),
  })
  .register(contractRegistry, { id: 'DuelResult' });
export type DuelResult = z.infer<typeof duelResultSchema>;

export const duelGuessRequestSchema = z
  .object({
    sessionId: idSchema,
    guess: guessTextSchema,
  })
  .register(contractRegistry, { id: 'DuelGuessRequest' });
export type DuelGuessRequest = z.infer<typeof duelGuessRequestSchema>;

// Event names are provisional until B39
export const duelCommandSchemas = {
  'queue:enter': z.undefined(),
  'queue:leave': z.undefined(),
  'filters:submit': filtersSchema,
  'duel:guess': duelGuessRequestSchema,
  'duel:forfeit': z.undefined(),
} as const;
export type DuelCommand = keyof typeof duelCommandSchemas;

export const duelEventSchemas = {
  queued: queueStateSchema,
  queueTimedOut: queueTimeoutSchema,
  paired: pairedStateSchema,
  filtersUpdated: filterSubmissionSchema,
  coinFlip: coinFlipResultSchema,
  matchReady: duelSessionSchema,
  roundStarted: duelSessionSchema,
  guessResolved: guessResultSchema,
  playerRevealed: duelFoundPlayerSchema,
  lifeLost: duelLifeLostSchema,
  turnChanged: duelSessionSchema,
  opponentConnection: connectionStateSchema,
  finished: duelResultSchema,
  disconnected: connectionStateSchema,
  error: apiErrorSchema,
} as const;
export type DuelEventMap = {
  [E in keyof typeof duelEventSchemas]: z.infer<(typeof duelEventSchemas)[E]>;
};
