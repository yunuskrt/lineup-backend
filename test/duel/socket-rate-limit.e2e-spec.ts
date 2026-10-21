import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Socket } from 'socket.io-client';
import { AppModule } from '@/app.module.js';
import { lockoutMessage } from '@/common/rate-limit.guard.js';
import { SOCKET_LIMITS } from '@/common/rate-limits.js';
import { RANDOM } from '@/common/random.js';
import { ENV } from '@/config/config.module.js';
import { loadEnv } from '@/config/load-env.js';
import { apiErrorSchema } from '@/contract/envelope.js';
import type { DuelSession } from '@/contract/duel.js';
import { PROTOCOL_VERSION } from '@/contract/protocol.js';
import { socketAckSchema } from '@/contract/socket.js';
import { NO_PREFERENCE } from '@/game/coin-flip.js';
import { ConnectionRegistry } from '@/duel/connection-registry.js';
import { FLIP_REVEAL_MS } from '@/duel/duel-start.service.js';
import { LineupIoAdapter } from '@/duel/socket.adapter.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import {
  ackOf,
  connected,
  connectGuest,
  gatewayToken,
  type GuestPlayer,
  nextEvent,
  openSocket,
  recordEvents,
  removeGuests,
} from '@test/duel/socket-client.js';

const GUESSES = SOCKET_LIMITS['duel:guess'];
const ENTERS = SOCKET_LIMITS['queue:enter'];
const MISS = 'Zzyzx Qwertyuiop';
const OK = { success: true, data: null };

// A wins the flip, so B names first
const DRAW = 0.1;

type Refused = { success: false; error: { code: string; message: string } };

describe('Socket rate limiting (e2e)', () => {
  let app: NestExpressApplication;
  let server: Server;
  let url: string;
  let registry: ConnectionRegistry;
  let prisma: PrismaService;
  const guests: GuestPlayer[] = [];
  const sockets: Socket[] = [];

  async function player(): Promise<GuestPlayer> {
    const guest = await connectGuest(server, url);
    guests.push(guest);
    sockets.push(guest.socket);
    return guest;
  }

  async function ack(socket: Socket, event: string, ...args: unknown[]) {
    const result = await ackOf(socket, event, ...args);
    expect(socketAckSchema.safeParse(result).success).toBe(true);
    return result;
  }

  function expectLockout(result: unknown, ttl: number) {
    const { error } = result as Refused & {
      error: { retryAfterMs: number };
    };
    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterMs).toBeGreaterThan(0);
    expect(error.retryAfterMs).toBeLessThanOrEqual(ttl);
    expect(error.message).toBe(lockoutMessage(error.retryAfterMs));
    expect(error.message).not.toMatch(/Zzyzx|guess|queue|socket/i);
  }

  beforeAll(async () => {
    const env = loadEnv();
    if (!env.success) throw new Error('E2E needs a valid .env');
    // Back on for this suite only
    const limited = { ...env.data, RATE_LIMITS_ENABLED: true };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(limited)
      .overrideProvider(FLIP_REVEAL_MS)
      .useValue(100)
      .overrideProvider(RANDOM)
      .useValue(() => DRAW)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    app.useWebSocketAdapter(new LineupIoAdapter(app, limited));
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer();
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    registry = app.get(ConnectionRegistry);
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await vi.waitFor(() => {
      for (const p of guests) expect(registry.socketOf(p.id)).toBeNull();
    });
  });

  afterAll(async () => {
    await removeGuests(
      prisma,
      guests.map((p) => p.id),
    );
    await app.close();
  });

  it('refuses the guess over the limit, and only that player', async () => {
    const [a, b] = await Promise.all([player(), player()]);
    const aPaired = nextEvent(a.socket, 'paired');
    await ack(a.socket, 'queue:enter');
    await ack(b.socket, 'queue:enter');
    await aPaired;
    const aReady = nextEvent<DuelSession>(a.socket, 'matchReady');
    await ack(a.socket, 'filters:submit', NO_PREFERENCE);
    await ack(b.socket, 'filters:submit', NO_PREFERENCE);
    const { sessionId, match } = await aReady;
    const lineups = await prisma.lineup.findMany({
      where: { matchTeam: { matchId: match.id, side: match.side } },
      select: { player: { select: { name: true } } },
      orderBy: { slot: 'asc' },
    });
    const bEvents = recordEvents(b.socket);
    const guess = (socket: Socket, text: string) =>
      ack(socket, 'duel:guess', { sessionId, guess: text });

    // B is on turn and spends the whole window
    for (let i = 0; i < GUESSES.limit; i += 1) {
      expect(await guess(b.socket, MISS)).toEqual(OK);
    }
    expectLockout(await guess(b.socket, MISS), GUESSES.ttl);
    await vi.waitFor(() =>
      expect(bEvents.filter((e) => e.event === 'guessResolved')).toHaveLength(
        GUESSES.limit,
      ),
    );

    // A new socket is the same user: still refused
    const socket = openSocket(url, {
      token: await gatewayToken(server, b.cookie),
      protocolVersion: PROTOCOL_VERSION,
    });
    sockets.push(socket);
    const snapshot = nextEvent<DuelSession>(socket, 'matchReady');
    await connected(socket);
    expect(await snapshot).toMatchObject({
      turn: 'you',
      you: { lives: 3 },
      found: [],
    });
    expectLockout(await guess(socket, MISS), GUESSES.ttl);

    // Once the window passes, B names one; A is free
    await new Promise((resolve) => setTimeout(resolve, GUESSES.ttl));
    expect(await guess(socket, lineups[0].player.name)).toEqual(OK);
    await vi.waitFor(async () =>
      expect(await guess(a.socket, MISS)).toEqual(OK),
    );
  });

  it('refuses the queue entry over the limit, refused ones counted', async () => {
    const p = await player();
    expect(await ack(p.socket, 'queue:enter')).toEqual(OK);
    for (let i = 1; i < ENTERS.limit; i += 1) {
      expect(await ack(p.socket, 'queue:enter')).toMatchObject({
        success: false,
        error: { code: 'forbidden' },
      });
    }
    expectLockout(await ack(p.socket, 'queue:enter'), ENTERS.ttl);
    // Leaving has its own count
    expect(await ack(p.socket, 'queue:leave')).toEqual(OK);
  });

  it('sends the lockout as an error when no ack was asked', async () => {
    const p = await player();
    for (let i = 0; i < ENTERS.limit; i += 1) {
      await ack(p.socket, 'queue:enter');
    }
    const error = nextEvent(p.socket, 'error');
    p.socket.emit('queue:enter');

    const payload = await error;
    expect(apiErrorSchema.safeParse(payload).success).toBe(true);
    expectLockout({ success: false, error: payload }, ENTERS.ttl);
  });
});
