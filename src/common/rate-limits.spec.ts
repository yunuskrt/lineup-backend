import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthController } from '@/auth/auth.controller.js';
import { GatewayTokenController } from '@/auth/gateway-token.controller.js';
import { CatalogController } from '@/catalog/catalog.controller.js';
import {
  ACCOUNT_LIMIT,
  accountTracker,
  RATE_LIMITS,
  THROTTLER_OPTIONS,
} from '@/common/rate-limits.js';
import { SoloController } from '@/solo/solo.controller.js';

// The throttler's own metadata keys
const LIMIT = 'THROTTLER:LIMITdefault';
const TTL = 'THROTTLER:TTLdefault';

const reflector = new Reflector();

type Handler = (...args: never[]) => unknown;

// A route method, read without binding it
function handlerOf(controller: { prototype: object }, name: string): Handler {
  const handler: unknown = Reflect.get(controller.prototype, name);
  if (typeof handler !== 'function') throw new Error(`No route ${name}`);
  return handler as Handler;
}

const limitOn = (handler: Handler) => ({
  limit: reflector.get<number | undefined>(LIMIT, handler),
  ttl: reflector.get<number | undefined>(TTL, handler),
});

const { throttlers } = THROTTLER_OPTIONS as {
  throttlers: { name: string; skipIf?: (c: ExecutionContext) => boolean }[];
};
const account = throttlers.find((throttler) => throttler.name === 'account');
const contextOf = (handler: Handler) =>
  ({ getHandler: () => handler }) as unknown as ExecutionContext;

describe('RATE_LIMITS', () => {
  it('has a positive whole limit and a window of a second or more', () => {
    for (const { limit, ttl } of [
      ...Object.values(RATE_LIMITS),
      ACCOUNT_LIMIT,
    ]) {
      expect(Number.isInteger(limit) && limit > 0).toBe(true);
      expect(ttl).toBeGreaterThanOrEqual(1_000);
    }
  });

  it('allows guesses at the web mock rate: 12 per 3 s', () => {
    expect(RATE_LIMITS.guess).toEqual({ limit: 12, ttl: 3_000 });
  });

  it.each([
    ['sign-in', handlerOf(AuthController, 'signIn'), RATE_LIMITS.signIn],
    ['sign-up', handlerOf(AuthController, 'signUp'), RATE_LIMITS.signUp],
    ['guest', handlerOf(AuthController, 'guest'), RATE_LIMITS.guest],
    ['upgrade', handlerOf(AuthController, 'upgrade'), RATE_LIMITS.upgrade],
    ['token', handlerOf(GatewayTokenController, 'token'), RATE_LIMITS.token],
    ['start', handlerOf(SoloController, 'start'), RATE_LIMITS.start],
    ['guess', handlerOf(SoloController, 'guess'), RATE_LIMITS.guess],
    [
      'filter options',
      handlerOf(CatalogController, 'filterOptions'),
      RATE_LIMITS.catalog,
    ],
  ])('puts its own limit on %s', (_, handler, expected) => {
    expect(limitOn(handler)).toEqual(expected);
  });

  it.each([
    ['session', handlerOf(AuthController, 'session')],
    ['sign-out', handlerOf(AuthController, 'signOut')],
    ['sync', handlerOf(SoloController, 'sync')],
  ])('leaves %s on the default limit', (_, handler) => {
    expect(limitOn(handler)).toEqual({ limit: undefined, ttl: undefined });
  });
});

describe('the per-account limit', () => {
  it('runs on sign-in only', () => {
    const skipIf = account?.skipIf;
    if (!skipIf) throw new Error('The account throttler needs a skipIf');
    expect(skipIf(contextOf(handlerOf(AuthController, 'signIn')))).toBe(false);
    expect(skipIf(contextOf(handlerOf(AuthController, 'signUp')))).toBe(true);
    expect(skipIf(contextOf(handlerOf(SoloController, 'guess')))).toBe(true);
  });

  it('keys on the email, trimmed and lowercased', () => {
    const req = { ip: '203.0.113.7', body: { email: '  Ada@Example.COM ' } };
    expect(accountTracker(req)).toBe('email:ada@example.com');
  });

  it.each([
    ['no body', {}],
    ['no email', { body: {} }],
    ['a blank email', { body: { email: '   ' } }],
    ['a non-string email', { body: { email: ['a@b.c'] } }],
  ])('falls back to the IP with %s', (_, extra) => {
    expect(accountTracker({ ip: '203.0.113.7', ...extra })).toBe(
      'ip:203.0.113.7',
    );
  });

  it('leaves the response headers to the guard', () => {
    expect(THROTTLER_OPTIONS).toMatchObject({ setHeaders: false });
  });
});
