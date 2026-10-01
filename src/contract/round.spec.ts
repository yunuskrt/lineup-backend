import { revealedPlayer } from '@/contract/contract.fixtures.js';
import { guessResultSchema, roundTimingSchema } from '@/contract/round.js';

describe('roundTimingSchema', () => {
  it('accepts a round that ends after it starts', () => {
    expect(
      roundTimingSchema.safeParse({ startedAt: 1_000, endsAt: 16_000 }).success,
    ).toBe(true);
  });

  it.each([
    ['equal', { startedAt: 1_000, endsAt: 1_000 }],
    ['reversed', { startedAt: 16_000, endsAt: 1_000 }],
    ['negative', { startedAt: -1, endsAt: 1_000 }],
    ['fractional', { startedAt: 1_000.5, endsAt: 16_000 }],
  ])('rejects %s timestamps', (_, round) => {
    expect(roundTimingSchema.safeParse(round).success).toBe(false);
  });
});

describe('guessResultSchema', () => {
  it('accepts each outcome with its own fields', () => {
    for (const result of [
      { outcome: 'correct_new', player: revealedPlayer },
      { outcome: 'already_found', playerId: 'p-1' },
      { outcome: 'not_in_xi' },
    ]) {
      expect(guessResultSchema.safeParse(result).success).toBe(true);
    }
  });

  it('rejects correct_new without its player', () => {
    expect(
      guessResultSchema.safeParse({ outcome: 'correct_new' }).success,
    ).toBe(false);
  });

  it('says nothing more than not_in_xi for a wrong guess', () => {
    const parsed = guessResultSchema.parse({
      outcome: 'not_in_xi',
      closest: 'Ronaldinho',
    });
    expect(parsed).toEqual({ outcome: 'not_in_xi' });
  });
});
