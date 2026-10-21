import type { DuelOutcome } from '@/contract/duel.js';
import type { Prisma } from '@/generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

// One finished game's share of the profile
export type FinishedGame = {
  correctGuesses: number;
  totalGuesses: number;
  bestStreak: number;
  isPerfectClear: boolean;
  // Null for solo, which has no result
  duelOutcome: DuelOutcome | null;
};

// A forfeit win is a win; your own forfeit a loss
function resultCounts(outcome: DuelOutcome | null) {
  return {
    wins: outcome === 'win' || outcome === 'forfeit_win' ? 1 : 0,
    losses: outcome === 'loss' ? 1 : 0,
    draws: outcome === 'draw' ? 1 : 0,
  };
}

// Runs inside the transaction that saves the game
export async function recordGame(
  tx: Tx,
  userId: string,
  game: FinishedGame,
): Promise<void> {
  const perfectClears = game.isPerfectClear ? 1 : 0;
  const { wins, losses, draws } = resultCounts(game.duelOutcome);

  // A streak is a best, never a total
  await tx.$executeRaw`
    INSERT INTO user_stats (
      user_id, played, wins, losses, draws, perfect_clears, best_streak,
      correct_guesses, total_guesses, updated_at
    )
    VALUES (
      ${userId}::uuid, 1, ${wins}, ${losses}, ${draws}, ${perfectClears},
      ${game.bestStreak}, ${game.correctGuesses}, ${game.totalGuesses}, now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      played = user_stats.played + 1,
      wins = user_stats.wins + EXCLUDED.wins,
      losses = user_stats.losses + EXCLUDED.losses,
      draws = user_stats.draws + EXCLUDED.draws,
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
