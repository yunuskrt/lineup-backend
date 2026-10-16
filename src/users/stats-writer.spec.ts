import type { Prisma } from '@/generated/prisma/client.js';
import { type FinishedGame, recordGame } from '@/users/stats-writer.js';

const GAME: FinishedGame = {
  correctGuesses: 4,
  totalGuesses: 6,
  bestStreak: 3,
  isPerfectClear: false,
};

type Call = { sql: string; values: unknown[] };

// Records each raw call: SQL text and values
function txSpy() {
  const calls: Call[] = [];
  const $executeRaw = vi.fn((strings: TemplateStringsArray, ...values) => {
    calls.push({ sql: strings.join('?'), values });
    return Promise.resolve(1);
  });
  return { tx: { $executeRaw } as unknown as Prisma.TransactionClient, calls };
}

describe('recordGame', () => {
  it('upserts the counters, then the favourite club', async () => {
    const { tx, calls } = txSpy();
    await recordGame(tx, 'user-1', GAME);

    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toMatch(/INSERT INTO user_stats/);
    expect(calls[0].sql).toMatch(/ON CONFLICT \(user_id\) DO UPDATE/);
    expect(calls[0].values).toEqual(['user-1', 0, 3, 4, 6]);
    expect(calls[1].sql).toMatch(/UPDATE user_stats SET favourite_club_id/);
  });

  it('keeps the best streak a max, never a sum', async () => {
    const { tx, calls } = txSpy();
    await recordGame(tx, 'user-1', GAME);
    expect(calls[0].sql).toMatch(
      /best_streak = GREATEST\(user_stats\.best_streak, EXCLUDED\.best_streak\)/,
    );
  });

  it('counts a perfect clear', async () => {
    const { tx, calls } = txSpy();
    await recordGame(tx, 'user-1', { ...GAME, isPerfectClear: true });
    expect(calls[0].values[1]).toBe(1);
  });

  it('leaves the duel results alone', async () => {
    const { tx, calls } = txSpy();
    await recordGame(tx, 'user-1', GAME);
    expect(calls[0].sql).not.toMatch(/wins|losses|draws/);
  });

  it('picks the favourite club by the user id only', async () => {
    const { tx, calls } = txSpy();
    await recordGame(tx, 'user-1', GAME);
    expect(calls[1].values).toEqual(['user-1', 'user-1']);
    expect(calls[1].sql).toMatch(
      /ORDER BY count\(\*\) DESC, max\(session\.ended_at\) DESC/,
    );
  });
});
