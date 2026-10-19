import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { DuelPlayer } from '@/contract/duel.js';

// The id becomes the duel's sessionId in B38
export type DuelRoom = {
  id: string;
  players: [DuelPlayer, DuelPlayer];
  pairedAt: number;
};

@Injectable()
export class DuelRooms {
  private readonly rooms = new Map<string, DuelRoom>();
  private readonly roomIdByUser = new Map<string, string>();

  open(first: DuelPlayer, second: DuelPlayer, pairedAt: number): DuelRoom {
    const room: DuelRoom = {
      id: randomUUID(),
      players: [first, second],
      pairedAt,
    };
    this.rooms.set(room.id, room);
    for (const player of room.players) {
      this.roomIdByUser.set(player.id, room.id);
    }
    return room;
  }

  roomOf(userId: string): DuelRoom | null {
    const roomId = this.roomIdByUser.get(userId);
    return (roomId && this.rooms.get(roomId)) || null;
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
