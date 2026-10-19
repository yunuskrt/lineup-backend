import { Logger } from '@nestjs/common';
import { NO_SESSION } from '@/auth/auth-flow.service.js';
import type { GatewayTokenService } from '@/auth/gateway-token.service.js';
import { ApiException } from '@/common/api-exception.js';
import { PROTOCOL_VERSION } from '@/contract/protocol.js';
import { OUT_OF_DATE, SocketAuthService } from '@/duel/socket-auth.service.js';
import type { PrismaService } from '@/prisma/prisma.service.js';

const TOKEN = 'eyJhbGciOiJFZERTQSJ9.secret-claims.signature';
const ROW = {
  id: 'u-1',
  handle: 'guest-4821',
  isAnonymous: true,
  emailVerified: false,
};

describe('SocketAuthService', () => {
  const verify = vi.fn();
  const findUnique = vi.fn();
  const service = new SocketAuthService(
    { verify } as unknown as GatewayTokenService,
    { user: { findUnique } } as unknown as PrismaService,
  );
  const handshake = (extra: object = {}) => ({
    token: TOKEN,
    protocolVersion: PROTOCOL_VERSION,
    ...extra,
  });

  async function refusalOf(auth: unknown) {
    const error: unknown = await service
      .authenticate(auth)
      .catch((thrown: unknown) => thrown);
    if (!(error instanceof ApiException)) throw new Error('Expected refusal');
    return error.error;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    verify.mockResolvedValue({ userId: 'u-1' });
    findUnique.mockResolvedValue(ROW);
  });

  it('admits a current client as the fresh user row', async () => {
    await expect(service.authenticate(handshake())).resolves.toEqual({
      id: 'u-1',
      handle: 'guest-4821',
      isGuest: true,
      emailVerified: false,
      tier: 'free',
    });
    expect(verify).toHaveBeenCalledWith(TOKEN);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u-1' } }),
    );
  });

  it('takes the tier from the server, never the handshake', async () => {
    const user = await service.authenticate(
      handshake({ tier: 'pro', userId: 'u-2', isGuest: false }),
    );
    expect(user).toMatchObject({ id: 'u-1', tier: 'free', isGuest: true });
  });

  it.each([
    ['an old version', handshake({ protocolVersion: PROTOCOL_VERSION - 1 })],
    ['no version', { token: TOKEN }],
    ['a string version', handshake({ protocolVersion: '1' })],
    ['no handshake at all', undefined],
    ['a null handshake', null],
  ])('refuses %s before reading the token', async (_, auth) => {
    expect(await refusalOf(auth)).toEqual({
      code: 'protocol_refused',
      message: OUT_OF_DATE,
      retryAfterMs: null,
    });
    expect(verify).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('warns about a version newer than ours', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    await refusalOf(handshake({ protocolVersion: PROTOCOL_VERSION + 1 }));
    expect(warn).toHaveBeenCalledWith(
      `Refused protocol ${PROTOCOL_VERSION + 1}, newer than ours`,
    );
    warn.mockRestore();
  });

  it.each([
    ['no token', { protocolVersion: PROTOCOL_VERSION }],
    ['an empty token', handshake({ token: '' })],
    ['a non-string token', handshake({ token: 42 })],
  ])('refuses %s without verifying it', async (_, auth) => {
    expect((await refusalOf(auth)).code).toBe('unauthorized');
    expect(verify).not.toHaveBeenCalled();
  });

  it('refuses a token that does not verify', async () => {
    verify.mockResolvedValue(null);
    expect(await refusalOf(handshake())).toEqual({
      code: 'unauthorized',
      message: NO_SESSION,
      retryAfterMs: null,
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('refuses a token whose user was deleted', async () => {
    findUnique.mockResolvedValue(null);
    expect((await refusalOf(handshake())).code).toBe('unauthorized');
  });

  it('never echoes the token in a refusal', async () => {
    verify.mockResolvedValue(null);
    const refusal = JSON.stringify(await refusalOf(handshake()));
    expect(refusal).not.toContain('secret-claims');
  });

  it('lets a database failure through, for a server_error', async () => {
    findUnique.mockRejectedValue(new Error('connection reset'));
    await expect(service.authenticate(handshake())).rejects.toThrow(
      'connection reset',
    );
  });
});
