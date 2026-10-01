import { z } from 'zod';
import {
  apiErrorSchema,
  emptyResultSchema,
  resultSchema,
} from '@/contract/envelope.js';

const error = (overrides: object) => ({
  code: 'not_found',
  message: 'Session not found',
  retryAfterMs: null,
  ...overrides,
});

describe('apiErrorSchema', () => {
  it('accepts a plain error', () => {
    expect(apiErrorSchema.safeParse(error({})).success).toBe(true);
  });

  it('requires retryAfterMs with rate_limited, and only then', () => {
    const limited = error({ code: 'rate_limited', retryAfterMs: 1_200 });
    expect(apiErrorSchema.safeParse(limited).success).toBe(true);
    expect(
      apiErrorSchema.safeParse({ ...limited, retryAfterMs: null }).success,
    ).toBe(false);
    expect(apiErrorSchema.safeParse(error({ retryAfterMs: 500 })).success).toBe(
      false,
    );
  });

  it('requires emptyBecause with empty_pool, and only then', () => {
    const empty = error({ code: 'empty_pool', emptyBecause: 'era' });
    expect(apiErrorSchema.safeParse(empty).success).toBe(true);
    expect(
      apiErrorSchema.safeParse(error({ code: 'empty_pool' })).success,
    ).toBe(false);
    expect(
      apiErrorSchema.safeParse(error({ emptyBecause: 'club' })).success,
    ).toBe(false);
  });

  it('rejects an empty message and an unknown code', () => {
    expect(apiErrorSchema.safeParse(error({ message: '' })).success).toBe(
      false,
    );
    expect(apiErrorSchema.safeParse(error({ code: 'teapot' })).success).toBe(
      false,
    );
  });
});

describe('resultSchema', () => {
  const numberResult = resultSchema(z.number());

  it('accepts success with data and failure with an error', () => {
    expect(numberResult.safeParse({ success: true, data: 7 }).success).toBe(
      true,
    );
    expect(
      numberResult.safeParse({ success: false, error: error({}) }).success,
    ).toBe(true);
  });

  it('rejects a success that carries an error instead of data', () => {
    expect(
      numberResult.safeParse({ success: true, error: error({}) }).success,
    ).toBe(false);
  });

  it('represents an empty result as null data', () => {
    expect(
      emptyResultSchema.safeParse({ success: true, data: null }).success,
    ).toBe(true);
    expect(emptyResultSchema.safeParse({ success: true }).success).toBe(false);
  });
});
