import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Socket } from 'socket.io-client';
import { AppModule } from '@/app.module.js';
import { CLOCK } from '@/common/clock.js';
import { RANDOM } from '@/common/random.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import { loadEnv } from '@/config/load-env.js';
import { duelEventSchemas, type DuelSession } from '@/contract/duel.js';
import type { MatchInPlay } from '@/contract/match.js';
import { PROTOCOL_VERSION } from '@/contract/protocol.js';
import { socketAckSchema } from '@/contract/socket.js';
import { NO_PREFERENCE } from '@/game/coin-flip.js';
import { ConnectionRegistry } from '@/duel/connection-registry.js';
import { RECONNECT_WINDOW } from '@/duel/duel-play.service.js';
import { FILTER_WINDOW_MS, FLIP_REVEAL_MS } from '@/duel/duel-start.service.js';
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
  removeGuests,
} from '@test/duel/socket-client.js';

export type HarnessOptions = {
  // A draw below 0.5 hands seat 0 the flip
  random?: number;
  revealMs?: number;
  windowMs?: number;
  filterWindowMs?: number;
  env?: Partial<Env>;
};

export type Client = GuestPlayer & { events: Recorded[] };

// a queued first, so a holds seat 0
export type PairedDuel = {
  a: Client;
  b: Client;
  sessionId: string;
  match: MatchInPlay;
};

// From Postgres: never from a payload (HC 2)
export type Squad = {
  names: string[];
  ids: string[];
  // The other side's starters: never answers
  others: string[];
};

const DEFAULTS = { random: 0.1, revealMs: 100, windowMs: 1_000 };

// Boots the app and drives clients for duel suites
export class DuelHarness {
  private skewMs = 0;
  private readonly clients: Client[] = [];
  private readonly guestIds = new Set<string>();

  private constructor(
    readonly app: NestExpressApplication,
    readonly server: Server,
    readonly url: string,
    readonly prisma: PrismaService,
    readonly registry: ConnectionRegistry,
  ) {}

  static async boot(options: HarnessOptions = {}): Promise<DuelHarness> {
    const loaded = loadEnv();
    if (!loaded.success) throw new Error('E2E needs a valid .env');
    const env = { ...loaded.data, ...options.env };
    const { random, revealMs, windowMs } = { ...DEFAULTS, ...options };
    let harness: DuelHarness | null = null;

    let builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(env)
      .overrideProvider(RANDOM)
      .useValue(() => random)
      .overrideProvider(FLIP_REVEAL_MS)
      .useValue(revealMs)
      .overrideProvider(RECONNECT_WINDOW)
      .useValue(windowMs)
      .overrideProvider(CLOCK)
      .useValue({ now: () => Date.now() + (harness?.skewMs ?? 0) });
    if (options.filterWindowMs !== undefined) {
      builder = builder
        .overrideProvider(FILTER_WINDOW_MS)
        .useValue(options.filterWindowMs);
    }

    const app = (
      await builder.compile()
    ).createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    app.useWebSocketAdapter(new LineupIoAdapter(app, env));
    await app.listen(0, '127.0.0.1');
    const server: Server = app.getHttpServer();
    const { port } = server.address() as AddressInfo;
    harness = new DuelHarness(
      app,
      server,
      `http://127.0.0.1:${port}`,
      app.get(PrismaService),
      app.get(ConnectionRegistry),
    );
    return harness;
  }

  // Moves the server's clock; timers stay real
  skew(ms: number): void {
    this.skewMs += ms;
  }

  resetClock(): void {
    this.skewMs = 0;
  }

  now(): number {
    return Date.now() + this.skewMs;
  }

  async client(): Promise<Client> {
    const guest = await connectGuest(this.server, this.url);
    this.guestIds.add(guest.id);
    return this.track(guest, guest.socket);
  }

  // The same guest, on a new socket and token
  async reconnect(client: Client): Promise<Client> {
    const socket = openSocket(this.url, {
      token: await gatewayToken(this.server, client.cookie),
      protocolVersion: PROTOCOL_VERSION,
    });
    const joined = this.track(client, socket);
    await connected(socket);
    return joined;
  }

  // Waits until the server has seen the close
  async drop(client: Client): Promise<void> {
    client.socket.close();
    await vi.waitFor(() =>
      expect(this.registry.socketOf(client.id)).toBeNull(),
    );
  }

  async ack(client: Client, event: string, ...args: unknown[]) {
    const result = await ackOf(client.socket, event, ...args);
    expect(socketAckSchema.safeParse(result).success).toBe(true);
    return result;
  }

  // Queued, paired and through filters to matchReady
  async pair(): Promise<PairedDuel> {
    const [a, b] = await Promise.all([this.client(), this.client()]);
    const aPaired = nextEvent(a.socket, 'paired');
    await this.ack(a, 'queue:enter');
    await this.ack(b, 'queue:enter');
    await aPaired;

    const aReady = nextEvent<DuelSession>(a.socket, 'matchReady');
    const bReady = nextEvent(b.socket, 'matchReady');
    await this.ack(a, 'filters:submit', NO_PREFERENCE);
    await this.ack(b, 'filters:submit', NO_PREFERENCE);
    const [{ sessionId, match }] = await Promise.all([aReady, bReady]);
    return { a, b, sessionId, match };
  }

  async squadOf(match: MatchInPlay): Promise<Squad> {
    const rows = await this.prisma.lineup.findMany({
      where: { matchTeam: { matchId: match.id } },
      select: {
        matchTeam: { select: { side: true } },
        player: { select: { id: true, name: true } },
      },
      orderBy: { slot: 'asc' },
    });
    const named = rows.filter((row) => row.matchTeam.side === match.side);
    return {
      names: named.map((row) => row.player.name),
      ids: named.map((row) => row.player.id),
      others: rows
        .filter((row) => row.matchTeam.side !== match.side)
        .map((row) => row.player.name),
    };
  }

  // afterEach: every event parsed, every socket closed
  async settle(): Promise<void> {
    const done = this.clients.splice(0);
    for (const client of done) {
      for (const { event, payload } of client.events) {
        const schema = duelEventSchemas[event as keyof typeof duelEventSchemas];
        expect(schema?.safeParse(payload).success, event).toBe(true);
      }
      client.socket.close();
    }
    await vi.waitFor(() => {
      for (const client of done) {
        expect(this.registry.socketOf(client.id)).toBeNull();
      }
    });
  }

  // afterAll: whatever a failed case left open
  async close(): Promise<void> {
    for (const client of this.clients.splice(0)) client.socket.close();
    await removeGuests(this.prisma, [...this.guestIds]);
    await this.app.close();
  }

  private track(guest: GuestPlayer, socket: Socket): Client {
    const client = { ...guest, socket, events: recordEvents(socket) };
    this.clients.push(client);
    return client;
  }
}
