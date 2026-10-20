import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '@/app.module.js';
import { RANDOM } from '@/common/random.js';
import { loadEnv } from '@/config/load-env.js';
import type { FilterOptions } from '@/contract/catalog.js';
import {
  type CoinFlipResult,
  duelEventSchemas,
  type DuelSession,
} from '@/contract/duel.js';
import type { Filters } from '@/contract/match.js';
import { socketAckSchema } from '@/contract/socket.js';
import { NO_PREFERENCE } from '@/game/coin-flip.js';
import { ConnectionRegistry } from '@/duel/connection-registry.js';
import {
  DUEL_START_MESSAGES,
  MATCHMAKING_MESSAGES,
} from '@/duel/duel-messages.js';
import { FILTER_WINDOW_MS, FLIP_REVEAL_MS } from '@/duel/duel-start.service.js';
import { LineupIoAdapter } from '@/duel/socket.adapter.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import {
  ackOf,
  connectGuest,
  type GuestPlayer,
  nextEvent,
  type Recorded,
  recordEvents,
} from '@test/duel/socket-client.js';

const WINDOW_MS = 1_500;
const REVEAL_MS = 300;
const OK = { success: true, data: null };

type Player = GuestPlayer & { events: Recorded[] };

// Below 0.5 the first to queue wins the flip
let draw = 0.1;

describe('Duel start (e2e)', () => {
  let app: NestExpressApplication;
  let server: Server;
  let url: string;
  let registry: ConnectionRegistry;
  let prisma: PrismaService;
  let options: FilterOptions;
  const guests: string[] = [];
  const players: Player[] = [];

  async function player(): Promise<Player> {
    const guest = await connectGuest(server, url);
    guests.push(guest.id);
    const joined = { ...guest, events: recordEvents(guest.socket) };
    players.push(joined);
    return joined;
  }

  async function ack(p: Player, event: string, ...args: unknown[]) {
    const result = await ackOf(p.socket, event, ...args);
    expect(socketAckSchema.safeParse(result).success).toBe(true);
    return result;
  }

  // A queued first, so A holds seat 0
  async function pair(): Promise<[Player, Player]> {
    const [a, b] = await Promise.all([player(), player()]);
    const aPaired = nextEvent(a.socket, 'paired');
    await ack(a, 'queue:enter');
    await ack(b, 'queue:enter');
    await aPaired;
    return [a, b];
  }

  const submit = (p: Player, filters: Filters) =>
    ack(p, 'filters:submit', filters);
  const names = (p: Player) => p.events.map((e) => e.event);
  const payloadOf = <T>(p: Player, event: string) =>
    p.events.find((e) => e.event === event)?.payload as T;

  // Wait out the reveal and any squad load
  const settled = () => new Promise((resolve) => setTimeout(resolve, 1_500));

  beforeAll(async () => {
    const env = loadEnv();
    if (!env.success) throw new Error('E2E needs a valid .env');
    if (!env.data.MATCH_POOL_INCLUDE_UNSCORED) {
      throw new Error('E2E expects MATCH_POOL_INCLUDE_UNSCORED=true in .env');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FILTER_WINDOW_MS)
      .useValue(WINDOW_MS)
      .overrideProvider(FLIP_REVEAL_MS)
      .useValue(REVEAL_MS)
      .overrideProvider(RANDOM)
      .useValue(() => draw)
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
    const res = await request(server).get('/catalog/filter-options');
    options = res.body.data as FilterOptions;
  });

  beforeEach(() => {
    draw = 0.1;
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

  describe('the happy path', () => {
    it('takes a pair from filters to matchReady', async () => {
      const [a, b] = await pair();
      const aReady = nextEvent<DuelSession>(a.socket, 'matchReady');
      const bReady = nextEvent<DuelSession>(b.socket, 'matchReady');

      expect(await submit(a, NO_PREFERENCE)).toEqual(OK);
      expect(await submit(b, NO_PREFERENCE)).toEqual(OK);
      const [forA, forB] = await Promise.all([aReady, bReady]);

      const lobby = ['filtersUpdated', 'filtersUpdated', 'coinFlip'];
      expect(names(a)).toEqual(['queued', 'paired', ...lobby, 'matchReady']);
      expect(names(b)).toEqual(['queued', 'paired', ...lobby, 'matchReady']);

      const flipA = payloadOf<CoinFlipResult>(a, 'coinFlip');
      const flipB = payloadOf<CoinFlipResult>(b, 'coinFlip');
      expect(flipA.winner).toBe('you');
      expect(flipB.winner).toBe('opponent');
      expect(flipB.filters).toEqual(flipA.filters);

      expect(forB.sessionId).toBe(forA.sessionId);
      expect(forB.match).toEqual(forA.match);
      expect(forB.round).toEqual(forA.round);
      expect(forA.you).toEqual(forB.opponent);
      expect(forA.you).toEqual({ id: a.id, handle: a.handle, lives: 3 });
      // A won the flip, so B names first
      expect(forA.turn).toBe('opponent');
      expect(forB.turn).toBe('you');
      expect(forA.found).toEqual([]);
    });

    it('holds the clock until the flip has shown', async () => {
      const [a, b] = await pair();
      const flipped = nextEvent(a.socket, 'coinFlip');
      const ready = nextEvent<DuelSession>(a.socket, 'matchReady');
      await submit(a, NO_PREFERENCE);
      await submit(b, NO_PREFERENCE);
      await flipped;
      const flippedAt = Date.now();

      const { round } = await ready;
      expect(Date.now() - flippedAt).toBeGreaterThanOrEqual(REVEAL_MS - 20);
      expect(round.endsAt - round.startedAt).toBe(15_000);
    });

    it("applies the winner's set whole", async () => {
      const club = options.clubs[0];
      const [a, b] = await pair();
      const ready = nextEvent<DuelSession>(b.socket, 'matchReady');
      await submit(a, { ...NO_PREFERENCE, clubIds: [club.id] });
      await submit(b, NO_PREFERENCE);

      const { match } = await ready;
      expect([match.home.id, match.away.id]).toContain(club.id);
      expect(payloadOf<CoinFlipResult>(b, 'coinFlip').filters.clubIds).toEqual([
        club.id,
      ]);
    });

    it('sends no squad player before or in matchReady', async () => {
      const [a, b] = await pair();
      const ready = nextEvent<DuelSession>(a.socket, 'matchReady');
      await submit(a, NO_PREFERENCE);
      await submit(b, NO_PREFERENCE);
      const { match } = await ready;

      const lineup = await prisma.lineup.findMany({
        where: { matchTeam: { matchId: match.id } },
        select: { player: { select: { id: true, name: true } } },
      });
      expect(lineup).toHaveLength(22);
      const json = JSON.stringify([...a.events, ...b.events]);
      for (const { player: p } of lineup) {
        expect(json).not.toContain(p.id);
        expect(json).not.toContain(p.name);
      }
    });
  });

  describe('refusals', () => {
    const closed = {
      success: false,
      error: {
        code: 'forbidden',
        message: DUEL_START_MESSAGES.filtersClosed,
        retryAfterMs: null,
      },
    };

    it('refuses a second submit', async () => {
      const [a] = await pair();
      await submit(a, NO_PREFERENCE);
      expect(await submit(a, NO_PREFERENCE)).toEqual(closed);
    });

    it('refuses a player in no duel', async () => {
      const lone = await player();
      expect(await submit(lone, NO_PREFERENCE)).toEqual(closed);
    });

    it('refuses an era running backwards', async () => {
      const [a] = await pair();
      const result = await submit(a, {
        ...NO_PREFERENCE,
        era: { from: 2010, to: 2005 },
      });
      expect(result).toMatchObject({
        success: false,
        error: { code: 'invalid_input' },
      });
    });

    it('refuses filters that empty the pool, before the flip', async () => {
      const [a, b] = await pair();
      const result = await submit(a, {
        competitionIds: [options.competitions[0].id],
        clubIds: [],
        era: { from: 2000, to: 2000 },
      });
      expect(result).toMatchObject({
        success: false,
        error: { code: 'empty_pool', emptyBecause: expect.any(String) },
      });
      expect(names(b)).not.toContain('filtersUpdated');
    });
  });

  describe('the filter window', () => {
    it('flips without the player who never submitted', async () => {
      draw = 0.9;
      const [a, b] = await pair();
      const flipped = nextEvent<CoinFlipResult>(b.socket, 'coinFlip');
      const ready = nextEvent(b.socket, 'matchReady');
      await submit(a, { ...NO_PREFERENCE, clubIds: [options.clubs[0].id] });

      // B won the flip with no set: no preference
      expect(await flipped).toEqual({
        winner: 'you',
        filters: NO_PREFERENCE,
      });
      await ready;
      expect(names(b)).toEqual([
        'queued',
        'paired',
        'filtersUpdated',
        'filtersUpdated',
        'coinFlip',
        'matchReady',
      ]);
    });
  });

  describe('drops', () => {
    const left = {
      code: 'session_over',
      message: MATCHMAKING_MESSAGES.opponentLeft,
      retryAfterMs: null,
    };

    it('ends a pair still choosing filters', async () => {
      const [a, b] = await pair();
      const error = nextEvent(b.socket, 'error');
      a.socket.close();
      expect(await error).toEqual(left);
      expect(await ack(b, 'queue:enter')).toEqual(OK);
    });

    it('ends a pair during the flip, with no matchReady', async () => {
      const [a, b] = await pair();
      const flipped = nextEvent(b.socket, 'coinFlip');
      const error = nextEvent(b.socket, 'error');
      await submit(a, NO_PREFERENCE);
      await submit(b, NO_PREFERENCE);
      await flipped;
      a.socket.close();

      expect(await error).toEqual(left);
      await settled();
      expect(names(b)).not.toContain('matchReady');
    });
  });
});
