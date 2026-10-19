import type { IncomingMessage } from 'node:http';
import type { ServerOptions } from 'socket.io';
import { ORIGIN_REFUSED } from '@/common/origin-check.middleware.js';

type AllowRequest = NonNullable<ServerOptions['allowRequest']>;

// Mobile sends no Origin; a browser always does
export function isTrustedOrigin(
  origin: string | undefined,
  trusted: string[],
): boolean {
  return origin === undefined || trusted.includes(origin);
}

// CORS skips the WebSocket upgrade: check it here
export function originGate(trusted: string[]): AllowRequest {
  return (req: IncomingMessage, decide) => {
    const isTrusted = isTrustedOrigin(req.headers.origin, trusted);
    decide(isTrusted ? null : ORIGIN_REFUSED, isTrusted);
  };
}
