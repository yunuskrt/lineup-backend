import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Socket } from 'socket.io-client';
import { AppModule } from '@/app.module.js';
import { CLOCK } from '@/common/clock.js';
import { RANDOM } from '@/common/random.js';
import { loadEnv } from '@/config/load-env.js';
import { GRACE_MS, ROUND_MS } from '@/contract/constants.js';
import {
  type ConnectionState,
  type DuelResult,
  duelEventSchemas,
  type DuelSession,
} from '@/contract/duel.js';
import { PROTOCOL_VERSION } from '@/contract/protocol.js';
import { socketAckSchema } from '@/contract/socket.js';
import { NO_PREFERENCE } from '@/game/coin-flip.js';
import { ConnectionRegistry } from '@/duel/connection-registry.js';
import { RECONNECT_WINDOW } from '@/duel/duel-play.service.js';
import { FLIP_REVEAL_MS } from '@/duel/duel-start.service.js';
import { REPLACED } from '@/duel/duel.gateway.js';
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

const WINDOW_MS = 2_000;
const PAST_DEADLINE = ROUND_MS + GRACE_MS + 100;
const OK = { success: true, data: null };
const MISS = 'Zzyzx Qwertyuiop';

type Player = GuestPlayer & { events: Recorded[] };
type Duel = { a: Player; b: Player; sessionId: string; names: string[] };

// A wins the flip, so B names first
const DRAW = 0.1;
let skew = 0;

describe('Disconnect handling (e2e)', () => {
  let app: NestExpressApplication;
  let server: Server;
  let url: string;
  let registry: ConnectionRegistry;
  let prisma: PrismaService;
  const guests: string[] = [];
  const players: Player[] = [];

  function track(guest: GuestPlayer, socket: Socket, events: Recorded[]) {
    const joined = { ...guest, socket, events };
    players.push(joined);
    return joined;
  }

  async function player(): Promise<Player> {
    const guest = await connectGuest(server, url);
    guests.push(guest.id);
    return track(guest, guest.socket, recordEvents(guest.socket));
  }

  // The same guest, on a new socket and token
  async function reconnect(p: Player): Promise<Player> {
    const socket = openSocket(url, {
      token: await gatewayToken(server, p.cookie),
      protocolVersion: PROTOCOL_VERSION,
    });
    const events = recordEvents(socket);
    await connected(socket);
    return track(p, socket, events);
  }

  async function ack(p: Player, event: string, ...args: unknown[]) {
    const result = await ackOf(p.socket, event, ...args);
    expect(socketAckSchema.safeParse(result).success).toBe(true);
    return result;
  }

  async function duel(): Promise<Duel> {
    const [a, b] = await Promise.all([player(), player()]);
    const aPaired = nextEvent(a.socket, 'paired');
    await ack(a, 'queue:enter');
    await ack(b, 'queue:enter');
    await aPaired;

    const aReady = nextEvent<DuelSession>(a.socket, 'matchReady');
    const bReady = nextEvent(b.socket, 'matchReady');
    await ack(a, 'filters:submit', NO_PREFERENCE);
    await ack(b, 'filters:submit', NO_PREFERENCE);
    const [{ sessionId, match }] = await Promise.all([aReady, bReady]);

    const lineups = await prisma.lineup.findMany({
      where: { matchTeam: { matchId: match.id, side: match.side } },
      select: { player: { select: { name: true } } },
      orderBy: { slot: 'asc' },
    });
    const names = lineups.map((row) => row.player.name);
    return { a, b, sessionId, names };
  }

  const guess = (p: Player, d: Duel, text: string) =>
    ack(p, 'duel:guess', { sessionId: d.sessionId, guess: text });
  const namesOf = (p: Player) => p.events.map((e) => e.event);

  // Waits until the server has seen the close
  async function drop(p: Player) {
    p.socket.close();
    await vi.waitFor(() => expect(registry.socketOf(p.id)).toBeNull());
  }

  beforeAll(async () => {
    const env = loadEnv();
    if (!env.success) throw new Error('E2E needs a valid .env');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FLIP_REVEAL_MS)
      .useValue(100)
      .overrideProvider(RECONNECT_WINDOW)
      .useValue(WINDOW_MS)
      .overrideProvider(RANDOM)
      .useValue(() => DRAW)
      .overrideProvider(CLOCK)
      .useValue({ now: () => Date.now() + skew })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    app.useWebSocketAdapter(new LineupIoAdapter(app, env.data));
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer();
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    registry = app.get(ConnectionRegistry);
    prisma = app.get(PrismaService);
  });

  beforeEach(() => {
    skew = 0;
  });

  afterEach(async () => {
    const done = players.splice(0);
    for (const p of done) {
      for (const { event, payload } of p.events) {
        const schema = duelEventSchemas[event as keyof typeof duelEventSchemas];
        expect(schema?.safeParse(payload).success, event).toBe(true);
      }
      p.socket.close();
    }
    await vi.waitFor(() => {
      for (const p of done) expect(registry.socketOf(p.id)).toBeNull();
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: guests } } });
    await app.close();
  });

  it('resumes a player who comes back inside the window', async () => {
    const d = await duel();
    const away = nextEvent<ConnectionState>(d.b.socket, 'opponentConnection');
    await drop(d.a);

    const notice = await away;
    expect(notice.status).toBe('reconnecting');
    const ahead = (notice.reconnectDeadline ?? 0) - (Date.now() + skew);
    expect(ahead).toBeGreaterThan(0);
    expect(ahead).toBeLessThanOrEqual(WINDOW_MS);

    const back = nextEvent<ConnectionState>(d.b.socket, 'opponentConnection');
    const a = await reconnect(d.a);
    await vi.waitFor(() =>
      expect(namesOf(a)).toEqual(['disconnected', 'matchReady']),
    );
    expect(a.events[0].payload).toEqual({
      status: 'connected',
      reconnectDeadline: null,
    });
    expect(a.events[1].payload).toMatchObject({
      sessionId: d.sessionId,
      you: { id: d.a.id, lives: 3 },
      turn: 'opponent',
      found: [],
    });
    expect(await back).toEqual({
      status: 'connected',
      reconnectDeadline: null,
    });

    // The duel goes on: B names one, then A
    expect(await guess(d.b, d, d.names[0])).toEqual(OK);
    await vi.waitFor(() => expect(namesOf(a)).toContain('roundStarted'));
    expect(await guess(a, d, d.names[1])).toEqual(OK);
  });

  it('forfeits a player who never comes back', async () => {
    const d = await duel();
    const finished = nextEvent<DuelResult>(d.b.socket, 'finished');
    await drop(d.a);

    expect(await finished).toMatchObject({
      outcome: 'forfeit_win',
      isForfeit: true,
    });
    const notices = d.b.events
      .filter((e) => e.event === 'opponentConnection')
      .map((e) => (e.payload as ConnectionState).status);
    expect(notices).toEqual(['reconnecting', 'forfeited']);
    expect(namesOf(d.b).slice(-2)).toEqual(['opponentConnection', 'finished']);
    expect(await ack(d.b, 'queue:enter')).toEqual(OK);
  });

  it('keeps the clock running while a player is away', async () => {
    const d = await duel();
    // B is on turn, and leaves
    await drop(d.b);
    skew += PAST_DEADLINE;
    const lost = nextEvent(d.a.socket, 'lifeLost');
    await guess(d.a, d, MISS);
    expect(await lost).toEqual({ who: 'opponent', lives: 2 });

    const b = await reconnect(d.b);
    await vi.waitFor(() => expect(namesOf(b)).toContain('matchReady'));
    const snapshot = b.events.find((e) => e.event === 'matchReady')
      ?.payload as DuelSession;
    expect(snapshot).toMatchObject({
      you: { lives: 2 },
      opponent: { lives: 3 },
      turn: 'opponent',
    });
  });

  it('hands a second tab the running duel', async () => {
    const d = await duel();
    const replaced = nextEvent(d.a.socket, 'error');
    const a = await reconnect(d.a);

    expect(await replaced).toMatchObject({
      code: 'forbidden',
      message: REPLACED,
    });
    await vi.waitFor(() => expect(namesOf(a)).toEqual(['matchReady']));
    expect(a.events[0].payload).toMatchObject({ sessionId: d.sessionId });

    // B hears nothing, and the duel goes on
    expect(await guess(d.b, d, d.names[0])).toEqual(OK);
    expect(namesOf(d.b)).not.toContain('opponentConnection');
    expect(namesOf(d.b)).not.toContain('finished');
  });
});
