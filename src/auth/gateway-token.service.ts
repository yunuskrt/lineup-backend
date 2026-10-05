import { Injectable, Logger } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { fromBetterAuth } from '@/auth/auth-flow.service.js';
import type { Auth } from '@/auth/auth.factory.js';
import type { GatewayToken } from '@/contract/auth.js';

export type VerifiedToken = { userId: string };

// Reads exp from a token we just signed; no checks
export function expiryOf(token: string): number {
  const [, body = ''] = token.split('.');
  const claims: unknown = JSON.parse(
    Buffer.from(body, 'base64url').toString('utf8'),
  );
  const exp =
    typeof claims === 'object' && claims !== null && 'exp' in claims
      ? claims.exp
      : undefined;
  if (typeof exp !== 'number') throw new Error('Token has no expiry');
  return exp * 1000;
}

@Injectable()
export class GatewayTokenService {
  private readonly logger = new Logger('GatewayToken');

  constructor(private readonly betterAuth: AuthService<Auth>) {}

  // For whoever the session headers belong to
  async issue(headers: Headers): Promise<GatewayToken> {
    try {
      const { token } = await this.betterAuth.api.getToken({ headers });
      return { token, expiresAt: expiryOf(token) };
    } catch (error) {
      throw fromBetterAuth(error, this.logger);
    }
  }

  // Never throws: B36 refuses the handshake on null
  async verify(token: string): Promise<VerifiedToken | null> {
    try {
      const { payload } = await this.betterAuth.api.verifyJWT({
        body: { token },
      });
      const sub = payload?.sub;
      return typeof sub === 'string' && sub.length > 0 ? { userId: sub } : null;
    } catch {
      return null;
    }
  }
}
