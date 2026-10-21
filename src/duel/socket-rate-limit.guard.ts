import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  InjectThrottlerStorage,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { ApiException } from '@/common/api-exception.js';
import { lockoutMessage } from '@/common/rate-limit.guard.js';
import { socketLimitOf } from '@/common/rate-limits.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import type { DuelSocket } from '@/duel/duel.gateway.js';

const SECOND = 1_000;
const THROTTLER_NAME = 'socket';

// Never in a REST route's key space
export const socketKey = (command: string, userId: string) =>
  `socket:${command}:user:${userId}`;

// Before pipes and handler: a refusal costs nothing
@Injectable()
export class SocketRateLimitGuard implements CanActivate {
  constructor(
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'ws' || !this.env.RATE_LIMITS_ENABLED) {
      return true;
    }
    const ws = context.switchToWs();
    const command = ws.getPattern();
    // Set by the handshake, from the verified token
    const { user } = ws.getClient<DuelSocket>().data;
    const { limit, ttl } = socketLimitOf(command);

    const record = await this.storage.increment(
      socketKey(command, user.id),
      ttl,
      limit,
      ttl,
      THROTTLER_NAME,
    );
    if (!record.isBlocked) return true;

    // The store counts the block in whole seconds
    const retryAfterMs = Math.max(0, record.timeToBlockExpire) * SECOND;
    throw new ApiException('rate_limited', lockoutMessage(retryAfterMs), {
      retryAfterMs,
    });
  }
}
