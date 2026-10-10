import type { NextFunction, Request, Response } from 'express';
import {
  isRefused,
  ORIGIN_REFUSED,
  OriginCheckMiddleware,
  type WriteRequest,
} from '@/common/origin-check.middleware.js';
import { ApiException } from '@/common/api-exception.js';
import type { Env } from '@/config/env.schema.js';

const WEB = 'https://app.lineup.gg';
const API = 'https://api.lineup.gg';
const TRUSTED = [WEB, API];
const COOKIE = 'lineup.session_token=t';

describe('isRefused', () => {
  const post = (extra: Partial<WriteRequest> = {}): WriteRequest => ({
    method: 'POST',
    ...extra,
  });

  it.each(['GET', 'HEAD', 'OPTIONS', 'get'])('never refuses a %s', (method) => {
    expect(isRefused({ method, origin: 'https://evil.example' }, TRUSTED)).toBe(
      false,
    );
  });

  // Lax cookies never ride a cross-site POST
  it('refuses a write from an untrusted origin, cookie or not', () => {
    expect(isRefused(post({ origin: 'https://evil.example' }), TRUSTED)).toBe(
      true,
    );
  });

  it.each([WEB, API])('lets a write from %s through', (origin) => {
    expect(isRefused(post({ origin }), TRUSTED)).toBe(false);
  });

  it('lets a write with no Origin or Referer through', () => {
    expect(isRefused(post(), TRUSTED)).toBe(false);
  });

  it('falls back to the Referer when Origin is missing', () => {
    expect(
      isRefused(post({ referer: 'https://evil.example/page?x=1' }), TRUSTED),
    ).toBe(true);
    expect(isRefused(post({ referer: `${WEB}/play/solo` }), TRUSTED)).toBe(
      false,
    );
  });

  it('prefers Origin over Referer', () => {
    expect(
      isRefused(
        post({ origin: WEB, referer: 'https://evil.example/' }),
        TRUSTED,
      ),
    ).toBe(false);
  });

  it.each([
    ['the null origin', { origin: 'null' }],
    ['an unparseable Referer', { referer: 'not a url' }],
    ['a lookalike host', { origin: 'https://app.lineup.gg.evil.example' }],
    ['another scheme', { origin: 'http://app.lineup.gg' }],
    ['another port', { origin: 'https://app.lineup.gg:8443' }],
  ])('refuses %s', (_, extra) => {
    expect(isRefused(post(extra), TRUSTED)).toBe(true);
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('checks a %s too', (method) => {
    expect(
      isRefused(post({ method, origin: 'https://evil.example' }), TRUSTED),
    ).toBe(true);
  });
});

describe('OriginCheckMiddleware', () => {
  const env = {
    WEB_APP_URL: WEB,
    BETTER_AUTH_URL: `${API}/`,
  } as Env;
  const middleware = new OriginCheckMiddleware(env);
  const run = (headers: Record<string, string>, method = 'POST') => {
    const next = vi.fn();
    const req = { method, headers } as unknown as Request;
    middleware.use(req, {} as Response, next as unknown as NextFunction);
    return next;
  };

  it('throws a forbidden envelope for a refused write', () => {
    const error = (() => {
      try {
        run({ cookie: COOKIE, origin: 'https://evil.example' });
      } catch (e: unknown) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ApiException);
    expect(error).toMatchObject({
      status: 403,
      error: { code: 'forbidden', message: ORIGIN_REFUSED },
    });
  });

  it('calls next for a trusted write', () => {
    expect(run({ cookie: COOKIE, origin: WEB })).toHaveBeenCalledOnce();
  });

  it("trusts the API's own origin, from BETTER_AUTH_URL", () => {
    expect(run({ cookie: COOKIE, origin: API })).toHaveBeenCalledOnce();
  });
});
