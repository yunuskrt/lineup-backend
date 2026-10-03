-- Hand-written: sums a formation's lines (4-2-3-1 -> 10).
-- NULL for anything that isn't single digits joined by dashes,
-- so a malformed value fails the CHECK instead of a cast.
CREATE FUNCTION "formation_outfield_total"("formation" text)
RETURNS integer
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
    SELECT CASE WHEN "formation" ~ '^[0-9](-[0-9])*$' THEN (
        SELECT sum("line"::integer)::integer
        FROM unnest(string_to_array("formation", '-')) AS "line"
    ) END
$$;

-- CreateEnum
CREATE TYPE "side" AS ENUM ('home', 'away');

-- CreateEnum
CREATE TYPE "position_group" AS ENUM ('GK', 'DF', 'MF', 'FW');

-- CreateEnum
CREATE TYPE "match_event_kind" AS ENUM ('goal', 'own_goal', 'penalty_goal', 'red_card');

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "season_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "stage" TEXT,
    "nickname" TEXT,
    "extra_time" BOOLEAN NOT NULL DEFAULT false,
    "shootout_home" INTEGER,
    "shootout_away" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_teams" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "side" "side" NOT NULL,
    "club_id" UUID NOT NULL,
    "goals" INTEGER NOT NULL,
    "formation" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lineups" (
    "id" UUID NOT NULL,
    "match_team_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "slot" INTEGER NOT NULL,
    "position" "position_group" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lineups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_events" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "kind" "match_event_kind" NOT NULL,
    "minute" INTEGER NOT NULL,
    "added_time" INTEGER,
    "side" "side" NOT NULL,
    "player_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "matches_slug_key" ON "matches"("slug");

-- CreateIndex
CREATE INDEX "matches_season_id_idx" ON "matches"("season_id");

-- CreateIndex
CREATE INDEX "match_teams_club_id_idx" ON "match_teams"("club_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_teams_match_id_side_key" ON "match_teams"("match_id", "side");

-- CreateIndex
CREATE UNIQUE INDEX "match_teams_match_id_club_id_key" ON "match_teams"("match_id", "club_id");

-- CreateIndex
CREATE INDEX "lineups_player_id_idx" ON "lineups"("player_id");

-- CreateIndex
CREATE UNIQUE INDEX "lineups_match_team_id_slot_key" ON "lineups"("match_team_id", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "lineups_match_team_id_player_id_key" ON "lineups"("match_team_id", "player_id");

-- CreateIndex
CREATE INDEX "match_events_match_id_idx" ON "match_events"("match_id");

-- CreateIndex
CREATE INDEX "match_events_player_id_idx" ON "match_events"("player_id");

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_teams" ADD CONSTRAINT "match_teams_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_teams" ADD CONSTRAINT "match_teams_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineups" ADD CONSTRAINT "lineups_match_team_id_fkey" FOREIGN KEY ("match_team_id") REFERENCES "match_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineups" ADD CONSTRAINT "lineups_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written below: Prisma can't declare CHECK constraints

ALTER TABLE "matches" ADD CONSTRAINT "matches_text_check"
    CHECK (
        btrim("slug") <> ''
        AND ("stage" IS NULL OR btrim("stage") <> '')
        AND ("nickname" IS NULL OR btrim("nickname") <> '')
    );

-- A shootout has both scores, never a draw
ALTER TABLE "matches" ADD CONSTRAINT "matches_shootout_check"
    CHECK (
        ("shootout_home" IS NULL) = ("shootout_away" IS NULL)
        AND (
            "shootout_home" IS NULL
            OR ("shootout_home" >= 0 AND "shootout_away" >= 0
                AND "shootout_home" <> "shootout_away")
        )
    );

ALTER TABLE "match_teams" ADD CONSTRAINT "match_teams_goals_check"
    CHECK ("goals" >= 0);

-- 3-5 lines of 1-9 players, 10 outfield in total
ALTER TABLE "match_teams" ADD CONSTRAINT "match_teams_formation_check"
    CHECK (
        "formation" IS NULL
        OR ("formation" ~ '^[1-9](-[1-9]){2,4}$'
            AND formation_outfield_total("formation") = 10)
    );

ALTER TABLE "lineups" ADD CONSTRAINT "lineups_slot_check"
    CHECK ("slot" BETWEEN 0 AND 10);

-- Slot 0 is the goalkeeper, and no other slot is
ALTER TABLE "lineups" ADD CONSTRAINT "lineups_goalkeeper_check"
    CHECK (("slot" = 0) = ("position" = 'GK'));

ALTER TABLE "match_events" ADD CONSTRAINT "match_events_minute_check"
    CHECK ("minute" BETWEEN 1 AND 120);

-- Added time hangs off the end of a half: 45+2, 90+3, 105+1, 120+2
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_added_time_check"
    CHECK (
        "added_time" IS NULL
        OR ("added_time" BETWEEN 1 AND 30 AND "minute" IN (45, 90, 105, 120))
    );
