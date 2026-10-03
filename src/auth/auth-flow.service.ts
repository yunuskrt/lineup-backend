import { Injectable, Logger } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { isAPIError } from 'better-auth/api';
import { ApiException, SERVER_ERROR_MESSAGE } from '@/common/api-exception.js';
import type { Auth } from '@/auth/auth.factory.js';
import type {
  Session,
  SignInRequest,
  SignUpRequest,
  User,
} from '@/contract/auth.js';
import { PrismaService } from '@/prisma/prisma.service.js';

export const HANDLE_TAKEN = 'That handle is taken.';
export const EMAIL_TAKEN = 'That email is already registered.';
export const BAD_CREDENTIALS = 'Email or password is incorrect.';
const INVALID = 'The request was not valid.';

const EMAIL_IN_USE = new Set([
  'USER_ALREADY_EXISTS',
  'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
]);

// The Set-Cookie lines to forward with the result
export type WithCookies<T> = { data: T; cookies: string[] };

export function toContractUser(user: { id: string; handle: string }): User {
  // Guests arrive in B11; tier is server-only
  return { id: user.id, handle: user.handle, isGuest: false, tier: 'free' };
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
    response: { user: { id: string; handle: string } };
  }): WithCookies<Session> {
    return {
      data: { user: toContractUser(result.response.user) },
      cookies: result.headers.getSetCookie(),
    };
  }
}
