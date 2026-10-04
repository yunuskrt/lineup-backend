import { Logger } from '@nestjs/common';
import type { AuthService } from '@thallesp/nestjs-better-auth';
import { APIError } from 'better-auth/api';
import {
  ALREADY_REGISTERED,
  asAuthUser,
  AuthFlowService,
  BAD_CREDENTIALS,
  EMAIL_TAKEN,
  fromBetterAuth,
  HANDLE_TAKEN,
  NO_SESSION,
  SIGN_OUT_FIRST,
  toContractUser,
} from '@/auth/auth-flow.service.js';
import type { Auth } from '@/auth/auth.factory.js';
import { ApiException, SERVER_ERROR_MESSAGE } from '@/common/api-exception.js';
import type { Env } from '@/config/env.schema.js';
import type { PrismaService } from '@/prisma/prisma.service.js';

const refused = (
  status: 'BAD_REQUEST' | 'UNAUTHORIZED' | 'UNPROCESSABLE_ENTITY',
  code: string,
) => APIError.from(status, { code, message: `raw ${code} text` });

const logger = new Logger('test');
const SIGN_UP = {
  email: 'fan@lineup.gg',
  password: 'correct-horse',
  handle: 'fan_05',
};
const USER = { id: 'u-1', handle: 'fan_05', email: 'fan@lineup.gg' };
const ENV_STUB = { WEB_APP_URL: 'http://localhost:3000' } as Env;
const CALLBACK = 'http://localhost:3000/profile';

describe('toContractUser', () => {
  it('keeps only the contract fields, resolved by the server', () => {
    expect(toContractUser(USER)).toEqual({
      id: 'u-1',
      handle: 'fan_05',
      isGuest: false,
      emailVerified: false,
      tier: 'free',
    });
  });

  it('reads emailVerified from the stored flag', () => {
    expect(toContractUser({ ...USER, emailVerified: true }).emailVerified).toBe(
      true,
    );
    expect(toContractUser({ ...USER, emailVerified: null }).emailVerified).toBe(
      false,
    );
  });

  it('never marks a guest as verified', () => {
    const guest = { ...USER, isAnonymous: true, emailVerified: true };
    expect(toContractUser(guest).emailVerified).toBe(false);
  });

  it('reads isGuest from the stored anonymous flag only', () => {
    expect(toContractUser({ ...USER, isAnonymous: true }).isGuest).toBe(true);
    expect(toContractUser({ ...USER, isAnonymous: null }).isGuest).toBe(false);
  });
});

describe('asAuthUser', () => {
  it('keeps the fields the contract user needs', () => {
    expect(
      asAuthUser({ id: 'g-1', handle: 'guest-abc12345', isAnonymous: true }),
    ).toEqual({
      id: 'g-1',
      handle: 'guest-abc12345',
      isAnonymous: true,
      emailVerified: false,
    });
  });

  it('refuses a user without a handle', () => {
    expect(() => asAuthUser({ id: 'g-1' })).toThrow();
  });
});

describe('fromBetterAuth', () => {
  const logError = vi.spyOn(logger, 'error');

  beforeEach(() => {
    logError.mockReset().mockImplementation(() => undefined);
  });

  it.each([
    ['USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'UNPROCESSABLE_ENTITY'],
    ['USER_ALREADY_EXISTS', 'UNPROCESSABLE_ENTITY'],
  ] as const)('maps %s to a taken email', (code, status) => {
    expect(fromBetterAuth(refused(status, code), logger)).toMatchObject({
      status: 400,
      error: { code: 'invalid_input', message: EMAIL_TAKEN },
    });
  });

  it('maps bad credentials to unauthorized', () => {
    const mapped = fromBetterAuth(
      refused('UNAUTHORIZED', 'INVALID_EMAIL_OR_PASSWORD'),
      logger,
    );
    expect(mapped).toMatchObject({
      status: 401,
      error: { code: 'unauthorized', message: BAD_CREDENTIALS },
    });
  });

  it('maps any other 400 to a generic invalid input', () => {
    const mapped = fromBetterAuth(
      refused('BAD_REQUEST', 'PASSWORD_TOO_SHORT'),
      logger,
    );
    expect(mapped).toMatchObject({ error: { code: 'invalid_input' } });
    expect(JSON.stringify(mapped)).not.toContain('raw');
  });

  it('turns anything else into server_error, logging the code only', () => {
    const mapped = fromBetterAuth(
      refused('UNPROCESSABLE_ENTITY', 'FAILED_TO_CREATE_USER'),
      logger,
    );
    expect(mapped).toMatchObject({
      status: 500,
      error: { code: 'server_error', message: SERVER_ERROR_MESSAGE },
    });
    expect(logError).toHaveBeenCalledWith(
      'Better Auth refused with FAILED_TO_CREATE_USER',
    );
  });

  it('passes a non-Better Auth error through untouched', () => {
    const crash = new Error('connect ECONNREFUSED');
    expect(fromBetterAuth(crash, logger)).toBe(crash);
  });

  it('logs the status when Better Auth gives no code', () => {
    fromBetterAuth(APIError.fromStatus('INTERNAL_SERVER_ERROR'), logger);
    expect(logError).toHaveBeenCalledWith(
      'Better Auth refused with INTERNAL_SERVER_ERROR',
    );
  });
});

describe('AuthFlowService', () => {
  const api = {
    getSession: vi.fn(),
    signUpEmail: vi.fn(),
    signInEmail: vi.fn(),
    signOut: vi.fn(),
  };
  const queryRaw = vi.fn();
  const service = new AuthFlowService(
    { api } as unknown as AuthService<Auth>,
    { $queryRaw: queryRaw } as unknown as PrismaService,
    ENV_STUB,
  );
  const headers = new Headers({ cookie: 'lineup.session_token=abc' });
  const issued = (user = USER) => ({
    headers: new Headers([
      ['set-cookie', 'lineup.session_token=new; HttpOnly'],
    ]),
    response: { token: 't', user },
  });

  beforeEach(() => {
    vi.resetAllMocks();
    queryRaw.mockResolvedValue([]);
  });

  it('signs up with the handle as the display name and the callback', async () => {
    api.signUpEmail.mockResolvedValue(issued());

    const result = await service.signUp(SIGN_UP, headers);

    expect(api.signUpEmail).toHaveBeenCalledWith({
      body: { ...SIGN_UP, name: 'fan_05', callbackURL: CALLBACK },
      headers,
      returnHeaders: true,
    });
    expect(result).toEqual({
      data: { user: toContractUser(USER) },
      cookies: ['lineup.session_token=new; HttpOnly'],
    });
  });

  it('refuses a taken handle before calling Better Auth', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await expect(service.signUp(SIGN_UP, headers)).rejects.toMatchObject({
      error: { code: 'invalid_input', message: HANDLE_TAKEN },
    });
    expect(api.signUpEmail).not.toHaveBeenCalled();
  });

  it('reports a handle lost to a race as taken', async () => {
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{}]);
    api.signUpEmail.mockRejectedValue(
      refused('UNPROCESSABLE_ENTITY', 'FAILED_TO_CREATE_USER'),
    );

    await expect(service.signUp(SIGN_UP, headers)).rejects.toMatchObject({
      error: { message: HANDLE_TAKEN },
    });
  });

  it('keeps the email error when the handle is still free', async () => {
    api.signUpEmail.mockRejectedValue(
      refused('UNPROCESSABLE_ENTITY', 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'),
    );

    await expect(service.signUp(SIGN_UP, headers)).rejects.toMatchObject({
      error: { code: 'invalid_input', message: EMAIL_TAKEN },
    });
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('signs in and returns the issued cookie', async () => {
    api.signInEmail.mockResolvedValue(issued());
    const body = { email: SIGN_UP.email, password: SIGN_UP.password };

    const result = await service.signIn(body, headers);

    expect(api.signInEmail).toHaveBeenCalledWith({
      body,
      headers,
      returnHeaders: true,
    });
    expect(result).toEqual({
      data: { user: toContractUser(USER) },
      cookies: ['lineup.session_token=new; HttpOnly'],
    });
  });

  it('maps a refused sign-in to an ApiException', async () => {
    api.signInEmail.mockRejectedValue(
      refused('UNAUTHORIZED', 'INVALID_EMAIL_OR_PASSWORD'),
    );

    const error = await service
      .signIn({ email: SIGN_UP.email, password: 'wrong-pass' }, headers)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiException);
    expect(error).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('returns null with no session', async () => {
    api.getSession.mockResolvedValue({
      headers: new Headers(),
      response: null,
    });
    expect(await service.getSession(headers)).toEqual({
      data: null,
      cookies: [],
    });
  });

  it('returns the user and the refreshed cookie', async () => {
    api.getSession.mockResolvedValue({
      headers: new Headers([['set-cookie', 'lineup.session_token=renewed']]),
      response: { session: {}, user: USER },
    });
    expect(await service.getSession(headers)).toEqual({
      data: { user: toContractUser(USER) },
      cookies: ['lineup.session_token=renewed'],
    });
  });

  it('treats a session deleted mid-refresh as signed out', async () => {
    api.getSession.mockRejectedValue(
      refused('UNAUTHORIZED', 'FAILED_TO_GET_SESSION'),
    );
    expect(await service.getSession(headers)).toEqual({
      data: null,
      cookies: [],
    });
  });

  it('never reads a failed lookup as signed out', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    api.getSession.mockRejectedValue(
      refused('UNPROCESSABLE_ENTITY', 'FAILED_TO_GET_SESSION'),
    );

    await expect(service.getSession(headers)).rejects.toMatchObject({
      error: { code: 'server_error' },
    });
  });

  it('forwards the cookies that clear a session', async () => {
    api.signOut.mockResolvedValue({
      headers: new Headers([
        ['set-cookie', 'lineup.session_token=; Max-Age=0'],
      ]),
      response: { success: true },
    });
    expect(await service.signOut(headers)).toEqual({
      data: null,
      cookies: ['lineup.session_token=; Max-Age=0'],
    });
  });
});

describe('AuthFlowService guests', () => {
  const GUEST = { id: 'g-1', handle: 'guest-abc12345', isAnonymous: true };
  const UPGRADE = {
    email: 'Fan@Lineup.gg',
    password: 'correct-horse',
    handle: 'fan_05',
  };
  const api = {
    getSession: vi.fn(),
    signInAnonymous: vi.fn(),
    signInEmail: vi.fn(),
    sendVerificationEmail: vi.fn(),
  };
  const hash = vi.fn();
  const tx = {
    $queryRaw: vi.fn(),
    user: { update: vi.fn() },
    account: { create: vi.fn() },
  };
  const prisma = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn((run: (client: typeof tx) => Promise<void>) => run(tx)),
    user: { findUnique: vi.fn() },
    session: { deleteMany: vi.fn() },
  };
  const service = new AuthFlowService(
    {
      api,
      instance: { $context: Promise.resolve({ password: { hash } }) },
    } as unknown as AuthService<Auth>,
    prisma as unknown as PrismaService,
    ENV_STUB,
  );
  const headers = new Headers({ cookie: 'lineup.session_token=guest' });
  const signedIn = (user: object) => ({
    headers: new Headers([['set-cookie', 'lineup.session_token=s']]),
    response: { session: {}, user },
  });
  const anonymous = () => ({
    headers: new Headers([['set-cookie', 'lineup.session_token=g']]),
    response: { token: 'g', user: GUEST },
  });

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (run: (client: typeof tx) => Promise<void>) => run(tx),
    );
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue(null);
    tx.$queryRaw.mockResolvedValue([{ is_anonymous: true }]);
    hash.mockResolvedValue('scrypt-hash');
    api.getSession.mockResolvedValue({
      headers: new Headers(),
      response: null,
    });
  });

  describe('continueAsGuest', () => {
    it('creates a guest when signed out', async () => {
      api.signInAnonymous.mockResolvedValue(anonymous());

      expect(await service.continueAsGuest(headers)).toEqual({
        data: { user: toContractUser(GUEST) },
        cookies: ['lineup.session_token=g'],
      });
      expect(api.signInAnonymous).toHaveBeenCalledWith({
        headers,
        returnHeaders: true,
      });
    });

    it('returns the current guest instead of a second one', async () => {
      api.getSession.mockResolvedValue(signedIn(GUEST));

      const result = await service.continueAsGuest(headers);

      expect(result.data.user).toEqual(toContractUser(GUEST));
      expect(api.signInAnonymous).not.toHaveBeenCalled();
    });

    it('refuses a signed-in account', async () => {
      api.getSession.mockResolvedValue(signedIn(USER));

      await expect(service.continueAsGuest(headers)).rejects.toMatchObject({
        error: { code: 'forbidden', message: SIGN_OUT_FIRST },
      });
      expect(api.signInAnonymous).not.toHaveBeenCalled();
    });

    it('tries once more after a handle collision', async () => {
      api.signInAnonymous
        .mockRejectedValueOnce(new Error('unique violation'))
        .mockResolvedValueOnce(anonymous());

      const result = await service.continueAsGuest(headers);

      expect(result.data.user.isGuest).toBe(true);
      expect(api.signInAnonymous).toHaveBeenCalledTimes(2);
    });

    it('gives up after the second collision', async () => {
      const crash = new Error('unique violation');
      api.signInAnonymous.mockRejectedValue(crash);

      await expect(service.continueAsGuest(headers)).rejects.toBe(crash);
      expect(api.signInAnonymous).toHaveBeenCalledTimes(2);
    });

    it('maps a Better Auth refusal without retrying', async () => {
      api.signInAnonymous.mockRejectedValue(
        refused('BAD_REQUEST', 'ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN'),
      );

      await expect(service.continueAsGuest(headers)).rejects.toMatchObject({
        error: { code: 'invalid_input' },
      });
      expect(api.signInAnonymous).toHaveBeenCalledTimes(1);
    });
  });

  describe('upgradeGuest', () => {
    const NEW_USER = { ...USER, id: 'g-1', isAnonymous: false };

    beforeEach(() => {
      api.getSession.mockResolvedValue({ session: {}, user: GUEST });
      api.signInEmail.mockResolvedValue({
        headers: new Headers([['set-cookie', 'lineup.session_token=new']]),
        response: { token: 'new', user: NEW_USER },
      });
    });

    it('upgrades in place, keeping the user id', async () => {
      const result = await service.upgradeGuest(UPGRADE, headers);

      expect(result).toEqual({
        data: { user: { ...toContractUser(NEW_USER), id: 'g-1' } },
        cookies: ['lineup.session_token=new'],
      });
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'g-1' },
        data: {
          email: 'fan@lineup.gg',
          handle: 'fan_05',
          name: 'fan_05',
          isAnonymous: false,
          emailVerified: false,
        },
      });
      expect(tx.account.create).toHaveBeenCalledWith({
        data: {
          userId: 'g-1',
          accountId: 'g-1',
          providerId: 'credential',
          password: 'scrypt-hash',
        },
      });
      expect(hash).toHaveBeenCalledWith('correct-horse');
    });

    it('signs in afresh and drops the guest sessions', async () => {
      await service.upgradeGuest(UPGRADE, headers);

      expect(api.signInEmail).toHaveBeenCalledWith({
        body: { email: 'fan@lineup.gg', password: 'correct-horse' },
        headers,
        returnHeaders: true,
      });
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'g-1', token: { not: 'new' } },
      });
    });

    it('sends a verification mail to the new address', async () => {
      await service.upgradeGuest(UPGRADE, headers);

      expect(api.sendVerificationEmail).toHaveBeenCalledWith({
        body: { email: 'fan@lineup.gg', callbackURL: CALLBACK },
      });
    });

    it('still upgrades when the verification send fails', async () => {
      const logError = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      api.sendVerificationEmail.mockRejectedValue(
        refused('BAD_REQUEST', 'VERIFICATION_EMAIL_NOT_ENABLED'),
      );

      const result = await service.upgradeGuest(UPGRADE, headers);

      expect(result.data.user.id).toBe('g-1');
      expect(logError).toHaveBeenCalledWith(
        'Verification mail not sent: VERIFICATION_EMAIL_NOT_ENABLED',
      );
      expect(JSON.stringify(logError.mock.calls)).not.toContain('fan@');
    });

    it('logs no message from a send failure that is not Better Auth', async () => {
      const logError = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      api.sendVerificationEmail.mockRejectedValue(
        new Error('connect failed for fan@lineup.gg'),
      );

      const result = await service.upgradeGuest(UPGRADE, headers);

      expect(result.data.user.id).toBe('g-1');
      expect(logError).toHaveBeenCalledWith(
        'Verification mail not sent: error',
      );
      expect(JSON.stringify(logError.mock.calls)).not.toContain('fan@');
    });

    it('sends nothing when the upgrade is refused', async () => {
      tx.$queryRaw.mockResolvedValue([{ is_anonymous: false }]);

      await expect(service.upgradeGuest(UPGRADE, headers)).rejects.toThrow();
      expect(api.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('refuses with no session', async () => {
      api.getSession.mockResolvedValue(null);

      await expect(
        service.upgradeGuest(UPGRADE, headers),
      ).rejects.toMatchObject({
        error: { code: 'unauthorized', message: NO_SESSION },
      });
    });

    it('refuses a registered account before checking the form', async () => {
      api.getSession.mockResolvedValue({ session: {}, user: USER });
      prisma.$queryRaw.mockResolvedValue([{}]);

      await expect(
        service.upgradeGuest(UPGRADE, headers),
      ).rejects.toMatchObject({
        error: { code: 'forbidden', message: ALREADY_REGISTERED },
      });
    });

    it('refuses a taken handle, then a taken email', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{}]);
      await expect(
        service.upgradeGuest(UPGRADE, headers),
      ).rejects.toMatchObject({
        error: { code: 'invalid_input', message: HANDLE_TAKEN },
      });

      prisma.user.findUnique.mockResolvedValueOnce({ id: 'u-9' });
      await expect(
        service.upgradeGuest(UPGRADE, headers),
      ).rejects.toMatchObject({
        error: { code: 'invalid_input', message: EMAIL_TAKEN },
      });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'fan@lineup.gg' },
        select: { id: true },
      });
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('checks again for a guest inside the transaction', async () => {
      tx.$queryRaw.mockResolvedValue([{ is_anonymous: false }]);

      await expect(
        service.upgradeGuest(UPGRADE, headers),
      ).rejects.toMatchObject({
        error: { code: 'forbidden', message: ALREADY_REGISTERED },
      });
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(api.signInEmail).not.toHaveBeenCalled();
    });

    it('reports a handle lost to a race as taken', async () => {
      tx.user.update.mockRejectedValue(new Error('unique violation'));
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{}]);

      await expect(
        service.upgradeGuest(UPGRADE, headers),
      ).rejects.toMatchObject({ error: { message: HANDLE_TAKEN } });
    });

    it('passes on a database failure that is not a race', async () => {
      const crash = new Error('connection reset');
      tx.user.update.mockRejectedValue(crash);

      await expect(service.upgradeGuest(UPGRADE, headers)).rejects.toBe(crash);
    });
  });
});
