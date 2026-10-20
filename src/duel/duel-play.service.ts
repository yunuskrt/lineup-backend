import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ApiException } from '@/common/api-exception.js';
import { CLOCK, type Clock } from '@/common/clock.js';
import type { User } from '@/contract/auth.js';
import type { DuelGuessRequest } from '@/contract/duel.js';
import {
  applyTimed,
  nextDeadline,
  type TimedInput,
  type TimedRejection,
  type TimedStep,
} from '@/game/timed-game.js';
import { DUEL_PLAY_MESSAGES } from '@/duel/duel-messages.js';
import { eventsFor } from '@/duel/duel-events.js';
import { DuelNotifier } from '@/duel/duel-notifier.js';
import { type PlayingRoom, seatOf } from '@/duel/duel-room.js';
import { DuelRooms } from '@/duel/duel-rooms.js';

// Never echoes the guess (HC 2)
export function playRejection(rejected: TimedRejection): ApiException {
  switch (rejected) {
    case 'not_your_turn':
      return new ApiException('forbidden', DUEL_PLAY_MESSAGES.waitTurn);
    case 'round_over':
      return new ApiException('session_over', DUEL_PLAY_MESSAGES.roundOver);
    case 'session_over':
      return new ApiException('session_over', DUEL_PLAY_MESSAGES.notRunning);
    default:
      throw new Error(`A duel input was refused as ${rejected}`);
  }
}

// From round 1 to finished
@Injectable()
export class DuelPlayService implements OnModuleDestroy {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly rooms: DuelRooms,
    private readonly notifier: DuelNotifier,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  start(room: PlayingRoom): void {
    this.arm(room);
  }

  guess(user: User, request: DuelGuessRequest): void {
    const room = this.playingOf(user.id);
    if (!room) {
      throw new ApiException('session_over', DUEL_PLAY_MESSAGES.notRunning);
    }
    if (request.sessionId !== room.id) {
      throw new ApiException('invalid_input', DUEL_PLAY_MESSAGES.otherDuel);
    }
    const seat = seatOf(room, user.id);
    const step = this.apply(room, { kind: 'guess', seat, text: request.guess });
    // A refused guess still keeps the catch-up
    if (step.rejected) throw playRejection(step.rejected);
  }

  forfeit(user: User): void {
    const room = this.playingOf(user.id);
    if (!room) throw new ApiException('forbidden', DUEL_PLAY_MESSAGES.noDuel);
    const step = this.apply(room, {
      kind: 'forfeit',
      seat: seatOf(room, user.id),
    });
    if (step.rejected) {
      throw new ApiException('forbidden', DUEL_PLAY_MESSAGES.noDuel);
    }
  }

  // Until B40: leaving mid-duel is a forfeit
  drop(userId: string): void {
    const room = this.playingOf(userId);
    if (room) this.apply(room, { kind: 'forfeit', seat: seatOf(room, userId) });
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private playingOf(userId: string): PlayingRoom | null {
    const room = this.rooms.roomOf(userId);
    return room?.phase === 'playing' ? room : null;
  }

  private tick(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room?.phase === 'playing') this.apply(room, { kind: 'tick' });
  }

  // State first, then events: a handler sees it
  private apply(room: PlayingRoom, input: TimedInput): TimedStep {
    const step = applyTimed(room.timed, input, this.clock.now());
    const next: PlayingRoom = { ...room, timed: step.timed };
    if (step.timed.game.result) {
      this.disarm(room.id);
      this.rooms.close(room.id);
    } else {
      this.rooms.save(next);
      this.arm(next);
    }
    for (const { seat, event, payload } of eventsFor(room, step.effects)) {
      this.notifier.toUser(room.players[seat].id, event, payload);
    }
    return step;
  }

  // One timer per room, at the next deadline
  private arm(room: PlayingRoom): void {
    this.disarm(room.id);
    const deadline = nextDeadline(room.timed);
    if (deadline === null) return;
    const delay = Math.max(0, deadline + 1 - this.clock.now());
    const timer = setTimeout(() => {
      this.timers.delete(room.id);
      this.tick(room.id);
    }, delay);
    // Never keeps the process alive on its own
    timer.unref();
    this.timers.set(room.id, timer);
  }

  private disarm(roomId: string): void {
    clearTimeout(this.timers.get(roomId));
    this.timers.delete(roomId);
  }
}
