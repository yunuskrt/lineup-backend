import { Injectable, Logger } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { isAPIError } from 'better-auth/api';
import { ApiException, SERVER_ERROR_MESSAGE } from '@/common/api-exception.js';
import type { Auth } from '@/auth/auth.factory.js';
import type {
  Session,
  SignInRequest,
  SignUpRequest,
  UpgradeGuestRequest,
  User,
} from '@/contract/auth.js';
import { PrismaService } from '@/prisma/prisma.service.js';

export const HANDLE_TAKEN = 'That handle is taken.';
export const EMAIL_TAKEN = 'That email is already registered.';
export const BAD_CREDENTIALS = 'Email or password is incorrect.';
export const NO_SESSION = 'Sign in or continue as a guest first.';
export const ALREADY_REGISTERED = 'This account is already registered.';
export const SIGN_OUT_FIRST = 'Sign out first.';
const INVALID = 'The request was not valid.';

const EMAIL_IN_USE = new Set([
  'USER_ALREADY_EXISTS',
  'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
]);

// The Set-Cookie lines to forward with the result
export type WithCookies<T> = { data: T; cookies: string[] };

type AuthUser = { id: string; handle: string; isAnonymous?: boolean | null };

export function toContractUser(user: AuthUser): User {
  // Both resolved here, never read from a request
  return {
    id: user.id,
    handle: user.handle,
    isGuest: user.isAnonymous === true,
    tier: 'free',
  };
}

// The guest plugin types its user loosely
export function asAuthUser(
  user: { id: string } & Record<string, unknown>,
): AuthUser {
  if (typeof user.handle !== 'string') {
    throw new Error('Better Auth returned a user without a handle');
  }
  return {
    id: user.id,
    handle: user.handle,
    isAnonymous: user.isAnonymous === true,
  };
}

// Codes only: Better Auth's text never leaves
export function fromBetterAuth(error: unknown, logger: Logger): unknown {
  if (!isAPIError(error)) return error;

  const code = error.body?.code ?? String(error.status);
  if (EMAIL_IN_USE.has(code)) {
    return new ApiException('invalid_input', EMAIL_TAKEN);
  }
  if (code === 'INVALID_EMAIL_OR_PASSWORD') {
    return new ApiException('unauthorized', BAD_CREDENTIALS);
  }
  if (error.statusCode === 400) {
    return new ApiException('invalid_input', INVALID);
  }
  logger.error(`Better Auth refused with ${code}`);
  return new ApiException('server_error', SERVER_ERROR_MESSAGE);
}

@Injectable()
export class AuthFlowService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly betterAuth: AuthService<Auth>,
    private readonly prisma: PrismaService,
  ) {}

  // Forwards the cookie a refresh or expiry sets
  async getSession(headers: Headers): Promise<WithCookies<Session | null>> {
    try {
      const result = await this.betterAuth.api.getSession({
        headers,
        returnHeaders: true,
      });
      const found = result.response;
      return {
        data: found ? { user: toContractUser(found.user) } : null,
        cookies: result.headers.getSetCookie(),
      };
    } catch (error) {
      // Deleted mid-refresh: the caller is signed out
      if (isAPIError(error) && error.statusCode === 401) {
        return { data: null, cookies: [] };
      }
      throw fromBetterAuth(error, this.logger);
    }
  }

  async signUp(
    { email, password, handle }: SignUpRequest,
    headers: Headers,
  ): Promise<WithCookies<Session>> {
    await this.assertHandleFree(handle);
    try {
      const result = await this.betterAuth.api.signUpEmail({
        body: { email, password, handle, name: handle },
        headers,
        returnHeaders: true,
      });
      return this.withCookies(result);
    } catch (error) {
      // Lost a race for the handle after the check
      await this.assertHandleFree(handle);
      throw fromBetterAuth(error, this.logger);
    }
  }

  async signIn(
    { email, password }: SignInRequest,
    headers: Headers,
  ): Promise<WithCookies<Session>> {
    try {
      const result = await this.betterAuth.api.signInEmail({
        body: { email, password },
        headers,
        returnHeaders: true,
      });
      return this.withCookies(result);
    } catch (error) {
      throw fromBetterAuth(error, this.logger);
    }
  }

  // Succeeds with or without a session
  async signOut(headers: Headers): Promise<WithCookies<null>> {
    try {
      const result = await this.betterAuth.api.signOut({
        headers,
        returnHeaders: true,
      });
      return { data: null, cookies: result.headers.getSetCookie() };
    } catch (error) {
      throw fromBetterAuth(error, this.logger);
    }
  }

  // Already a guest: the same identity comes back
  async continueAsGuest(headers: Headers): Promise<WithCookies<Session>> {
    const { data: current, cookies } = await this.getSession(headers);
    if (current?.user.isGuest) return { data: current, cookies };
    if (current) throw new ApiException('forbidden', SIGN_OUT_FIRST);
    try {
      return await this.signInAnonymous(headers);
    } catch (error) {
      if (isAPIError(error)) throw fromBetterAuth(error, this.logger);
      // A generated handle collided; one more try
      return this.signInAnonymous(headers).catch((retry: unknown) => {
        throw fromBetterAuth(retry, this.logger);
      });
    }
  }

  // In place: the user id, and its history, stay
  async upgradeGuest(
    { email, password, handle }: UpgradeGuestRequest,
    headers: Headers,
  ): Promise<WithCookies<Session>> {
    const guest = await this.requireGuest(headers);
    const address = email.toLowerCase();
    await this.assertHandleFree(handle);
    await this.assertEmailFree(address);
    const { password: hasher } = await this.betterAuth.instance.$context;
    const hash = await hasher.hash(password);
    try {
      await this.promote(guest.id, { email: address, handle, hash });
    } catch (error) {
      if (error instanceof ApiException) throw error;
      // Lost a race for the handle or the email
      await this.assertHandleFree(handle);
      await this.assertEmailFree(address);
      throw error;
    }
    return this.reissueSession(guest.id, address, password, headers);
  }

  private async signInAnonymous(
    headers: Headers,
  ): Promise<WithCookies<Session>> {
    const { headers: issued, response } =
      await this.betterAuth.api.signInAnonymous({
        headers,
        returnHeaders: true,
      });
    return this.withCookies({
      headers: issued,
      response: { user: asAuthUser(response.user) },
    });
  }

  private async requireGuest(headers: Headers): Promise<{ id: string }> {
    let found;
    try {
      found = await this.betterAuth.api.getSession({
        headers,
        query: { disableRefresh: true },
      });
    } catch (error) {
      throw fromBetterAuth(error, this.logger);
    }
    if (!found) throw new ApiException('unauthorized', NO_SESSION);
    if (found.user.isAnonymous !== true) {
      throw new ApiException('forbidden', ALREADY_REGISTERED);
    }
    return found.user;
  }

  private async promote(
    userId: string,
    { email, handle, hash }: { email: string; handle: string; hash: string },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ is_anonymous: boolean }[]>`
        SELECT is_anonymous FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      // A parallel request upgraded it first
      if (!row?.is_anonymous) {
        throw new ApiException('forbidden', ALREADY_REGISTERED);
      }
      await tx.user.update({
        where: { id: userId },
        data: {
          email,
          handle,
          name: handle,
          isAnonymous: false,
          emailVerified: false,
        },
      });
      await tx.account.create({
        data: {
          userId,
          accountId: userId,
          providerId: 'credential',
          password: hash,
        },
      });
    });
  }

  // A fresh token; the guest's old one stops working
  private async reissueSession(
    userId: string,
    email: string,
    password: string,
    headers: Headers,
  ): Promise<WithCookies<Session>> {
    try {
      const result = await this.betterAuth.api.signInEmail({
        body: { email, password },
        headers,
        returnHeaders: true,
      });
      await this.prisma.session.deleteMany({
        where: { userId, token: { not: result.response.token } },
      });
      return this.withCookies(result);
    } catch (error) {
      throw fromBetterAuth(error, this.logger);
    }
  }

  private async assertEmailFree(email: string): Promise<void> {
    const taken = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (taken) throw new ApiException('invalid_input', EMAIL_TAKEN);
  }

  private async isHandleTaken(handle: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      SELECT 1 FROM users WHERE lower(handle) = lower(${handle}) LIMIT 1`;
    return rows.length > 0;
  }

  private async assertHandleFree(handle: string): Promise<void> {
    if (await this.isHandleTaken(handle)) {
      throw new ApiException('invalid_input', HANDLE_TAKEN);
    }
  }

  private withCookies(result: {
    headers: Headers;
    response: { user: AuthUser };
  }): WithCookies<Session> {
    return {
      data: { user: toContractUser(result.response.user) },
      cookies: result.headers.getSetCookie(),
    };
  }
}
