import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ApiException } from '@/common/api-exception.js';
import { CLOCK, type Clock } from '@/common/clock.js';
import type { User } from '@/contract/auth.js';
import type { ConnectionStatus, DuelGuessRequest } from '@/contract/duel.js';
import type { Seat } from '@/game/engine.js';
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
import {
  otherSeat,
  type PlayingRoom,
  seatOf,
  withSeat,
} from '@/duel/duel-room.js';
import { DuelRooms } from '@/duel/duel-rooms.js';
import { toDuelSession } from '@/duel/duel-views.js';
import type { DuelSocket } from '@/duel/duel.gateway.js';

export const RECONNECT_WINDOW = Symbol('RECONNECT_WINDOW');

const windowKey = (roomId: string, seat: Seat) => `${roomId}:${seat}`;

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
  // One reconnect window per away seat
  private readonly windows = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly rooms: DuelRooms,
    private readonly notifier: DuelNotifier,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RECONNECT_WINDOW) private readonly windowMs: number,
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

  isPlaying(userId: string): boolean {
    return this.playingOf(userId) !== null;
  }

  // The clock runs on; the window opens
  drop(userId: string): void {
    const room = this.playingOf(userId);
    if (!room) return;
    const seat = seatOf(room, userId);
    if (room.away[seat] !== null) return;

    const deadline = this.clock.now() + this.windowMs;
    this.rooms.save({ ...room, away: withSeat(room.away, seat, deadline) });
    this.openWindow(room.id, seat);
    this.tellOpponent(room, seat, 'reconnecting', deadline);
  }

  // A returning or replacing socket takes the seat
  rejoin(userId: string, socket: DuelSocket): void {
    const found = this.playingOf(userId);
    if (!found) return;
    // The snapshot must show the clock as it is now
    this.apply(found, { kind: 'tick' });
    const room = this.playingOf(userId);
    if (!room) return;

    const seat = seatOf(room, userId);
    const wasAway = room.away[seat] !== null;
    const current: PlayingRoom = {
      ...room,
      away: withSeat(room.away, seat, null),
    };
    if (wasAway) {
      this.closeWindow(room.id, seat);
      this.rooms.save(current);
      this.notifier.toSocket(socket, 'disconnected', {
        status: 'connected',
        reconnectDeadline: null,
      });
    }
    this.notifier.toSocket(socket, 'matchReady', toDuelSession(current, seat));
    if (wasAway) this.tellOpponent(room, seat, 'connected', null);
  }

  onModuleDestroy(): void {
    for (const timer of [...this.timers.values(), ...this.windows.values()]) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.windows.clear();
  }

  private playingOf(userId: string): PlayingRoom | null {
    const room = this.rooms.roomOf(userId);
    return room?.phase === 'playing' ? room : null;
  }

  // Gone for the whole window: a forfeit
  private expire(roomId: string, seat: Seat): void {
    this.windows.delete(windowKey(roomId, seat));
    const room = this.rooms.get(roomId);
    if (room?.phase !== 'playing' || room.away[seat] === null) return;
    // The clock may have ended it first
    this.apply(room, { kind: 'tick' });
    const current = this.rooms.get(roomId);
    if (current?.phase !== 'playing') return;

    this.tellOpponent(room, seat, 'forfeited', null);
    this.apply(current, { kind: 'forfeit', seat });
  }

  // What the other seat sees of this one
  private tellOpponent(
    room: PlayingRoom,
    seat: Seat,
    status: ConnectionStatus,
    reconnectDeadline: number | null,
  ): void {
    this.notifier.toUser(
      room.players[otherSeat(seat)].id,
      'opponentConnection',
      { status, reconnectDeadline },
    );
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
      this.closeWindow(room.id, 0);
      this.closeWindow(room.id, 1);
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

  private openWindow(roomId: string, seat: Seat): void {
    this.closeWindow(roomId, seat);
    const timer = setTimeout(() => {
      this.expire(roomId, seat);
    }, this.windowMs);
    // Never keeps the process alive on its own
    timer.unref();
    this.windows.set(windowKey(roomId, seat), timer);
  }

  private closeWindow(roomId: string, seat: Seat): void {
    const key = windowKey(roomId, seat);
    clearTimeout(this.windows.get(key));
    this.windows.delete(key);
  }
}
