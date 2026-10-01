import {
  duelFoundPlayer,
  duelPlayer,
  matchInPlay,
  roundTiming,
} from '@/contract/contract.fixtures.js';
import {
  duelCommandSchemas,
  duelEventSchemas,
  duelSessionSchema,
  pairedStateSchema,
  queueStateSchema,
} from '@/contract/duel.js';

const session = {
  sessionId: 'd-1',
  match: matchInPlay,
  you: duelPlayer('a'),
  opponent: duelPlayer('b'),
  turn: 'you',
  round: roundTiming,
  found: [duelFoundPlayer],
};

describe('duelSessionSchema', () => {
  it('accepts a live duel', () => {
    expect(duelSessionSchema.safeParse(session).success).toBe(true);
  });

  it('always carries a round, unlike a solo session', () => {
    expect(
      duelSessionSchema.safeParse({ ...session, round: null }).success,
    ).toBe(false);
  });

  it('strips an opponent squad or hidden state', () => {
    const parsed = duelSessionSchema.parse({
      ...session,
      squad: [],
      opponent: { ...duelPlayer('b'), elapsedMs: 900 },
    });
    expect(parsed).not.toHaveProperty('squad');
    expect(parsed.opponent).not.toHaveProperty('elapsedMs');
  });
});

describe('phase payloads', () => {
  it('pins each payload to its own phase', () => {
    expect(
      queueStateSchema.safeParse({ phase: 'queued', since: 0 }).success,
    ).toBe(true);
    expect(
      queueStateSchema.safeParse({ phase: 'paired', since: 0 }).success,
    ).toBe(false);
    expect(
      pairedStateSchema.safeParse({
        phase: 'paired',
        opponent: duelPlayer('b'),
      }).success,
    ).toBe(true);
  });
});

describe('event and command maps', () => {
  it('covers every server event the web listens for', () => {
    expect(Object.keys(duelEventSchemas).sort()).toEqual(
      [
        'queued',
        'queueTimedOut',
        'paired',
        'filtersUpdated',
        'coinFlip',
        'matchReady',
        'roundStarted',
        'guessResolved',
        'playerRevealed',
        'lifeLost',
        'turnChanged',
        'opponentConnection',
        'finished',
        'disconnected',
        'error',
      ].sort(),
    );
  });

  it('takes no payload for queue and forfeit commands', () => {
    expect(duelCommandSchemas['queue:enter'].safeParse(undefined).success).toBe(
      true,
    );
    expect(duelCommandSchemas['duel:forfeit'].safeParse({}).success).toBe(
      false,
    );
  });

  it('validates the guess command', () => {
    const guess = duelCommandSchemas['duel:guess'];
    expect(guess.safeParse({ sessionId: 'd-1', guess: 'Pirlo' }).success).toBe(
      true,
    );
    expect(guess.safeParse({ sessionId: 'd-1', guess: '' }).success).toBe(
      false,
    );
  });
});
