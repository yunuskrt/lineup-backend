import {
  matchInPlay,
  revealedPlayer,
  roundTiming,
} from '@/contract/contract.fixtures.js';
import {
  soloGuessRequestSchema,
  soloSessionSchema,
  soloSummarySchema,
} from '@/contract/solo.js';

const session = {
  sessionId: 's-1',
  status: 'active',
  match: matchInPlay,
  lives: 3,
  found: [revealedPlayer],
  round: roundTiming,
};

const { side: _side, formation: _formation, ...matchIdentity } = matchInPlay;

const summary = {
  match: matchIdentity,
  found: [{ ...revealedPlayer, order: 1, elapsedMs: 4_200 }],
  missedCount: 10,
  missed: null,
  livesRemaining: 0,
  endReason: 'lives_out',
  accuracy: 0.25,
  bestStreak: 1,
  roundTimesMs: [4_200, 15_000],
};

describe('soloSessionSchema', () => {
  it('accepts an active session and an over one with no round', () => {
    expect(soloSessionSchema.safeParse(session).success).toBe(true);
    expect(
      soloSessionSchema.safeParse({ ...session, status: 'over', round: null })
        .success,
    ).toBe(true);
  });

  it('rejects more than 11 found players', () => {
    const found = Array.from({ length: 12 }, () => revealedPlayer);
    expect(soloSessionSchema.safeParse({ ...session, found }).success).toBe(
      false,
    );
  });

  it('never passes an unrevealed squad through', () => {
    const parsed = soloSessionSchema.parse({
      ...session,
      squad: [{ id: 'p-9', name: 'Hidden Starter' }],
      match: { ...matchInPlay, squad: [] },
    });
    expect(parsed).not.toHaveProperty('squad');
    expect(parsed.match).not.toHaveProperty('squad');
  });
});

describe('soloGuessRequestSchema', () => {
  it('trims the guess and rejects a blank one', () => {
    expect(
      soloGuessRequestSchema.parse({ sessionId: 's-1', guess: ' Xavi ' }).guess,
    ).toBe('Xavi');
    expect(
      soloGuessRequestSchema.safeParse({ sessionId: 's-1', guess: ' ' })
        .success,
    ).toBe(false);
  });
});

describe('soloSummarySchema', () => {
  it('accepts a free summary with missed as null', () => {
    expect(soloSummarySchema.safeParse(summary).success).toBe(true);
  });

  it('accepts a Pro summary with the missed list', () => {
    const pro = { ...summary, missed: [{ ...revealedPlayer, slot: 1 }] };
    expect(soloSummarySchema.safeParse(pro).success).toBe(true);
  });

  it('requires missed to be present, even when null', () => {
    const { missed: _, ...withoutMissed } = summary;
    expect(soloSummarySchema.safeParse(withoutMissed).success).toBe(false);
  });

  it.each([
    ['accuracy above 1', { accuracy: 1.5 }],
    ['missedCount above 11', { missedCount: 12 }],
    ['unknown end reason', { endReason: 'timeout' }],
    ['negative round time', { roundTimesMs: [-1] }],
  ])('rejects %s', (_, overrides) => {
    expect(
      soloSummarySchema.safeParse({ ...summary, ...overrides }).success,
    ).toBe(false);
  });
});

describe('soloSummarySchema found timings', () => {
  const named = (order: number, elapsedMs: number) => ({
    ...summary,
    found: [{ ...revealedPlayer, order, elapsedMs }],
  });

  it('accepts the first and last order and the full round', () => {
    expect(soloSummarySchema.safeParse(named(1, 0)).success).toBe(true);
    expect(soloSummarySchema.safeParse(named(11, 15_000)).success).toBe(true);
  });

  it.each([
    ['order 0', 0, 1_000],
    ['order 12', 12, 1_000],
    ['a time past the round', 1, 15_001],
    ['a negative time', 1, -1],
  ])('refuses %s', (_, order, elapsedMs) => {
    expect(soloSummarySchema.safeParse(named(order, elapsedMs)).success).toBe(
      false,
    );
  });

  it('refuses a found player with no timing', () => {
    expect(
      soloSummarySchema.safeParse({ ...summary, found: [revealedPlayer] })
        .success,
    ).toBe(false);
  });
});
