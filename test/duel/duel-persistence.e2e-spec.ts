import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '@/app.module.js';
import { CLOCK } from '@/common/clock.js';
import { RANDOM } from '@/common/random.js';
import { loadEnv } from '@/config/load-env.js';
import { GRACE_MS, ROUND_MS } from '@/contract/constants.js';
import { type DuelResult, type DuelSession } from '@/contract/duel.js';
import { historyPageSchema, profileSchema } from '@/contract/profile.js';
import { NO_PREFERENCE } from '@/game/coin-flip.js';
import { ConnectionRegistry } from '@/duel/connection-registry.js';
import { DuelPersistenceService } from '@/duel/duel-persistence.service.js';
import { RECONNECT_WINDOW } from '@/duel/duel-play.service.js';
import { FLIP_REVEAL_MS } from '@/duel/duel-start.service.js';
import { LineupIoAdapter } from '@/duel/socket.adapter.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import {
  ackOf,
  connectGuest,
  type GuestPlayer,
  nextEvent,
  removeGuests,
} from '@test/duel/socket-client.js';

const WINDOW_MS = 1_000;
const PAST_DEADLINE = ROUND_MS + GRACE_MS + 100;
const MISS = 'Zzyzx Qwertyuiop';

type Duel = {
  a: GuestPlayer;
  b: GuestPlayer;
  sessionId: string;
  names: string[];
};

// A wins the flip, so B (seat 1) names first
const DRAW = 0.1;
let skew = 0;

describe('Duel persistence (e2e)', () => {
  let app: NestExpressApplication;
  let server: Server;
  let url: string;
  let registry: ConnectionRegistry;
  let persistence: DuelPersistenceService;
  let prisma: PrismaService;
  const guests: GuestPlayer[] = [];

  async function player(): Promise<GuestPlayer> {
    const guest = await connectGuest(server, url);
    guests.push(guest);
    return guest;
  }

  async function duel(): Promise<Duel> {
    const [a, b] = await Promise.all([player(), player()]);
    const aPaired = nextEvent(a.socket, 'paired');
    await ackOf(a.socket, 'queue:enter');
    await ackOf(b.socket, 'queue:enter');
    await aPaired;

    const aReady = nextEvent<DuelSession>(a.socket, 'matchReady');
    const bReady = nextEvent(b.socket, 'matchReady');
    await ackOf(a.socket, 'filters:submit', NO_PREFERENCE);
    await ackOf(b.socket, 'filters:submit', NO_PREFERENCE);
    const [{ sessionId, match }] = await Promise.all([aReady, bReady]);

    const lineups = await prisma.lineup.findMany({
      where: { matchTeam: { matchId: match.id, side: match.side } },
      select: { player: { select: { name: true } } },
      orderBy: { slot: 'asc' },
    });
    return { a, b, sessionId, names: lineups.map((row) => row.player.name) };
  }

  const guess = (p: GuestPlayer, d: Duel, text: string) =>
    ackOf(p.socket, 'duel:guess', { sessionId: d.sessionId, guess: text });

  // The write runs after finished
  async function saved(d: Duel) {
    await vi.waitFor(() =>
      expect(persistence.isPending(d.sessionId)).toBe(false),
    );
    return prisma.gameSession.findUnique({
      where: { id: d.sessionId },
      select: {
        mode: true,
        side: true,
        status: true,
        soloEndReason: true,
        participants: {
          orderBy: { seat: 'asc' },
          select: {
            id: true,
            userId: true,
            seat: true,
            livesRemaining: true,
            duelOutcome: true,
          },
        },
        rounds: {
          orderBy: { number: 'asc' },
          select: {
            number: true,
            participantId: true,
            endReason: true,
            guesses: { select: { text: true, outcome: true } },
          },
        },
      },
    });
  }

  async function historyOf(p: GuestPlayer) {
    const res = await request(server)
      .get('/profile/history')
      .set('Cookie', p.cookie);
    return historyPageSchema.parse(res.body.data).entries;
  }

  async function statsOf(p: GuestPlayer) {
    const res = await request(server).get('/profile').set('Cookie', p.cookie);
    return profileSchema.parse(res.body.data).stats;
  }

  async function finish(p: GuestPlayer, ending: () => Promise<unknown>) {
    const finished = nextEvent<DuelResult>(p.socket, 'finished');
    await ending();
    return finished;
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
    persistence = app.get(DuelPersistenceService);
    prisma = app.get(PrismaService);
  });

  beforeEach(() => {
    skew = 0;
  });

  afterEach(async () => {
    for (const p of guests) p.socket.close();
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

  it('saves a duel lost on lives for both players', async () => {
    const d = await duel();
    // Five expiries, alternating: B runs out first
    skew += PAST_DEADLINE * 5;
    const result = await finish(d.a, () => guess(d.a, d, MISS));
    expect(result).toMatchObject({ outcome: 'win', isForfeit: false });

    const session = await saved(d);
    expect(session?.participants).toEqual([
      expect.objectContaining({
        userId: d.a.id,
        seat: 0,
        livesRemaining: 1,
        duelOutcome: 'win',
      }),
      expect.objectContaining({
        userId: d.b.id,
        seat: 1,
        livesRemaining: 0,
        duelOutcome: 'loss',
      }),
    ]);

    const [aEntry] = await historyOf(d.a);
    expect(aEntry).toMatchObject({
      id: d.sessionId,
      mode: 'duel',
      outcome: 'win',
      livesRemaining: 1,
      foundCount: 0,
    });
    expect(await historyOf(d.b)).toEqual([
      expect.objectContaining({
        mode: 'duel',
        outcome: 'loss',
        livesRemaining: 0,
      }),
    ]);
    expect(await statsOf(d.a)).toMatchObject({ played: 1, wins: 1, losses: 0 });
    expect(await statsOf(d.b)).toMatchObject({ played: 1, wins: 0, losses: 1 });
  });

  it('saves a draw once, with every row as played', async () => {
    const d = await duel();
    // B misses once, then they alternate names
    await guess(d.b, d, MISS);
    const result = await finish(d.a, async () => {
      for (const [index, name] of d.names.entries()) {
        await guess(index % 2 ? d.a : d.b, d, name);
      }
    });
    expect(result).toMatchObject({ outcome: 'draw' });

    const session = await saved(d);
    expect(session).toMatchObject({
      mode: 'duel',
      status: 'over',
      soloEndReason: null,
    });
    const [seatA, seatB] = session!.participants;
    expect(session!.participants.map((p) => p.duelOutcome)).toEqual([
      'draw',
      'draw',
    ]);
    expect(session!.rounds).toHaveLength(11);
    session!.rounds.forEach((round, index) => {
      expect(round.participantId).toBe(index % 2 ? seatA.id : seatB.id);
      expect(round.endReason).toBe('found');
    });
    expect(session!.rounds[0].guesses).toEqual([
      { text: MISS, outcome: 'not_in_xi' },
      { text: d.names[0], outcome: 'correct_new' },
    ]);

    expect(await historyOf(d.a)).toEqual([
      expect.objectContaining({ outcome: 'draw', foundCount: 11 }),
    ]);
    // Each counts only their own guesses
    expect(await statsOf(d.a)).toMatchObject({ draws: 1, accuracy: 1 });
    expect(await statsOf(d.b)).toMatchObject({ draws: 1, accuracy: 6 / 7 });

    await persistence.retry();
    expect(await prisma.gameSession.count({ where: { id: d.sessionId } })).toBe(
      1,
    );
    expect(await statsOf(d.b)).toMatchObject({ played: 1, draws: 1 });
  });

  it('saves a forfeit as a loss and a forfeit win', async () => {
    const d = await duel();
    const result = await finish(d.b, () => ackOf(d.a.socket, 'duel:forfeit'));
    expect(result).toMatchObject({ outcome: 'forfeit_win', isForfeit: true });

    await saved(d);
    expect(await historyOf(d.a)).toEqual([
      expect.objectContaining({ outcome: 'loss' }),
    ]);
    expect(await historyOf(d.b)).toEqual([
      expect.objectContaining({ outcome: 'forfeit_win' }),
    ]);
    expect(await statsOf(d.b)).toMatchObject({ wins: 1 });
  });

  it('saves a player who never comes back as a loss', async () => {
    const d = await duel();
    const result = await finish(d.b, async () => {
      d.a.socket.close();
    });
    expect(result).toMatchObject({ outcome: 'forfeit_win' });

    await saved(d);
    expect(await historyOf(d.a)).toEqual([
      expect.objectContaining({ outcome: 'loss', livesRemaining: 3 }),
    ]);
    expect(await statsOf(d.a)).toMatchObject({ played: 1, losses: 1 });
  });

  it('saves nothing for a pair who part before the match', async () => {
    const [a, b] = await Promise.all([player(), player()]);
    const paired = nextEvent(b.socket, 'paired');
    await ackOf(a.socket, 'queue:enter');
    await ackOf(b.socket, 'queue:enter');
    await paired;

    const left = nextEvent(b.socket, 'error');
    a.socket.close();
    await left;

    expect(
      await prisma.gameParticipant.count({
        where: { userId: { in: [a.id, b.id] } },
      }),
    ).toBe(0);
    expect(await historyOf(b)).toEqual([]);
  });
});
