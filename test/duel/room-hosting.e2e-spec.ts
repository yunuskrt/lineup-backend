import { ROOM_MESSAGES } from '@/duel/duel-messages.js';
import { NO_PREFERENCE } from '@/game/coin-flip.js';
import { DuelHarness } from '@test/duel/duel-harness.js';
import { nextEvent } from '@test/duel/socket-client.js';

const REFUSED = {
  success: false,
  error: {
    code: 'forbidden',
    message: ROOM_MESSAGES.proToHost,
    retryAfterMs: null,
    reason: 'pro_required',
  },
};

describe('Room hosting gate, switch on (e2e)', () => {
  let h: DuelHarness;

  beforeAll(async () => {
    h = await DuelHarness.boot({ env: { PRO_ENABLED: true } });
  });

  afterEach(() => h.settle());
  afterAll(() => h.close());

  it('refuses a Free host with pro_required, storing nothing', async () => {
    const a = await h.client();

    expect(await h.ack(a, 'room:create', NO_PREFERENCE)).toEqual(REFUSED);

    // No room held: the queue is open to them
    expect(await h.ack(a, 'queue:enter')).toEqual({
      success: true,
      data: null,
    });
    expect(await h.ack(a, 'queue:leave')).toEqual({
      success: true,
      data: null,
    });
    expect(a.events.map((e) => e.event)).not.toContain('roomCreated');
  });

  it('reads the tier fresh at the command, not at the handshake', async () => {
    const a = await h.client();
    await h.setTier(a, 'pro');

    const code = await h.createRoom(a);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(await h.ack(a, 'room:leave')).toEqual({ success: true, data: null });

    await h.setTier(a, 'free');
    expect(await h.ack(a, 'room:create', NO_PREFERENCE)).toEqual(REFUSED);
  });

  it('keeps an open room when its host drops to Free', async () => {
    const [a, b] = await Promise.all([h.client('pro'), h.client()]);
    const code = await h.createRoom(a);
    await h.setTier(a, 'free');

    const aReady = nextEvent(a.socket, 'matchReady');
    const bReady = nextEvent(b.socket, 'matchReady');
    expect(await h.ack(b, 'room:join', { code })).toEqual({
      success: true,
      data: null,
    });
    await Promise.all([aReady, bReady]);

    const finished = nextEvent(b.socket, 'finished');
    await h.ack(a, 'duel:forfeit');
    expect(await finished).toMatchObject({ outcome: 'forfeit_win' });
  });
});

describe('Room hosting gate, switch off (e2e)', () => {
  let h: DuelHarness;

  beforeAll(async () => {
    h = await DuelHarness.boot({ env: { PRO_ENABLED: false } });
  });

  afterEach(() => h.settle());
  afterAll(() => h.close());

  it('lets a stored-free user open a room', async () => {
    const a = await h.client('free');

    const code = await h.createRoom(a);

    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(await h.ack(a, 'room:leave')).toEqual({ success: true, data: null });
  });
});
