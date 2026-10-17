import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerStorageService,
  type ThrottlerLimitDetail,
} from '@nestjs/throttler';
import { ApiException } from '@/common/api-exception.js';
import { lockoutMessage, RateLimitGuard } from '@/common/rate-limit.guard.js';
import { THROTTLER_OPTIONS } from '@/common/rate-limits.js';
import type { Env } from '@/config/env.schema.js';

// Opens the protected hooks for the test
class OpenGuard extends RateLimitGuard {
  tracker(req: Record<string, unknown>) {
    return this.getTracker(req);
  }
  skips(type: string) {
    const context = { getType: () => type } as unknown as ExecutionContext;
    return this.shouldSkip(context);
  }
  refuse(context: ExecutionContext, detail: ThrottlerLimitDetail) {
    return this.throwThrottlingException(context, detail);
  }
}

async function guardWith(isEnabled = true) {
  const env = { RATE_LIMITS_ENABLED: isEnabled } as Env;
  const guard = new OpenGuard(
    THROTTLER_OPTIONS,
    new ThrottlerStorageService(),
    new Reflector(),
    env,
  );
  await guard.onModuleInit();
  return guard;
}

function contextWith(header = vi.fn()) {
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({ header }),
    }),
  } as unknown as ExecutionContext;
  return { context, header };
}

const blocked = (timeToBlockExpire: number): ThrottlerLimitDetail => ({
  ttl: 3_000,
  limit: 12,
  key: 'hashed',
  tracker: 'user:u-1',
  totalHits: 13,
  timeToExpire: 2,
  isBlocked: true,
  timeToBlockExpire,
});

async function refusalOf(promise: Promise<void>) {
  const error: unknown = await promise.catch((thrown: unknown) => thrown);
  if (!(error instanceof ApiException)) throw new Error('Expected a refusal');
  return error;
}

describe('lockoutMessage', () => {
  it.each([
    [0, 'Too many attempts. Try again in 1 second.'],
    [1_000, 'Too many attempts. Try again in 1 second.'],
    [41_800, 'Too many attempts. Try again in 42 seconds.'],
    [59_000, 'Too many attempts. Try again in 59 seconds.'],
    [60_000, 'Too many attempts. Try again in 1 minute.'],
    [125_000, 'Too many attempts. Try again in 3 minutes.'],
    [15 * 60_000, 'Too many attempts. Try again in 15 minutes.'],
  ])('names a wait of %i ms', (ms, message) => {
    expect(lockoutMessage(ms)).toBe(message);
  });
});

describe('RateLimitGuard', () => {
  it("keys a signed-in request on the session's user", async () => {
    const guard = await guardWith();
    const req = { ip: '203.0.113.7', currentUser: { id: 'u-1' } };
    await expect(guard.tracker(req)).resolves.toBe('user:u-1');
  });

  it('keys a request with no user on its IP', async () => {
    const guard = await guardWith();
    await expect(guard.tracker({ ip: '203.0.113.7' })).resolves.toBe(
      'ip:203.0.113.7',
    );
  });

  it('groups an IPv6 client by its /64', async () => {
    const guard = await guardWith();
    const [first, second] = await Promise.all([
      guard.tracker({ ip: '2001:db8:1:2::a' }),
      guard.tracker({ ip: '2001:db8:1:2::b' }),
    ]);
    expect(first).toBe(second);
  });

  it('skips every limit only when switched off', async () => {
    await expect((await guardWith(true)).skips('http')).resolves.toBe(false);
    await expect((await guardWith(false)).skips('http')).resolves.toBe(true);
  });

  it('leaves socket messages to their own limit', async () => {
    await expect((await guardWith(true)).skips('ws')).resolves.toBe(true);
  });

  it('refuses in the envelope, with the wait in ms and a header', async () => {
    const guard = await guardWith();
    const { context, header } = contextWith();
    const error = await refusalOf(guard.refuse(context, blocked(42)));

    expect(error.status).toBe(429);
    expect(error.error).toEqual({
      code: 'rate_limited',
      message: 'Too many attempts. Try again in 42 seconds.',
      retryAfterMs: 42_000,
    });
    expect(header).toHaveBeenCalledWith('Retry-After', 42);
  });

  it('never reports a negative wait', async () => {
    const guard = await guardWith();
    const error = await refusalOf(
      guard.refuse(contextWith().context, blocked(-3)),
    );
    expect(error.error.retryAfterMs).toBe(0);
  });
});
