import type { DuelPlayer } from '@/contract/duel.js';

export type Waiting = { player: DuelPlayer; since: number };

// Insertion order is queue order
export class MatchmakingQueue {
  private readonly waiting = new Map<string, Waiting>();

  enter(player: DuelPlayer, since: number): void {
    this.waiting.set(player.id, { player, since });
  }

  // The oldest entry that isn't the caller
  takeOpponent(userId: string): Waiting | null {
    for (const [id, entry] of this.waiting) {
      if (id === userId) continue;
      this.waiting.delete(id);
      return entry;
    }
    return null;
  }

  leave(userId: string): boolean {
    return this.waiting.delete(userId);
  }

  has(userId: string): boolean {
    return this.waiting.has(userId);
  }
}
