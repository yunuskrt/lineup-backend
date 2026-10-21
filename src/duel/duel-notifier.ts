import { Injectable, Logger } from '@nestjs/common';
import { SERVER_ERROR_MESSAGE } from '@/common/api-exception.js';
import { type DuelEventMap, duelEventSchemas } from '@/contract/duel.js';
import type { ApiError } from '@/contract/envelope.js';
import type { DuelServer, DuelSocket } from '@/duel/duel.gateway.js';

export const roomOf = (userId: string) => `user:${userId}`;

const SERVER_ERROR: ApiError = {
  code: 'server_error',
  message: SERVER_ERROR_MESSAGE,
  retryAfterMs: null,
};

type Target = DuelSocket | ReturnType<DuelServer['to']>;
// A generic emit can't narrow a typed event map
type Emitter = { emit(event: string, payload: unknown): unknown };

// The one way duel code reaches a player
@Injectable()
export class DuelNotifier {
  private readonly logger = new Logger('DuelNotifier');
  private server: DuelServer | null = null;

  attach(server: DuelServer): void {
    this.server = server;
  }

  toUser<E extends keyof DuelEventMap>(
    userId: string,
    event: E,
    payload: DuelEventMap[E],
  ): void {
    if (!this.server) {
      throw new Error('DuelNotifier used before the gateway started');
    }
    this.send(this.server.to(roomOf(userId)), event, payload);
  }

  // One socket, where the user's room has two
  toSocket<E extends keyof DuelEventMap>(
    socket: DuelSocket,
    event: E,
    payload: DuelEventMap[E],
  ): void {
    this.send(socket, event, payload);
  }

  // Fail closed: off-contract never leaves
  private send(target: Target, event: keyof DuelEventMap, payload: unknown) {
    const emitter = target as Emitter;
    const parsed = duelEventSchemas[event].safeParse(payload);
    if (parsed.success) {
      // The parsed copy: unknown keys are stripped
      emitter.emit(event, parsed.data);
      return;
    }
    // Paths and codes only: the value may hold a squad
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}:${issue.code}`)
      .join(', ');
    this.logger.error(`Event ${event} broke its contract: ${issues}`);
    emitter.emit('error', SERVER_ERROR);
  }
}
