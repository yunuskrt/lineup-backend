import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '@/app.module.js';
import { CLOCK } from '@/common/clock.js';
import { RANDOM } from '@/common/random.js';
import { loadEnv } from '@/config/load-env.js';
import { GRACE_MS, ROUND_MS } from '@/contract/constants.js';
import {
  type DuelResult,
  duelEventSchemas,
  type DuelSession,
} from '@/contract/duel.js';
import type { DuelFoundPlayer } from '@/contract/player.js';
import { socketAckSchema } from '@/contract/socket.js';
import { NO_PREFERENCE } from '@/game/coin-flip.js';
import { ConnectionRegistry } from '@/duel/connection-registry.js';
import { DUEL_PLAY_MESSAGES } from '@/duel/duel-messages.js';
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
  removeGuests,
} from '@test/duel/socket-client.js';

const OK = { success: true, data: null };
const PAST_DEADLINE = ROUND_MS + GRACE_MS + 100;
// Far from any squad name
const MISS = 'Zzyzx Qwertyuiop';

type Player = GuestPlayer & { events: Recorded[] };
type Duel = {
  a: Player;
  b: Player;
  sessionId: string;
  // The XI both name, in slot order
  names: string[];
  // Every player in the match, both sides
  everyone: string[];
};

// A wins the flip, so B names first
const DRAW = 0.1;
// The server's clock runs ahead by this much
let skew = 0;

const refused = (code: string, message: string) => ({
  success: false,
  error: { code, message, retryAfterMs: null },
});

describe('Duel round loop (e2e)', () => {
  let app: NestExpressApplication;
  let server: Server;
  let url: string;
  let registry: ConnectionRegistry;
  let prisma: PrismaService;
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
      where: { matchTeam: { matchId: match.id } },
      select: {
        slot: true,
        matchTeam: { select: { side: true } },
        player: { select: { name: true } },
      },
      orderBy: { slot: 'asc' },
    });
    const names = lineups
      .filter((row) => row.matchTeam.side === match.side)
      .map((row) => row.player.name);
    const everyone = lineups.map((row) => row.player.name);
    return { a, b, sessionId, names, everyone };
  }

  const guess = (p: Player, d: Duel, text: string) =>
    ack(p, 'duel:guess', { sessionId: d.sessionId, guess: text });

  // Events since matchReady
  const playOf = (p: Player) => {
    const start = p.events.findIndex((e) => e.event === 'matchReady');
    return p.events.slice(start + 1);
  };
  const namesOf = (p: Player) => playOf(p).map((e) => e.event);
  const lastOf = <T>(p: Player, event: string) =>
    playOf(p)
      .filter((e) => e.event === event)
      .at(-1)?.payload as T;

  beforeAll(async () => {
    const env = loadEnv();
    if (!env.success) throw new Error('E2E needs a valid .env');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FILTER_WINDOW_MS)
      .useValue(5_000)
      .overrideProvider(FLIP_REVEAL_MS)
      .useValue(100)
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
    await removeGuests(prisma, guests);
    await app.close();
  });

  describe('a guess', () => {
    it('reveals a correct name to both and hands over the turn', async () => {
      const d = await duel();
      const aRound = nextEvent<DuelSession>(d.a.socket, 'roundStarted');
      expect(await guess(d.b, d, d.names[0])).toEqual(OK);

      // The guesser's events arrive before the ack
      expect(namesOf(d.b)).toEqual([
        'guessResolved',
        'playerRevealed',
        'turnChanged',
        'roundStarted',
      ]);
      expect(lastOf(d.b, 'guessResolved')).toMatchObject({
        outcome: 'correct_new',
        player: { name: d.names[0] },
      });
      expect(lastOf(d.b, 'roundStarted')).toMatchObject({ turn: 'opponent' });

      expect((await aRound).turn).toBe('you');
      expect(namesOf(d.a)).toEqual([
        'playerRevealed',
        'turnChanged',
        'roundStarted',
      ]);
      expect(lastOf<DuelFoundPlayer>(d.a, 'playerRevealed')).toMatchObject({
        name: d.names[0],
        foundBy: 'opponent',
      });
    });

    it('answers a miss and an already-found name to the guesser only', async () => {
      const d = await duel();
      expect(await guess(d.b, d, MISS)).toEqual(OK);
      expect(lastOf(d.b, 'guessResolved')).toEqual({ outcome: 'not_in_xi' });

      const aRevealed = nextEvent(d.a.socket, 'roundStarted');
      await guess(d.b, d, d.names[0]);
      await aRevealed;
      // A saw nothing of B's miss
      expect(namesOf(d.a)[0]).toBe('playerRevealed');

      expect(await guess(d.a, d, d.names[0])).toEqual(OK);
      expect(lastOf(d.a, 'guessResolved')).toMatchObject({
        outcome: 'already_found',
      });
      expect(lastOf<DuelSession>(d.a, 'roundStarted').turn).toBe('you');
    });

    it('refuses a guess out of turn', async () => {
      const d = await duel();
      expect(await guess(d.a, d, d.names[0])).toEqual(
        refused('forbidden', DUEL_PLAY_MESSAGES.waitTurn),
      );
      expect(namesOf(d.a)).toEqual([]);
    });

    it('refuses a guess for another duel', async () => {
      const d = await duel();
      const result = await ack(d.b, 'duel:guess', {
        sessionId: 'not-this-duel',
        guess: d.names[0],
      });
      expect(result).toEqual(
        refused('invalid_input', DUEL_PLAY_MESSAGES.otherDuel),
      );
    });

    it('never sends the guess text or an unrevealed player', async () => {
      const d = await duel();
      await guess(d.b, d, MISS);
      const aRound = nextEvent(d.a.socket, 'roundStarted');
      await guess(d.b, d, d.names[0]);
      await aRound;

      const json = JSON.stringify([...d.a.events, ...d.b.events]);
      expect(json).not.toContain(MISS);
      for (const name of d.everyone.filter((n) => n !== d.names[0])) {
        expect(json).not.toContain(name);
      }
    });
  });

  describe('the clock', () => {
    it('costs the player on turn a life once the round runs out', async () => {
      const d = await duel();
      const aRound = nextEvent<DuelSession>(d.a.socket, 'roundStarted');
      skew += PAST_DEADLINE;

      // Any input catches the clock up first
      expect(await guess(d.a, d, d.names[0])).toEqual(
        refused('session_over', DUEL_PLAY_MESSAGES.roundOver),
      );
      expect(namesOf(d.a)).toEqual(['lifeLost', 'turnChanged', 'roundStarted']);
      expect(lastOf(d.a, 'lifeLost')).toEqual({ who: 'opponent', lives: 2 });
      expect(await aRound).toMatchObject({
        turn: 'you',
        opponent: { lives: 2 },
      });
      await vi.waitFor(() =>
        expect(lastOf(d.b, 'lifeLost')).toEqual({ who: 'you', lives: 2 }),
      );
    });

    it(
      'fires by itself when nobody sends anything',
      async () => {
        const d = await duel();
        const round = nextEvent<DuelSession>(d.b.socket, 'roundStarted');
        expect(await round).toMatchObject({
          turn: 'opponent',
          you: { lives: 2 },
        });
        expect(namesOf(d.b)).toEqual([
          'lifeLost',
          'turnChanged',
          'roundStarted',
        ]);
        expect(lastOf(d.b, 'lifeLost')).toEqual({ who: 'you', lives: 2 });
      },
      ROUND_MS + 15_000,
    );
  });

  describe('the end', () => {
    it('runs a player out of lives: loss and win', async () => {
      const d = await duel();
      const finished = nextEvent<DuelResult>(d.a.socket, 'finished');
      for (const name of d.names.slice(0, 2)) {
        // B times out, then A names one
        skew += PAST_DEADLINE;
        await guess(d.a, d, MISS);
        expect(await guess(d.a, d, name)).toEqual(OK);
      }
      skew += PAST_DEADLINE;
      expect(await guess(d.a, d, MISS)).toEqual(
        refused('session_over', DUEL_PLAY_MESSAGES.notRunning),
      );

      expect(await finished).toMatchObject({
        outcome: 'win',
        isForfeit: false,
        you: { lives: 3 },
        opponent: { lives: 0 },
      });
      await vi.waitFor(() =>
        expect(lastOf(d.b, 'finished')).toMatchObject({ outcome: 'loss' }),
      );
      expect(await ack(d.a, 'queue:enter')).toEqual(OK);
    });

    it('ends in a draw once all 11 are named', async () => {
      const d = await duel();
      const finished = nextEvent<DuelResult>(d.a.socket, 'finished');
      for (const [index, name] of d.names.entries()) {
        // B started, so B names the even slots
        const p = index % 2 === 0 ? d.b : d.a;
        expect(await guess(p, d, name)).toEqual(OK);
      }

      const result = await finished;
      expect(result).toMatchObject({ outcome: 'draw', isForfeit: false });
      expect(result.found).toHaveLength(11);
      expect(lastOf(d.b, 'finished')).toMatchObject({ outcome: 'draw' });
      expect(namesOf(d.b).slice(-3)).toEqual([
        'guessResolved',
        'playerRevealed',
        'finished',
      ]);
    });

    it('forfeits: loss for the forfeiter, forfeit_win for the other', async () => {
      const d = await duel();
      const finished = nextEvent<DuelResult>(d.b.socket, 'finished');
      expect(await ack(d.a, 'duel:forfeit')).toEqual(OK);

      expect(lastOf(d.a, 'finished')).toMatchObject({
        outcome: 'loss',
        isForfeit: true,
      });
      expect(await finished).toMatchObject({
        outcome: 'forfeit_win',
        isForfeit: true,
      });
      expect(await ack(d.a, 'duel:forfeit')).toEqual(
        refused('forbidden', DUEL_PLAY_MESSAGES.noDuel),
      );
    });
  });
});
