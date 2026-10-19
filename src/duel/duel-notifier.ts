import { Injectable } from '@nestjs/common';
import type { DuelEventMap } from '@/contract/duel.js';
import type { DuelServer } from '@/duel/duel.gateway.js';

export const roomOf = (userId: string) => `user:${userId}`;

// The one way duel code reaches a player
@Injectable()
export class DuelNotifier {
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
    this.server.to(roomOf(userId)).emit(event, payload);
  }
}
