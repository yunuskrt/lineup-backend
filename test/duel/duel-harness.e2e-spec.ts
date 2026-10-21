import request from 'supertest';
import { GRACE_MS, ROUND_MS } from '@/contract/constants.js';
import type { DuelOutcome, DuelResult, DuelSession } from '@/contract/duel.js';
import type { DuelFoundPlayer } from '@/contract/player.js';
import { historyPageSchema } from '@/contract/profile.js';
import { DuelPersistenceService } from '@/duel/duel-persistence.service.js';
import {
  type Client,
  DuelHarness,
  type PairedDuel,
  type Squad,
} from '@test/duel/duel-harness.js';
import type { Recorded } from '@test/duel/socket-client.js';

const PAST_DEADLINE = ROUND_MS + GRACE_MS + 100;
const MISS = 'Zzyzx Qwertyuiop';
const WINDOW_MS = 1_000;
// Long enough for a stray event to show up
const QUIET_MS = 300;

const AUTHORITATIVE = ['matchReady', 'turnChanged', 'roundStarted'];
// A forfeit's loss pairs with forfeit_win
function pairedOutcome(outcome: DuelOutcome, isForfeit: boolean): DuelOutcome {
  if (outcome === 'loss') return isForfeit ? 'forfeit_win' : 'win';
  return outcome === 'draw' ? 'draw' : 'loss';
}

type Game = PairedDuel & { squad: Squad };

// What each client hears, as event names
const correct = (isGuesser: boolean, isLast = false) => [
  ...(isGuesser ? ['guessResolved'] : []),
  'playerRevealed',
  ...(isLast ? ['finished'] : ['turnChanged', 'roundStarted']),
];
const miss = (isGuesser: boolean) => (isGuesser ? ['guessResolved'] : []);
const expiry = (isLast = false) => [
  'lifeLost',
  ...(isLast ? ['finished'] : ['turnChanged', 'roundStarted']),
];

// Events from matchReady on, matchReady included
function playOf(client: Client) {
  const start = client.events.findIndex((e) => e.event === 'matchReady');
  return start < 0 ? [] : client.events.slice(start);
}
const namesOf = (client: Client) => playOf(client).map((e) => e.event);
const finishedOf = (client: Client) =>
  client.events.find((e) => e.event === 'finished')?.payload as DuelResult;

const swapFound = (found: readonly DuelFoundPlayer[]) =>
  found.map((player) => ({
    ...player,
    foundBy: player.foundBy === 'you' ? 'opponent' : 'you',
  }));

function expectMirror(a: DuelSession, b: DuelSession) {
  expect(b.sessionId).toBe(a.sessionId);
  expect(b.match).toEqual(a.match);
  expect(b.round).toEqual(a.round);
  expect(b.you).toEqual(a.opponent);
  expect(b.opponent).toEqual(a.you);
  expect(b.turn).toBe(a.turn === 'you' ? 'opponent' : 'you');
  expect(b.found).toEqual(swapFound(a.found));
}

// One moment, two views: actors swapped
function expectMirrored(a: Client, b: Client) {
  const pick = (client: Client) =>
    playOf(client).filter((e) => AUTHORITATIVE.includes(e.event));
  const [aViews, bViews] = [pick(a), pick(b)];
  const shared = Math.min(aViews.length, bViews.length);
  expect(shared).toBeGreaterThan(0);
  for (let i = 0; i < shared; i += 1) {
    expect(bViews[i].event).toBe(aViews[i].event);
    expectMirror(
      aViews[i].payload as DuelSession,
      bViews[i].payload as DuelSession,
    );
  }
}

function expectMirroredResults(a: DuelResult, b: DuelResult) {
  expect(b.outcome).toBe(pairedOutcome(a.outcome, a.isForfeit));
  expect(b.isForfeit).toBe(a.isForfeit);
  expect(b.match).toEqual(a.match);
  expect(b.you).toEqual(a.opponent);
  expect(b.opponent).toEqual(a.you);
  expect(b.found).toEqual(swapFound(a.found));
}

// What an event reveals, by player id
function revealedBy({ event, payload }: Recorded): string | null {
  if (event === 'playerRevealed') return (payload as DuelFoundPlayer).id;
  const result = payload as { outcome?: string; player?: { id: string } };
  if (event === 'guessResolved' && result.outcome === 'correct_new') {
    return result.player?.id ?? null;
  }
  return null;
}

// HC 2: an unrevealed starter is never in a payload
function expectNoLeak(client: Client, squad: Squad) {
  const revealed = new Set<string>();
  for (const recorded of client.events) {
    const id = revealedBy(recorded);
    if (id) revealed.add(id);
    const json = JSON.stringify(recorded.payload);
    squad.ids.forEach((playerId, slot) => {
      if (revealed.has(playerId)) return;
      expect(json, recorded.event).not.toContain(playerId);
      expect(json, recorded.event).not.toContain(squad.names[slot]);
    });
  }
}

// Server-timed 15 s rounds, never out of order
function expectServerClock(client: Client) {
  const rounds = playOf(client)
    .filter((e) => e.event === 'matchReady' || e.event === 'roundStarted')
    .map((e) => (e.payload as DuelSession).round);
  for (const [index, round] of rounds.entries()) {
    expect(round.endsAt - round.startedAt).toBe(ROUND_MS);
    if (index > 0) {
      expect(round.startedAt).toBeGreaterThanOrEqual(
        rounds[index - 1].startedAt,
      );
    }
  }
}

describe('Duel harness: four whole games (e2e)', () => {
  let h: DuelHarness;

  async function game(): Promise<Game> {
    const duel = await h.pair();
    const squad = await h.squadOf(duel.match);
    // The leak check is only as good as this list
    expect(squad.ids).toHaveLength(11);
    return { ...duel, squad };
  }

  const guess = (client: Client, g: Game, text: string) =>
    h.ack(client, 'duel:guess', { sessionId: g.sessionId, guess: text });

  // Waits for finished, then for any straggler
  async function ended(...clients: Client[]) {
    await vi.waitFor(() => {
      for (const client of clients) expect(finishedOf(client)).toBeDefined();
    });
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
  }

  async function outcomeIn(client: Client, sessionId: string) {
    const res = await request(h.server)
      .get('/profile/history')
      .set('Cookie', client.cookie);
    const { entries } = historyPageSchema.parse(res.body.data);
    return entries.find((entry) => entry.id === sessionId)?.outcome;
  }

  async function expectHistory(g: Game, ...clients: Client[]) {
    const persistence = h.app.get(DuelPersistenceService);
    await vi.waitFor(() =>
      expect(persistence.isPending(g.sessionId)).toBe(false),
    );
    for (const client of clients) {
      expect(await outcomeIn(client, g.sessionId)).toBe(
        finishedOf(client).outcome,
      );
    }
  }

  // Every check that holds for every game
  function expectContract(g: Game) {
    expectMirrored(g.a, g.b);
    for (const client of [g.a, g.b]) {
      expectNoLeak(client, g.squad);
      expectServerClock(client);
    }
  }

  beforeAll(async () => {
    h = await DuelHarness.boot({ windowMs: WINDOW_MS });
  });

  beforeEach(() => h.resetClock());
  afterEach(() => h.settle());
  afterAll(() => h.close());

  it('plays a duel lost on lives: a win and a loss', async () => {
    const g = await game();
    const [first, second] = g.squad.names;
    // b names, a misses then names: b's turn
    await guess(g.b, g, first);
    await guess(g.a, g, MISS);
    await guess(g.a, g, second);
    // Expiries go b, a, b, a, b: b runs out
    h.skew(PAST_DEADLINE * 5);
    await guess(g.a, g, MISS);
    await ended(g.a, g.b);

    const tail = [
      ...expiry(),
      ...expiry(),
      ...expiry(),
      ...expiry(),
      ...expiry(true),
    ];
    expect(namesOf(g.b)).toEqual([
      'matchReady',
      ...correct(true),
      ...correct(false),
      ...tail,
    ]);
    expect(namesOf(g.a)).toEqual([
      'matchReady',
      ...correct(false),
      ...miss(true),
      ...correct(true),
      ...tail,
    ]);

    const [aResult, bResult] = [finishedOf(g.a), finishedOf(g.b)];
    expect(aResult).toMatchObject({
      outcome: 'win',
      isForfeit: false,
      you: { lives: 1 },
    });
    expect(bResult).toMatchObject({ outcome: 'loss', you: { lives: 0 } });
    expect(aResult.found).toHaveLength(2);
    expectMirroredResults(aResult, bResult);
    expectContract(g);
    await expectHistory(g, g.a, g.b);
  });

  it('plays a draw: all 11 named between them', async () => {
    const g = await game();
    await guess(g.b, g, MISS);
    for (const [index, name] of g.squad.names.entries()) {
      await guess(index % 2 ? g.a : g.b, g, name);
    }
    await ended(g.a, g.b);

    const heard = (isB: boolean) =>
      g.squad.names.flatMap((_, index) => {
        const isGuesser = (index % 2 === 0) === isB;
        return correct(isGuesser, index === g.squad.names.length - 1);
      });
    expect(namesOf(g.b)).toEqual(['matchReady', ...miss(true), ...heard(true)]);
    expect(namesOf(g.a)).toEqual(['matchReady', ...heard(false)]);

    const [aResult, bResult] = [finishedOf(g.a), finishedOf(g.b)];
    expect(aResult).toMatchObject({ outcome: 'draw', isForfeit: false });
    expect(aResult.found).toHaveLength(11);
    expect(aResult.you.lives).toBe(3);
    expectMirroredResults(aResult, bResult);
    expectContract(g);
    await expectHistory(g, g.a, g.b);
  });

  it('plays a forfeit sent as a command', async () => {
    const g = await game();
    // On b's turn: a forfeit needs no turn
    expect(await h.ack(g.a, 'duel:forfeit')).toEqual({
      success: true,
      data: null,
    });
    await ended(g.a, g.b);

    expect(namesOf(g.a)).toEqual(['matchReady', 'finished']);
    expect(namesOf(g.b)).toEqual(['matchReady', 'finished']);
    const [aResult, bResult] = [finishedOf(g.a), finishedOf(g.b)];
    expect(aResult).toMatchObject({ outcome: 'loss', isForfeit: true });
    expect(bResult).toMatchObject({ outcome: 'forfeit_win', isForfeit: true });
    expectMirroredResults(aResult, bResult);
    expectContract(g);
    await expectHistory(g, g.a, g.b);
  });

  it('plays a forfeit by a player who never comes back', async () => {
    const g = await game();
    const before = g.b.events.length;
    await h.drop(g.b);
    await ended(g.a);

    expect(namesOf(g.a)).toEqual([
      'matchReady',
      'opponentConnection',
      'opponentConnection',
      'finished',
    ]);
    const notices = playOf(g.a)
      .filter((e) => e.event === 'opponentConnection')
      .map((e) => e.payload);
    expect(notices).toEqual([
      { status: 'reconnecting', reconnectDeadline: expect.any(Number) },
      { status: 'forfeited', reconnectDeadline: null },
    ]);
    expect(finishedOf(g.a)).toMatchObject({
      outcome: 'forfeit_win',
      isForfeit: true,
    });
    // b's socket is gone: it heard nothing more
    expect(g.b.events).toHaveLength(before);
    expectContract(g);
    await expectHistory(g, g.a);
    expect(await outcomeIn(g.b, g.sessionId)).toBe('loss');
  });
});
