-- CreateEnum
CREATE TYPE "game_mode" AS ENUM ('solo', 'duel');

-- CreateEnum
CREATE TYPE "game_status" AS ENUM ('active', 'over');

-- CreateEnum
CREATE TYPE "solo_end_reason" AS ENUM ('lives_out', 'quit', 'perfect_clear');

-- CreateEnum
CREATE TYPE "duel_outcome" AS ENUM ('win', 'loss', 'draw', 'forfeit_win');

-- CreateEnum
CREATE TYPE "round_end_reason" AS ENUM ('found', 'expired', 'ended');

-- CreateEnum
CREATE TYPE "guess_outcome" AS ENUM ('correct_new', 'already_found', 'not_in_xi');

-- CreateTable
CREATE TABLE "memorability_scores" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "signals" JSONB NOT NULL,
    "algorithm_version" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memorability_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_sessions" (
    "id" UUID NOT NULL,
    "mode" "game_mode" NOT NULL,
    "status" "game_status" NOT NULL DEFAULT 'active',
    "match_id" UUID NOT NULL,
    "side" "side",
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "solo_end_reason" "solo_end_reason",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_participants" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "seat" INTEGER NOT NULL,
    "lives_remaining" INTEGER NOT NULL DEFAULT 3,
    "duel_outcome" "duel_outcome",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_rounds" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "participant_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "end_reason" "round_end_reason",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guesses" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "outcome" "guess_outcome" NOT NULL,
    "player_id" UUID,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_stats" (
    "user_id" TEXT NOT NULL,
    "played" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "perfect_clears" INTEGER NOT NULL DEFAULT 0,
    "best_streak" INTEGER NOT NULL DEFAULT 0,
    "correct_guesses" INTEGER NOT NULL DEFAULT 0,
    "total_guesses" INTEGER NOT NULL DEFAULT 0,
    "favourite_club_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_stats_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "memorability_scores_match_id_key" ON "memorability_scores"("match_id");

-- CreateIndex
CREATE INDEX "game_sessions_match_id_idx" ON "game_sessions"("match_id");

-- CreateIndex
CREATE INDEX "game_participants_user_id_idx" ON "game_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_participants_session_id_seat_key" ON "game_participants"("session_id", "seat");

-- CreateIndex
CREATE UNIQUE INDEX "game_participants_session_id_user_id_key" ON "game_participants"("session_id", "user_id");

-- CreateIndex
CREATE INDEX "game_rounds_participant_id_idx" ON "game_rounds"("participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_rounds_session_id_number_key" ON "game_rounds"("session_id", "number");

-- CreateIndex
CREATE INDEX "guesses_round_id_idx" ON "guesses"("round_id");

-- CreateIndex
CREATE INDEX "guesses_player_id_idx" ON "guesses"("player_id");

-- CreateIndex
CREATE INDEX "user_stats_favourite_club_id_idx" ON "user_stats"("favourite_club_id");

-- AddForeignKey
ALTER TABLE "memorability_scores" ADD CONSTRAINT "memorability_scores_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_participants" ADD CONSTRAINT "game_participants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "game_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "game_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_favourite_club_id_fkey" FOREIGN KEY ("favourite_club_id") REFERENCES "clubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written below: Prisma can't declare CHECK constraints

ALTER TABLE "memorability_scores" ADD CONSTRAINT "memorability_scores_score_check"
    CHECK ("score" BETWEEN 0 AND 100);

ALTER TABLE "memorability_scores" ADD CONSTRAINT "memorability_scores_version_check"
    CHECK (btrim("algorithm_version") <> '');

-- A session is over exactly when it has an end time
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_status_check"
    CHECK (("status" = 'over') = ("ended_at" IS NOT NULL));

-- A finished solo run always has a reason; nothing else has one
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_end_reason_check"
    CHECK (("solo_end_reason" IS NOT NULL) = ("mode" = 'solo' AND "status" = 'over'));

ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_time_check"
    CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at");

ALTER TABLE "game_participants" ADD CONSTRAINT "game_participants_lives_check"
    CHECK ("lives_remaining" BETWEEN 0 AND 3);

ALTER TABLE "game_participants" ADD CONSTRAINT "game_participants_seat_check"
    CHECK ("seat" BETWEEN 0 AND 1);

ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_number_check"
    CHECK ("number" >= 1);

-- ended_at may pass ends_at: the grace window, a late expiry
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_time_check"
    CHECK (
        "ends_at" > "started_at"
        AND ("ended_at" IS NULL OR "ended_at" >= "started_at")
    );

ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_end_check"
    CHECK (("ended_at" IS NULL) = ("end_reason" IS NULL));

ALTER TABLE "guesses" ADD CONSTRAINT "guesses_text_check"
    CHECK ("text" = btrim("text") AND char_length("text") BETWEEN 1 AND 64);

-- Unknown names and wrong players both resolve to no player
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_player_check"
    CHECK (("outcome" = 'not_in_xi') = ("player_id" IS NULL));

ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_counters_check"
    CHECK (
        "played" >= 0 AND "wins" >= 0 AND "losses" >= 0 AND "draws" >= 0
        AND "perfect_clears" >= 0 AND "best_streak" >= 0
        AND "correct_guesses" >= 0 AND "total_guesses" >= 0
    );

ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_results_check"
    CHECK ("wins" + "losses" + "draws" <= "played");

ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_guesses_check"
    CHECK ("correct_guesses" <= "total_guesses");
