import { Injectable } from '@nestjs/common';
import type { Socket } from 'socket.io';

type Connection = Pick<Socket, 'id'>;

// One live socket per user: the latest wins
@Injectable()
export class ConnectionRegistry<S extends Connection = Socket> {
  private readonly sockets = new Map<string, S>();

  // Returns the socket it replaced, if any
  register(userId: string, socket: S): S | null {
    const previous = this.sockets.get(userId);
    this.sockets.set(userId, socket);
    return previous && previous.id !== socket.id ? previous : null;
  }

  // A replaced socket's close leaves the new one
  remove(userId: string, socket: S): void {
    if (this.sockets.get(userId)?.id === socket.id) {
      this.sockets.delete(userId);
    }
  }

  socketOf(userId: string): S | null {
    return this.sockets.get(userId) ?? null;
  }
}
