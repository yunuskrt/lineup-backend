import type { Prisma } from '@/generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

// One finished game's share of the profile
export type FinishedGame = {
  correctGuesses: number;
  totalGuesses: number;
  bestStreak: number;
  isPerfectClear: boolean;
};

// Runs inside the transaction that saves the game
export async function recordGame(
  tx: Tx,
  userId: string,
  game: FinishedGame,
): Promise<void> {
  const perfectClears = game.isPerfectClear ? 1 : 0;

  // A streak is a best, never a total
  await tx.$executeRaw`
    INSERT INTO user_stats (
      user_id, played, perfect_clears, best_streak,
      correct_guesses, total_guesses, updated_at
    )
    VALUES (
      ${userId}::uuid, 1, ${perfectClears}, ${game.bestStreak},
      ${game.correctGuesses}, ${game.totalGuesses}, now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      played = user_stats.played + 1,
      perfect_clears = user_stats.perfect_clears + EXCLUDED.perfect_clears,
      best_streak = GREATEST(user_stats.best_streak, EXCLUDED.best_streak),
      correct_guesses = user_stats.correct_guesses + EXCLUDED.correct_guesses,
      total_guesses = user_stats.total_guesses + EXCLUDED.total_guesses,
      updated_at = now()`;

  // Most-played side's club; a tie goes to the latest
  await tx.$executeRaw`
    UPDATE user_stats SET favourite_club_id = (
      SELECT team.club_id
      FROM game_participants AS participant
      JOIN game_sessions AS session ON session.id = participant.session_id
      JOIN match_teams AS team
        ON team.match_id = session.match_id AND team.side = session.side
      WHERE participant.user_id = ${userId}::uuid AND session.status = 'over'
      GROUP BY team.club_id
      ORDER BY count(*) DESC, max(session.ended_at) DESC, team.club_id
      LIMIT 1
    )
    WHERE user_id = ${userId}::uuid`;
}
