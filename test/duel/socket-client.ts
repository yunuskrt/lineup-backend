import { io, type Socket, type SocketOptions } from 'socket.io-client';
import type { ManagerOptions } from 'socket.io-client';

type Options = Partial<ManagerOptions & SocketOptions>;

export type Refusal = { message: string; data: unknown };

const ACK_TIMEOUT_MS = 3_000;

// Never reconnects: each case drives one socket
export function openSocket(url: string, auth: object, options: Options = {}) {
  return io(url, {
    auth,
    reconnection: false,
    forceNew: true,
    ...options,
  });
}

// Resolves on connect, rejects with the refusal
export function connected(socket: Socket): Promise<Socket> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error: Error & { data?: unknown }) =>
      reject(Object.assign(new Error(error.message), { data: error.data })),
    );
  });
}

export async function refusalOf(socket: Socket): Promise<Refusal> {
  try {
    await connected(socket);
  } catch (error) {
    const { message, data } = error as Error & { data?: unknown };
    socket.close();
    return { message, data };
  }
  socket.close();
  throw new Error('Expected the handshake to be refused');
}

export function ackOf(
  socket: Socket,
  event: string,
  ...args: unknown[]
): Promise<unknown> {
  return socket.timeout(ACK_TIMEOUT_MS).emitWithAck(event, ...args);
}

export function nextEvent<T = unknown>(
  socket: Socket,
  event: string,
): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event, (payload: T) => resolve(payload));
  });
}
