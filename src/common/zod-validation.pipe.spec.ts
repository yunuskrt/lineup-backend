import { z } from 'zod';
import { ApiException } from '@/common/api-exception.js';
import { ZodValidationPipe } from '@/common/zod-validation.pipe.js';

function rejection(pipe: ZodValidationPipe<z.ZodType>, value: unknown) {
  try {
    pipe.transform(value);
  } catch (error) {
    if (error instanceof ApiException) return error.error;
  }
  throw new Error('expected an ApiException');
}

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(
    z.object({
      limit: z.coerce.number().int().min(1),
      filters: z.object({
        era: z.object({ from: z.number(), to: z.number() }),
      }),
    }),
  );

  it('returns the parsed, coerced value', () => {
    const value = { limit: '5', filters: { era: { from: 2000, to: 2001 } } };
    expect(pipe.transform(value)).toEqual({
      limit: 5,
      filters: { era: { from: 2000, to: 2001 } },
    });
  });

  it('names each failing field once, with nested paths', () => {
    const error = rejection(pipe, {
      limit: '0',
      filters: { era: { from: 'x', to: 'y' } },
    });
    expect(error).toEqual({
      code: 'invalid_input',
      message: 'Check these fields: limit, filters.era.from, filters.era.to.',
      retryAfterMs: null,
    });
  });

  it('never echoes the submitted values', () => {
    const error = rejection(pipe, {
      limit: 'drop-table',
      filters: { era: { from: 'hunter2', to: 1 } },
    });
    expect(error.message).not.toContain('drop-table');
    expect(error.message).not.toContain('hunter2');
  });

  it('falls back to a generic message when the whole value is wrong', () => {
    expect(rejection(pipe, 'not an object').message).toBe(
      'The request was not valid.',
    );
  });
});
