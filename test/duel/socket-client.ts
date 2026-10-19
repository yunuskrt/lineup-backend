import type { Server } from 'node:http';
import { io, type Socket, type SocketOptions } from 'socket.io-client';
import type { ManagerOptions } from 'socket.io-client';
import request from 'supertest';
import { PROTOCOL_VERSION } from '@/contract/protocol.js';

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

export type Recorded = { event: string; payload: unknown };

// Every server event, in arrival order
export function recordEvents(socket: Socket): Recorded[] {
  const recorded: Recorded[] = [];
  socket.onAny((event: string, payload: unknown) => {
    recorded.push({ event, payload });
  });
  return recorded;
}

export type GuestPlayer = {
  id: string;
  handle: string;
  cookie: string;
  socket: Socket;
};

const cookieOf = (res: request.Response) =>
  [res.headers['set-cookie'] ?? []]
    .flat()
    .map((c) => c.split(';')[0])
    .join('; ');

export async function gatewayToken(server: Server, cookie: string) {
  const res = await request(server).get('/auth/token').set('Cookie', cookie);
  return res.body.data.token as string;
}

// A fresh guest, connected at version N
export async function connectGuest(
  server: Server,
  url: string,
): Promise<GuestPlayer> {
  const res = await request(server).post('/auth/guest');
  const { id, handle } = res.body.data.user as { id: string; handle: string };
  const cookie = cookieOf(res);
  const token = await gatewayToken(server, cookie);
  const socket = await connected(
    openSocket(url, { token, protocolVersion: PROTOCOL_VERSION }),
  );
  return { id, handle, cookie, socket };
}
