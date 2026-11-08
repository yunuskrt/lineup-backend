-- AlterTable
ALTER TABLE "game_sessions" ADD COLUMN     "is_private" BOOLEAN NOT NULL DEFAULT false;

-- Hand-written below: Prisma can't declare CHECK constraints

-- Only a duel can come from a private room (R6)
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_is_private_check"
    CHECK (NOT "is_private" OR "mode" = 'duel');
