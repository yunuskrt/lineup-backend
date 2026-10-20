import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ApiException } from '@/common/api-exception.js';
import { CLOCK, type Clock } from '@/common/clock.js';
import type { User } from '@/contract/auth.js';
import { MAX_LIVES } from '@/contract/constants.js';
import type { DuelPlayer } from '@/contract/duel.js';
import { MATCHMAKING_MESSAGES } from '@/duel/duel-messages.js';
import { DuelNotifier } from '@/duel/duel-notifier.js';
import { DuelRooms } from '@/duel/duel-rooms.js';
import { DuelStartService } from '@/duel/duel-start.service.js';
import { MatchmakingQueue } from '@/duel/matchmaking-queue.js';

export const QUEUE_TIMEOUT_MS = Symbol('QUEUE_TIMEOUT_MS');
export const DEFAULT_QUEUE_TIMEOUT_MS = 60_000;

@Injectable()
export class MatchmakingService implements OnModuleDestroy {
  private readonly queue = new MatchmakingQueue();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly rooms: DuelRooms,
    private readonly notifier: DuelNotifier,
    private readonly start: DuelStartService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(QUEUE_TIMEOUT_MS) private readonly timeoutMs: number,
  ) {}

  enter(user: User): void {
    if (this.queue.has(user.id)) {
      throw new ApiException('forbidden', MATCHMAKING_MESSAGES.alreadyQueued);
    }
    if (this.rooms.roomOf(user.id)) {
      throw new ApiException('forbidden', MATCHMAKING_MESSAGES.inDuel);
    }

    const since = this.clock.now();
    // Always before paired: the web resets on it
    this.notifier.toUser(user.id, 'queued', { phase: 'queued', since });

    const player = { id: user.id, handle: user.handle, lives: MAX_LIVES };
    const waiting = this.queue.takeOpponent(user.id);
    if (waiting) {
      this.pair(waiting.player, player);
      return;
    }
    this.queue.enter(player, since);
    this.startTimer(user.id, since);
  }

  leave(userId: string): void {
    if (!this.queue.leave(userId)) {
      throw new ApiException('forbidden', MATCHMAKING_MESSAGES.notQueued);
    }
    this.stopTimer(userId);
  }

  // A connection that closed or was replaced
  drop(userId: string): void {
    if (this.queue.leave(userId)) {
      this.stopTimer(userId);
      return;
    }
    this.start.drop(userId);
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private pair(first: DuelPlayer, second: DuelPlayer): void {
    this.stopTimer(first.id);
    const room = this.rooms.open(first, second, this.clock.now());
    this.notifier.toUser(first.id, 'paired', {
      phase: 'paired',
      opponent: second,
    });
    this.notifier.toUser(second.id, 'paired', {
      phase: 'paired',
      opponent: first,
    });
    this.start.open(room);
  }

  private startTimer(userId: string, since: number): void {
    const timer = setTimeout(() => {
      this.timeOut(userId, since);
    }, this.timeoutMs);
    // Never keeps the process alive on its own
    timer.unref();
    this.timers.set(userId, timer);
  }

  private stopTimer(userId: string): void {
    clearTimeout(this.timers.get(userId));
    this.timers.delete(userId);
  }

  private timeOut(userId: string, since: number): void {
    this.timers.delete(userId);
    if (!this.queue.leave(userId)) return;
    this.notifier.toUser(userId, 'queueTimedOut', {
      phase: 'queued',
      waitedMs: Math.max(0, this.clock.now() - since),
    });
  }
}
