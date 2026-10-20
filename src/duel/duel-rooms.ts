import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { DuelPlayer } from '@/contract/duel.js';
import type { DuelRoom, FiltersRoom } from '@/duel/duel-room.js';

@Injectable()
export class DuelRooms {
  private readonly rooms = new Map<string, DuelRoom>();
  private readonly roomIdByUser = new Map<string, string>();

  // A new pair starts on filters
  open(first: DuelPlayer, second: DuelPlayer, pairedAt: number): FiltersRoom {
    const room: FiltersRoom = {
      id: randomUUID(),
      players: [first, second],
      pairedAt,
      phase: 'filters',
      submissions: [null, null],
    };
    this.rooms.set(room.id, room);
    for (const player of room.players) {
      this.roomIdByUser.set(player.id, room.id);
    }
    return room;
  }

  // False once the room has closed
  save(room: DuelRoom): boolean {
    if (!this.rooms.has(room.id)) return false;
    this.rooms.set(room.id, room);
    return true;
  }

  get(roomId: string): DuelRoom | null {
    return this.rooms.get(roomId) ?? null;
  }

  roomOf(userId: string): DuelRoom | null {
    const roomId = this.roomIdByUser.get(userId);
    return roomId === undefined ? null : this.get(roomId);
  }

  close(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.rooms.delete(roomId);
    for (const player of room.players) {
      this.roomIdByUser.delete(player.id);
    }
  }
}
