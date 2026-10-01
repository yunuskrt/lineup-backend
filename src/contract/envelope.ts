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

export const apiErrorSchema = z
  .object({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
    retryAfterMs: z.number().int().nonnegative().nullable(),
    emptyBecause: emptyPoolReasonSchema.optional(),
  })
  .refine(
    (error) =>
      (error.code === 'rate_limited') === (error.retryAfterMs !== null),
    {
      error: 'retryAfterMs is set only with rate_limited',
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
