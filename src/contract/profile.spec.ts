import { matchInPlay } from '@/contract/contract.fixtures.js';
import { historyEntrySchema, historyQuerySchema } from '@/contract/profile.js';

const { side: _side, formation: _formation, ...match } = matchInPlay;

const entry = {
  id: 'h-1',
  playedAt: '2026-09-30T18:00:00Z',
  match,
  foundCount: 7,
  livesRemaining: 1,
};

describe('historyQuerySchema', () => {
  it('defaults to the first page of 20', () => {
    expect(historyQuerySchema.parse({})).toEqual({ limit: 20 });
  });

  it('coerces a query-string limit and keeps the cursor', () => {
    expect(historyQuerySchema.parse({ cursor: 'h-9', limit: '50' })).toEqual({
      cursor: 'h-9',
      limit: 50,
    });
  });

  it.each(['0', '51', '2.5', 'abc'])('rejects limit %s', (limit) => {
    expect(historyQuerySchema.safeParse({ limit }).success).toBe(false);
  });
});

describe('historyEntrySchema', () => {
  it('pairs each mode with its own outcomes', () => {
    expect(
      historyEntrySchema.safeParse({
        ...entry,
        mode: 'solo',
        outcome: 'perfect_clear',
      }).success,
    ).toBe(true);
    expect(
      historyEntrySchema.safeParse({ ...entry, mode: 'duel', outcome: 'draw' })
        .success,
    ).toBe(true);
  });

  it('rejects an outcome from the other mode', () => {
    expect(
      historyEntrySchema.safeParse({ ...entry, mode: 'solo', outcome: 'win' })
        .success,
    ).toBe(false);
    expect(
      historyEntrySchema.safeParse({ ...entry, mode: 'duel', outcome: 'quit' })
        .success,
    ).toBe(false);
  });
});
