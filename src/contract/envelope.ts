import { z } from 'zod';
import { contractRegistry } from '@/contract/registry.js';

export const apiErrorCodeSchema = z
  .enum([
    'unauthorized',
    'forbidden',
    'not_found',
    'invalid_input',
    'empty_pool',
    'rate_limited',
    'session_over',
    // Client-only; the server never sends it
    'network',
    'server_error',
    'protocol_refused',
  ])
  .register(contractRegistry, { id: 'ApiErrorCode' });
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const emptyPoolReasonSchema = z
  .enum(['competition', 'club', 'era', 'combination'])
  .register(contractRegistry, { id: 'EmptyPoolReason' });
export type EmptyPoolReason = z.infer<typeof emptyPoolReasonSchema>;

// R9: why a forbidden call was refused
export const forbiddenReasonSchema = z
  .enum(['pro_required', 'daily_cap'])
  .register(contractRegistry, { id: 'ForbiddenReason' });
export type ForbiddenReason = z.infer<typeof forbiddenReasonSchema>;

export const apiErrorSchema = z
  .object({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
    retryAfterMs: z.number().int().nonnegative().nullable(),
    emptyBecause: emptyPoolReasonSchema.optional(),
    reason: forbiddenReasonSchema.optional(),
  })
  // R11: the cap's refusal waits for midnight
  .refine(
    (error) =>
      (error.code === 'rate_limited' || error.reason === 'daily_cap') ===
      (error.retryAfterMs !== null),
    {
      error: 'retryAfterMs is set only with rate_limited or daily_cap',
      path: ['retryAfterMs'],
    },
  )
  .refine(
    (error) =>
      (error.code === 'empty_pool') === (error.emptyBecause !== undefined),
    {
      error: 'emptyBecause is set only with empty_pool',
      path: ['emptyBecause'],
    },
  )
  // Optional with forbidden; never without it
  .refine((error) => error.reason === undefined || error.code === 'forbidden', {
    error: 'reason is set only with forbidden',
    path: ['reason'],
  })
  .register(contractRegistry, { id: 'ApiError' });
export type ApiError = z.infer<typeof apiErrorSchema>;

export function resultSchema<T extends z.ZodType>(dataSchema: T) {
  return z.discriminatedUnion('success', [
    z.object({ success: z.literal(true), data: dataSchema }),
    z.object({ success: z.literal(false), error: apiErrorSchema }),
  ]);
}

// `data` is null when a call returns nothing
export const emptyResultSchema = resultSchema(z.null()).register(
  contractRegistry,
  { id: 'EmptyResult' },
);
export type EmptyResult = z.infer<typeof emptyResultSchema>;
