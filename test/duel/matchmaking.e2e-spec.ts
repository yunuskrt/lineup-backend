import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '@/app.module.js';
import { loadEnv } from '@/config/load-env.js';
import { duelEventSchemas } from '@/contract/duel.js';
import { PROTOCOL_VERSION } from '@/contract/protocol.js';
import { socketAckSchema } from '@/contract/socket.js';
import { ConnectionRegistry } from '@/duel/connection-registry.js';
import { MATCHMAKING_MESSAGES } from '@/duel/duel-messages.js';
import { QUEUE_TIMEOUT_MS } from '@/duel/matchmaking.service.js';
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
  type Recorded,
  recordEvents,
} from '@test/duel/socket-client.js';

// Long enough to make every pair before it fires
const TIMEOUT_MS = 1_000;

const OK = { success: true, data: null };

const refusedWith = (code: string, message: string) => ({
  success: false,
  error: { code, message, retryAfterMs: null },
});

type Player = GuestPlayer & { events: Recorded[] };

describe('FIFO matchmaking (e2e)', () => {
  let app: NestExpressApplication;
  let server: Server;
  let url: string;
  let registry: ConnectionRegistry;
  const guests: string[] = [];
  const players: Player[] = [];

  async function player(): Promise<Player> {
    const guest = await connectGuest(server, url);
    guests.push(guest.id);
    const joined = { ...guest, events: recordEvents(guest.socket) };
    players.push(joined);
    return joined;
  }

  async function playersOf(count: number) {
    return Promise.all(Array.from({ length: count }, player));
  }

  async function ack(p: Player, event: string, ...args: unknown[]) {
    const result = await ackOf(p.socket, event, ...args);
    expect(socketAckSchema.safeParse(result).success).toBe(true);
    return result;
  }

  const enter = (p: Player) => ack(p, 'queue:enter');
  const names = (p: Player) => p.events.map((e) => e.event);
  const opponentOf = (p: Player) =>
    p.events.find((e) => e.event === 'paired')?.payload;

  const asOpponent = (p: Player) => ({
    phase: 'paired',
    opponent: { id: p.id, handle: p.handle, lives: 3 },
  });

  // The server must see the close before the next case
  async function closed(p: Player) {
    p.socket.close();
    await vi.waitFor(() => expect(registry.socketOf(p.id)).toBeNull());
  }

  beforeAll(async () => {
    const env = loadEnv();
    if (!env.success) throw new Error('E2E needs a valid .env');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(QUEUE_TIMEOUT_MS)
      .useValue(TIMEOUT_MS)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    app.useWebSocketAdapter(new LineupIoAdapter(app, env.data));
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer();
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    registry = app.get(ConnectionRegistry);
  });

  afterEach(async () => {
    const done = players.splice(0);
    for (const p of done) {
      // Every event matches the contract
      for (const { event, payload } of p.events) {
        const schema = duelEventSchemas[event as keyof typeof duelEventSchemas];
        expect(schema?.safeParse(payload).success, event).toBe(true);
      }
      p.socket.close();
    }
    // Nobody may still be waiting for the next case
    await vi.waitFor(() => {
      for (const p of done) expect(registry.socketOf(p.id)).toBeNull();
    });
  });

  afterAll(async () => {
    await app.get(PrismaService).user.deleteMany({
      where: { id: { in: guests } },
    });
    await app.close();
  });

  describe('pairing', () => {
    it('queues the first player and pairs the second with them', async () => {
      const [a, b] = await playersOf(2);
      expect(await enter(a)).toEqual(OK);
      expect(names(a)).toEqual(['queued']);
      expect(a.events[0]?.payload).toEqual({
        phase: 'queued',
        since: expect.any(Number),
      });

      const aPaired = nextEvent(a.socket, 'paired');
      expect(await enter(b)).toEqual(OK);
      // Both arrive before the ack, queued first
      expect(names(b)).toEqual(['queued', 'paired']);
      expect(opponentOf(b)).toEqual(asOpponent(a));
      expect(await aPaired).toEqual(asOpponent(b));
    });

    it('pairs in order of arrival', async () => {
      const [a, b, c, d] = await playersOf(4);
      for (const p of [a, b, c]) await enter(p);
      expect(names(c)).toEqual(['queued']);

      await enter(d);
      expect(opponentOf(d)).toEqual(asOpponent(c));
      expect(opponentOf(b)).toEqual(asOpponent(a));
    });
  });

  describe('refusals', () => {
    it('refuses a second enter while waiting', async () => {
      const [a] = await playersOf(1);
      await enter(a);
      expect(await enter(a)).toEqual(
        refusedWith('forbidden', MATCHMAKING_MESSAGES.alreadyQueued),
      );
    });

    it('refuses an enter while paired', async () => {
      const [a, b] = await playersOf(2);
      await enter(a);
      await enter(b);
      expect(await enter(a)).toEqual(
        refusedWith('forbidden', MATCHMAKING_MESSAGES.inDuel),
      );
    });

    it('refuses a leave by a player not waiting', async () => {
      const [a] = await playersOf(1);
      expect(await ack(a, 'queue:leave')).toEqual(
        refusedWith('forbidden', MATCHMAKING_MESSAGES.notQueued),
      );
    });

    it('refuses an enter carrying a payload', async () => {
      const [a] = await playersOf(1);
      expect(await ack(a, 'queue:enter', { tier: 'pro' })).toMatchObject({
        success: false,
        error: { code: 'invalid_input' },
      });
      expect(names(a)).toEqual([]);
    });
  });

  describe('leaving', () => {
    it('takes a player who leaves out of the queue', async () => {
      const [a, b, c] = await playersOf(3);
      await enter(a);
      expect(await ack(a, 'queue:leave')).toEqual(OK);
      await enter(b);
      await enter(c);
      expect(opponentOf(c)).toEqual(asOpponent(b));
      expect(names(a)).toEqual(['queued']);
    });

    it('takes a player whose connection closes out of the queue', async () => {
      const [a, b, c] = await playersOf(3);
      await enter(a);
      await closed(a);
      await enter(b);
      await enter(c);
      expect(opponentOf(c)).toEqual(asOpponent(b));
    });

    it('starts a replacing connection idle', async () => {
      const [a, b] = await playersOf(2);
      await enter(a);
      const again = await connected(
        openSocket(url, {
          token: await gatewayToken(server, a.cookie),
          protocolVersion: PROTOCOL_VERSION,
        }),
      );
      const a2: Player = { ...a, socket: again, events: recordEvents(again) };
      players.push(a2);

      await enter(b);
      expect(names(b)).toEqual(['queued']);
      expect(await enter(a2)).toEqual(OK);
      expect(opponentOf(a2)).toEqual(asOpponent(b));
    });
  });

  describe('the timeout', () => {
    it('sends queueTimedOut, then lets the player queue again', async () => {
      const [a, b] = await playersOf(2);
      const timedOut = nextEvent<{ waitedMs: number }>(
        a.socket,
        'queueTimedOut',
      );
      await enter(a);
      const { waitedMs } = await timedOut;
      // Node timers can fire a ms before Date.now
      expect(waitedMs).toBeGreaterThanOrEqual(TIMEOUT_MS - 5);

      expect(await enter(a)).toEqual(OK);
      await enter(b);
      expect(opponentOf(b)).toEqual(asOpponent(a));
    });
  });

  describe('a pair broken early', () => {
    it('tells the player left behind, who can queue again', async () => {
      const [a, b, c] = await playersOf(3);
      await enter(a);
      await enter(b);

      const left = nextEvent(b.socket, 'error');
      await closed(a);
      expect(await left).toEqual({
        code: 'session_over',
        message: MATCHMAKING_MESSAGES.opponentLeft,
        retryAfterMs: null,
      });

      expect(await enter(b)).toEqual(OK);
      await enter(c);
      expect(opponentOf(c)).toEqual(asOpponent(b));
    });
  });
});
