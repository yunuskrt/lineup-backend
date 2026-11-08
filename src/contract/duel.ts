import { z } from 'zod';
import {
  epochMsSchema,
  guessTextSchema,
  idSchema,
  livesSchema,
} from '@/contract/common.js';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SQUAD_SIZE,
} from '@/contract/constants.js';
import { type ApiErrorCode, apiErrorSchema } from '@/contract/envelope.js';
import {
  filtersSchema,
  matchIdentitySchema,
  matchInPlaySchema,
} from '@/contract/match.js';
import {
  duelActorSchema,
  duelFoundPlayerSchema,
  duelNamedPlayerSchema,
} from '@/contract/player.js';
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

// room: the creator's set, no toss (R6)
export const coinFlipSourceSchema = z
  .enum(['coin', 'room'])
  .register(contractRegistry, { id: 'CoinFlipSource' });
export type CoinFlipSource = z.infer<typeof coinFlipSourceSchema>;

export const coinFlipResultSchema = z
  .object({
    winner: duelActorSchema,
    // Applied whole, never merged
    filters: filtersSchema,
    source: coinFlipSourceSchema,
  })
  .register(contractRegistry, { id: 'CoinFlipResult' });
export type CoinFlipResult = z.infer<typeof coinFlipResultSchema>;

// Any case in, uppercase out
export const roomCodeSchema = z
  .string()
  .toUpperCase()
  .regex(
    new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`),
    'A 6-character room code',
  );

export const roomStateSchema = z
  .object({
    code: roomCodeSchema,
    // As applied when the friend joins
    filters: filtersSchema,
    expiresAt: epochMsSchema,
  })
  .register(contractRegistry, { id: 'RoomState' });
export type RoomState = z.infer<typeof roomStateSchema>;

export const roomExpirySchema = z
  .object({ code: roomCodeSchema })
  .register(contractRegistry, { id: 'RoomExpiry' });
export type RoomExpiry = z.infer<typeof roomExpirySchema>;

export const roomJoinRequestSchema = z
  .object({ code: roomCodeSchema })
  .register(contractRegistry, { id: 'RoomJoinRequest' });
export type RoomJoinRequest = z.infer<typeof roomJoinRequestSchema>;

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
    // In the order named
    found: z.array(duelNamedPlayerSchema).max(SQUAD_SIZE),
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

// Final since B39: W30's client speaks these
export const duelCommandSchemas = {
  'queue:enter': z.undefined(),
  'queue:leave': z.undefined(),
  'filters:submit': filtersSchema,
  'duel:guess': duelGuessRequestSchema,
  'duel:forfeit': z.undefined(),
  'room:create': filtersSchema,
  'room:join': roomJoinRequestSchema,
  'room:leave': z.undefined(),
} as const;
export type DuelCommand = keyof typeof duelCommandSchemas;

type ServerErrorCode = Exclude<ApiErrorCode, 'network'>;

// What each command's ack may carry
export const DUEL_COMMAND_REFUSALS = {
  'queue:enter': ['forbidden', 'invalid_input', 'rate_limited', 'server_error'],
  'queue:leave': ['forbidden', 'invalid_input', 'rate_limited', 'server_error'],
  'filters:submit': [
    'forbidden',
    'invalid_input',
    'empty_pool',
    'rate_limited',
    'server_error',
  ],
  'duel:guess': [
    'invalid_input',
    'session_over',
    'forbidden',
    'rate_limited',
    'server_error',
  ],
  'duel:forfeit': [
    'forbidden',
    'invalid_input',
    'rate_limited',
    'server_error',
  ],
  'room:create': [
    'forbidden',
    'invalid_input',
    'empty_pool',
    'rate_limited',
    'server_error',
  ],
  'room:join': [
    'not_found',
    'forbidden',
    'invalid_input',
    'rate_limited',
    'server_error',
  ],
  'room:leave': ['forbidden', 'invalid_input', 'rate_limited', 'server_error'],
} as const satisfies Record<DuelCommand, readonly ServerErrorCode[]>;

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
  roomCreated: roomStateSchema,
  roomExpired: roomExpirySchema,
  error: apiErrorSchema,
} as const;
export type DuelEventMap = {
  [E in keyof typeof duelEventSchemas]: z.infer<(typeof duelEventSchemas)[E]>;
};
