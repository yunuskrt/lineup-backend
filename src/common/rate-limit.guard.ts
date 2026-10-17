import { type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { ApiException } from '@/common/api-exception.js';
import { ENV } from '@/config/config.module.js';
import type { User } from '@/contract/auth.js';
import type { Env } from '@/config/env.schema.js';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

const plural = (count: number, unit: string) =>
  `${count} ${unit}${count === 1 ? '' : 's'}`;

// Names the wait, never the limit or the account
export function lockoutMessage(retryAfterMs: number): string {
  const wait =
    retryAfterMs < MINUTE
      ? plural(Math.max(1, Math.ceil(retryAfterMs / SECOND)), 'second')
      : plural(Math.ceil(retryAfterMs / MINUTE), 'minute');
  return `Too many attempts. Try again in ${wait}.`;
}

// Runs after SessionGuard, so the user is known
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    @Inject(ENV) private readonly env: Env,
  ) {
    super(options, storage, reflector);
  }

  // Sockets get their own limit (B42)
  protected override shouldSkip(context: ExecutionContext): Promise<boolean> {
    const isHttp = context.getType() === 'http';
    return Promise.resolve(!isHttp || !this.env.RATE_LIMITS_ENABLED);
  }

  // The session's user, else the client's IP
  protected override async getTracker(
    req: Record<string, unknown>,
  ): Promise<string> {
    // Set by SessionGuard, from the session only
    const user = (req as { currentUser?: User }).currentUser;
    return user ? `user:${user.id}` : `ip:${await super.getTracker(req)}`;
  }

  protected override throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    // The store counts the block in whole seconds
    const retryAfterMs = Math.max(0, detail.timeToBlockExpire) * SECOND;
    const { res } = this.getRequestResponse(context);
    this.setResponseHeader(res, 'Retry-After', retryAfterMs / SECOND);
    return Promise.reject(
      new ApiException('rate_limited', lockoutMessage(retryAfterMs), {
        retryAfterMs,
      }),
    );
  }
}
