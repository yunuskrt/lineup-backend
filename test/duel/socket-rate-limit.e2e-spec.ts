import { lockoutMessage } from '@/common/rate-limit.guard.js';
import { SOCKET_LIMITS } from '@/common/rate-limits.js';
import type { DuelSession } from '@/contract/duel.js';
import { apiErrorSchema } from '@/contract/envelope.js';
import { type Client, DuelHarness } from '@test/duel/duel-harness.js';
import { nextEvent } from '@test/duel/socket-client.js';

const GUESSES = SOCKET_LIMITS['duel:guess'];
const ENTERS = SOCKET_LIMITS['queue:enter'];
const MISS = 'Zzyzx Qwertyuiop';
const OK = { success: true, data: null };

type Refused = { success: false; error: { code: string; message: string } };

describe('Socket rate limiting (e2e)', () => {
  let h: DuelHarness;

  const player = () => h.client();
  const ack = (p: Client, event: string, ...args: unknown[]) =>
    h.ack(p, event, ...args);

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
    // Back on for this suite only
    h = await DuelHarness.boot({ env: { RATE_LIMITS_ENABLED: true } });
  });

  afterEach(() => h.settle());
  afterAll(() => h.close());

  it('refuses the guess over the limit, and only that player', async () => {
    // A wins the flip, so B names first
    const { a, b, sessionId, match } = await h.pair();
    const { names } = await h.squadOf(match);
    const guess = (p: Client, text: string) =>
      ack(p, 'duel:guess', { sessionId, guess: text });
    const resolved = () => b.events.filter((e) => e.event === 'guessResolved');

    // B is on turn and spends the whole window
    for (let i = 0; i < GUESSES.limit; i += 1) {
      expect(await guess(b, MISS)).toEqual(OK);
    }
    expectLockout(await guess(b, MISS), GUESSES.ttl);
    await vi.waitFor(() => expect(resolved()).toHaveLength(GUESSES.limit));

    // A new socket is the same user: still refused
    const again = await h.reconnect(b);
    await vi.waitFor(() =>
      expect(again.events.map((e) => e.event)).toContain('matchReady'),
    );
    const snapshot = again.events.find((e) => e.event === 'matchReady');
    expect(snapshot?.payload as DuelSession).toMatchObject({
      turn: 'you',
      you: { lives: 3 },
      found: [],
    });
    expectLockout(await guess(again, MISS), GUESSES.ttl);

    // Once the window passes, B names one; A is free
    await new Promise((resolve) => setTimeout(resolve, GUESSES.ttl));
    expect(await guess(again, names[0])).toEqual(OK);
    await vi.waitFor(async () => expect(await guess(a, MISS)).toEqual(OK));
  });

  it('refuses the queue entry over the limit, refused ones counted', async () => {
    const p = await player();
    expect(await ack(p, 'queue:enter')).toEqual(OK);
    for (let i = 1; i < ENTERS.limit; i += 1) {
      expect(await ack(p, 'queue:enter')).toMatchObject({
        success: false,
        error: { code: 'forbidden' },
      });
    }
    expectLockout(await ack(p, 'queue:enter'), ENTERS.ttl);
    // Leaving has its own count
    expect(await ack(p, 'queue:leave')).toEqual(OK);
  });

  it('sends the lockout as an error when no ack was asked', async () => {
    const p = await player();
    for (let i = 0; i < ENTERS.limit; i += 1) {
      await ack(p, 'queue:enter');
    }
    const error = nextEvent(p.socket, 'error');
    p.socket.emit('queue:enter');

    const payload = await error;
    expect(apiErrorSchema.safeParse(payload).success).toBe(true);
    expectLockout({ success: false, error: payload }, ENTERS.ttl);
  });
});
