import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ApiException } from '@/common/api-exception.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';

export const ORIGIN_REFUSED = 'Request refused.';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type WriteRequest = {
  method: string;
  origin?: string;
  referer?: string;
};

// The page the request came from, if it says
function sourceOrigin({ origin, referer }: WriteRequest): string | null {
  if (origin) return origin;
  if (!referer) return null;
  return URL.canParse(referer) ? new URL(referer).origin : 'null';
}

// The web app, and Swagger on the API's own origin
export function trustedOrigins(env: Env): string[] {
  return [env.WEB_APP_URL, new URL(env.BETTER_AUTH_URL).origin];
}

// Lax cookies skip cross-site POSTs: check them all
export function isRefused(request: WriteRequest, trusted: string[]): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;
  const source = sourceOrigin(request);
  return source !== null && !trusted.includes(source);
}

@Injectable()
export class OriginCheckMiddleware implements NestMiddleware {
  private readonly trusted: string[];

  constructor(@Inject(ENV) env: Env) {
    this.trusted = trustedOrigins(env);
  }

  use(req: Request, _res: Response, next: NextFunction): void {
    const refused = isRefused(
      {
        method: req.method,
        origin: req.headers.origin,
        referer: req.headers.referer,
      },
      this.trusted,
    );
    if (refused) throw new ApiException('forbidden', ORIGIN_REFUSED);
    next();
  }
}
