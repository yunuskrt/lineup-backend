import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { TierService } from '@/auth/tier.service.js';
import { ApiException } from '@/common/api-exception.js';
import { CLOCK, type Clock } from '@/common/clock.js';
import type { User } from '@/contract/auth.js';
import { MAX_LIVES } from '@/contract/constants.js';
import type { DuelPlayer } from '@/contract/duel.js';
import type { Filters } from '@/contract/match.js';
import {
  DUEL_START_MESSAGES,
  MATCHMAKING_MESSAGES,
  ROOM_MESSAGES,
} from '@/duel/duel-messages.js';
import { ConnectionRegistry } from '@/duel/connection-registry.js';
import { DuelNotifier } from '@/duel/duel-notifier.js';
import { DuelRooms } from '@/duel/duel-rooms.js';
import { DuelStartService } from '@/duel/duel-start.service.js';
import { MatchmakingQueue } from '@/duel/matchmaking-queue.js';
import { newRoomCode, type Pick } from '@/duel/room-code.js';
import { MatchSelectorService } from '@/matches/match-selector.service.js';

export const ROOM_WAIT = Symbol('ROOM_WAIT');
export const ROOM_CODE_PICK = Symbol('ROOM_CODE_PICK');

// Waiting for a friend; memory only (HC 6)
type OpenRoom = {
  readonly code: string;
  readonly creator: DuelPlayer;
  readonly filters: Filters;
  readonly timer: NodeJS.Timeout;
};

const toPlayer = (user: User): DuelPlayer => ({
  id: user.id,
  handle: user.handle,
  lives: MAX_LIVES,
});

@Injectable()
export class PrivateRoomsService implements OnModuleDestroy {
  private readonly byCode = new Map<string, OpenRoom>();
  private readonly codeByCreator = new Map<string, string>();

  constructor(
    private readonly connections: ConnectionRegistry,
    private readonly queue: MatchmakingQueue,
    private readonly duels: DuelRooms,
    private readonly notifier: DuelNotifier,
    private readonly start: DuelStartService,
    private readonly selector: MatchSelectorService,
    private readonly tiers: TierService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ROOM_WAIT) private readonly waitMs: number,
    @Inject(ROOM_CODE_PICK) private readonly pick: Pick,
  ) {}

  isHosting(userId: string): boolean {
    return this.codeByCreator.has(userId);
  }

  // socketId: the socket that sent the command
  async create(user: User, filters: Filters, socketId: string): Promise<void> {
    // R10: first, and fresh; joining stays open
    if ((await this.tiers.effectiveTierOf(user.id)) !== 'pro') {
      throw new ApiException('forbidden', ROOM_MESSAGES.proToHost, {
        reason: 'pro_required',
      });
    }
    this.assertFree(user.id);
    // Checked now: a friend never joins an empty room
    const emptyBecause = await this.selector.check(filters);
    if (emptyBecause) {
      throw new ApiException('empty_pool', DUEL_START_MESSAGES.emptyPool, {
        emptyBecause,
      });
    }
    // Re-read: a drop or another command may have won
    this.assertFree(user.id);
    // Closed or taken over meanwhile: no ghost room
    if (this.connections.socketOf(user.id)?.id !== socketId) return;

    const code = newRoomCode((taken) => this.byCode.has(taken), this.pick);
    const expiresAt = this.clock.now() + this.waitMs;
    const timer = setTimeout(() => this.expire(code), this.waitMs);
    // Never keeps the process alive on its own
    timer.unref();
    this.byCode.set(code, { code, creator: toPlayer(user), filters, timer });
    this.codeByCreator.set(user.id, code);
    this.notifier.toUser(user.id, 'roomCreated', { code, filters, expiresAt });
  }

  // The code arrives uppercased by its schema
  join(user: User, code: string): void {
    const own = this.codeByCreator.get(user.id);
    if (own !== undefined) {
      const message =
        own === code ? ROOM_MESSAGES.ownRoom : ROOM_MESSAGES.alreadyHosting;
      throw new ApiException('forbidden', message);
    }
    this.assertFree(user.id);
    const room = this.byCode.get(code);
    // Wrong, expired, left or joined look alike (D2)
    if (!room) throw new ApiException('not_found', ROOM_MESSAGES.noRoom);

    this.close(room);
    const joiner = toPlayer(user);
    const duel = this.duels.openRoom(
      room.creator,
      joiner,
      room.filters,
      this.clock.now(),
    );
    this.notifier.toUser(room.creator.id, 'paired', {
      phase: 'paired',
      opponent: joiner,
    });
    this.notifier.toUser(joiner.id, 'paired', {
      phase: 'paired',
      opponent: room.creator,
    });
    this.start.openFlipped(duel);
  }

  leave(userId: string): void {
    if (!this.drop(userId)) {
      throw new ApiException('forbidden', ROOM_MESSAGES.notHosting);
    }
  }

  // The creator's socket closed: no window to return
  drop(userId: string): boolean {
    const code = this.codeByCreator.get(userId);
    const room = code === undefined ? undefined : this.byCode.get(code);
    if (!room) return false;
    this.close(room);
    return true;
  }

  onModuleDestroy(): void {
    for (const room of this.byCode.values()) clearTimeout(room.timer);
    this.byCode.clear();
    this.codeByCreator.clear();
  }

  private assertFree(userId: string): void {
    if (this.isHosting(userId)) {
      throw new ApiException('forbidden', ROOM_MESSAGES.alreadyHosting);
    }
    if (this.queue.has(userId)) {
      throw new ApiException('forbidden', MATCHMAKING_MESSAGES.alreadyQueued);
    }
    if (this.duels.roomOf(userId)) {
      throw new ApiException('forbidden', MATCHMAKING_MESSAGES.inDuel);
    }
  }

  private close(room: OpenRoom): void {
    clearTimeout(room.timer);
    this.byCode.delete(room.code);
    this.codeByCreator.delete(room.creator.id);
  }

  private expire(code: string): void {
    const room = this.byCode.get(code);
    if (!room) return;
    this.close(room);
    this.notifier.toUser(room.creator.id, 'roomExpired', { code });
  }
}
