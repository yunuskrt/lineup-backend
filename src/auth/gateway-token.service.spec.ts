import { Logger } from '@nestjs/common';
import type { AuthService } from '@thallesp/nestjs-better-auth';
import { APIError } from 'better-auth/api';
import { expiryOf, GatewayTokenService } from '@/auth/gateway-token.service.js';
import type { Auth } from '@/auth/auth.factory.js';

// An unsigned token with the given claims
const tokenWith = (claims: object) =>
  [
    Buffer.from('{"alg":"EdDSA"}').toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'signature',
  ].join('.');

describe('expiryOf', () => {
  it('turns exp seconds into epoch ms', () => {
    expect(expiryOf(tokenWith({ sub: 'u-1', exp: 1_800_000_000 }))).toBe(
      1_800_000_000_000,
    );
  });

  it.each([
    ['no exp', tokenWith({ sub: 'u-1' })],
    ['a string exp', tokenWith({ exp: 'soon' })],
    ['a non-object body', tokenWith([1, 2])],
    ['a null body', tokenWith(null as unknown as object)],
  ])('throws on %s', (_, token) => {
    expect(() => expiryOf(token)).toThrow('Token has no expiry');
  });

  it('throws on a token that is not a JWT', () => {
    expect(() => expiryOf('not-a-jwt')).toThrow();
  });
});

describe('GatewayTokenService', () => {
  const api = { getToken: vi.fn(), verifyJWT: vi.fn() };
  const service = new GatewayTokenService({
    api,
  } as unknown as AuthService<Auth>);
  const headers = new Headers({ cookie: 'lineup.session_token=t' });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('issue', () => {
    it('signs a token for the session and reports its expiry', async () => {
      const token = tokenWith({ sub: 'u-1', exp: 1_800_000_300 });
      api.getToken.mockResolvedValue({ token });

      expect(await service.issue(headers)).toEqual({
        token,
        expiresAt: 1_800_000_300_000,
      });
      expect(api.getToken).toHaveBeenCalledWith({ headers });
    });

    it('maps a Better Auth refusal to the contract', async () => {
      api.getToken.mockRejectedValue(
        APIError.from('UNAUTHORIZED', { code: 'UNAUTHORIZED', message: 'x' }),
      );
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.issue(headers)).rejects.toMatchObject({
        error: { code: 'server_error' },
      });
    });
  });

  describe('verify', () => {
    it('returns the user id from a valid token', async () => {
      api.verifyJWT.mockResolvedValue({ payload: { sub: 'u-1', aud: 'a' } });

      expect(await service.verify('t')).toEqual({ userId: 'u-1' });
      expect(api.verifyJWT).toHaveBeenCalledWith({ body: { token: 't' } });
    });

    it.each([
      ['a refused token', { payload: null }],
      ['a payload with no subject', { payload: { aud: 'a' } }],
      ['an empty subject', { payload: { sub: '' } }],
      ['a non-string subject', { payload: { sub: 42 } }],
    ])('returns null for %s', async (_, result) => {
      api.verifyJWT.mockResolvedValue(result);
      expect(await service.verify('t')).toBeNull();
    });

    it('returns null instead of throwing', async () => {
      api.verifyJWT.mockRejectedValue(new Error('jwks unavailable'));
      expect(await service.verify('t')).toBeNull();
    });
  });
});
