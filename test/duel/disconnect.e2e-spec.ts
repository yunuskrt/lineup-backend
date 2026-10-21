import { GRACE_MS, ROUND_MS } from '@/contract/constants.js';
import type {
  ConnectionState,
  DuelResult,
  DuelSession,
} from '@/contract/duel.js';
import { REPLACED } from '@/duel/duel.gateway.js';
import { type Client, DuelHarness } from '@test/duel/duel-harness.js';
import { nextEvent } from '@test/duel/socket-client.js';

const WINDOW_MS = 2_000;
const PAST_DEADLINE = ROUND_MS + GRACE_MS + 100;
const OK = { success: true, data: null };
const MISS = 'Zzyzx Qwertyuiop';

type Player = Client;
type Duel = { a: Player; b: Player; sessionId: string; names: string[] };

describe('Disconnect handling (e2e)', () => {
  let h: DuelHarness;

  const reconnect = (p: Player) => h.reconnect(p);
  const ack = (p: Player, event: string, ...args: unknown[]) =>
    h.ack(p, event, ...args);
  const drop = (p: Player) => h.drop(p);

  // A wins the flip, so B names first
  async function duel(): Promise<Duel> {
    const { a, b, sessionId, match } = await h.pair();
    const { names } = await h.squadOf(match);
    return { a, b, sessionId, names };
  }

  const guess = (p: Player, d: Duel, text: string) =>
    ack(p, 'duel:guess', { sessionId: d.sessionId, guess: text });
  const namesOf = (p: Player) => p.events.map((e) => e.event);

  beforeAll(async () => {
    h = await DuelHarness.boot({ windowMs: WINDOW_MS });
  });

  beforeEach(() => h.resetClock());
  afterEach(() => h.settle());
  afterAll(() => h.close());

  it('resumes a player who comes back inside the window', async () => {
    const d = await duel();
    const away = nextEvent<ConnectionState>(d.b.socket, 'opponentConnection');
    await drop(d.a);

    const notice = await away;
    expect(notice.status).toBe('reconnecting');
    const ahead = (notice.reconnectDeadline ?? 0) - h.now();
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
    h.skew(PAST_DEADLINE);
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
