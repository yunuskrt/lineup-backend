import type { ExecutionContext } from '@nestjs/common';
import {
  type ThrottlerStorage,
  ThrottlerStorageService,
} from '@nestjs/throttler';
import { ApiException } from '@/common/api-exception.js';
import { lockoutMessage } from '@/common/rate-limit.guard.js';
import { SOCKET_LIMITS } from '@/common/rate-limits.js';
import type { Env } from '@/config/env.schema.js';
import {
  SocketRateLimitGuard,
  socketKey,
} from '@/duel/socket-rate-limit.guard.js';

// A ws context: the command, then the socket's user
function wsContext(command: string, userId: string, type = 'ws') {
  const client = { id: `socket-${userId}`, data: { user: { id: userId } } };
  return {
    getType: () => type,
    switchToWs: () => ({
      getPattern: () => command,
      getClient: () => client,
      getData: () => ({ userId: 'spoofed', guess: 'zulu' }),
    }),
  } as unknown as ExecutionContext;
}

function guardWith(isEnabled = true, storage?: ThrottlerStorage) {
  const store = storage ?? new ThrottlerStorageService();
  const env = { RATE_LIMITS_ENABLED: isEnabled } as Env;
  return { guard: new SocketRateLimitGuard(store, env), store };
}

async function refusal(promise: Promise<boolean>) {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof ApiException) return error.error;
    throw error;
  }
}

async function spend(
  guard: SocketRateLimitGuard,
  command: string,
  userId: string,
  times: number,
) {
  for (let i = 0; i < times; i += 1) {
    await expect(guard.canActivate(wsContext(command, userId))).resolves.toBe(
      true,
    );
  }
}

describe('SocketRateLimitGuard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keys on the command and the handshake user only', async () => {
    const increment = vi.fn(() =>
      Promise.resolve({
        totalHits: 1,
        timeToExpire: 3,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
    );
    const { guard } = guardWith(true, { increment });
    await guard.canActivate(wsContext('duel:guess', 'u-1'));

    expect(increment).toHaveBeenCalledWith(
      'socket:duel:guess:user:u-1',
      3_000,
      12,
      3_000,
      'socket',
    );
    expect(socketKey('duel:guess', 'u-1')).toBe('socket:duel:guess:user:u-1');
  });

  it('refuses the guess over the limit, naming the wait', async () => {
    const { guard } = guardWith();
    await spend(guard, 'duel:guess', 'u-1', 12);

    const error = await refusal(
      guard.canActivate(wsContext('duel:guess', 'u-1')),
    );
    expect(error).toEqual({
      code: 'rate_limited',
      message: lockoutMessage(3_000),
      retryAfterMs: 3_000,
    });
    expect(error?.message).not.toMatch(/zulu|guess|duel/);
  });

  it('lets the user back in once the window is over', async () => {
    const { guard } = guardWith();
    await spend(guard, 'duel:guess', 'u-1', 12);
    await refusal(guard.canActivate(wsContext('duel:guess', 'u-1')));

    vi.advanceTimersByTime(3_000);
    await expect(
      guard.canActivate(wsContext('duel:guess', 'u-1')),
    ).resolves.toBe(true);
  });

  it('gives a command without its own limit the default', async () => {
    const { guard } = guardWith();
    await spend(guard, 'duel:forfeit', 'u-1', SOCKET_LIMITS.default.limit);
    expect(
      await refusal(guard.canActivate(wsContext('duel:forfeit', 'u-1'))),
    ).toMatchObject({ code: 'rate_limited' });
  });

  it('keeps a count per user and per command', async () => {
    const { guard } = guardWith();
    await spend(guard, 'queue:enter', 'u-1', 10);
    expect(
      await refusal(guard.canActivate(wsContext('queue:enter', 'u-1'))),
    ).toMatchObject({ code: 'rate_limited' });

    await spend(guard, 'queue:enter', 'u-2', 10);
    await spend(guard, 'queue:leave', 'u-1', 1);
  });

  it('never reads a count off the socket id or the payload', async () => {
    const { guard } = guardWith();
    await spend(guard, 'filters:submit', 'u-1', 10);
    // A new socket, same user: still the same count
    const fresh = wsContext('filters:submit', 'u-1');
    (fresh.switchToWs().getClient() as { id: string }).id = 'socket-new';
    expect(await refusal(guard.canActivate(fresh))).toMatchObject({
      code: 'rate_limited',
    });
  });

  it('never reports a negative wait', async () => {
    const increment = () =>
      Promise.resolve({
        totalHits: 13,
        timeToExpire: 0,
        isBlocked: true,
        timeToBlockExpire: -1,
      });
    const { guard } = guardWith(true, { increment });
    expect(
      await refusal(guard.canActivate(wsContext('duel:guess', 'u-1'))),
    ).toMatchObject({ code: 'rate_limited', retryAfterMs: 0 });
  });

  it.each([
    ['an http context', true, 'http'],
    ['limits switched off', false, 'ws'],
  ])('skips %s', async (_, isEnabled, type) => {
    const increment = vi.fn();
    const { guard } = guardWith(isEnabled, { increment });
    await expect(
      guard.canActivate(wsContext('duel:guess', 'u-1', type)),
    ).resolves.toBe(true);
    expect(increment).not.toHaveBeenCalled();
  });
});
