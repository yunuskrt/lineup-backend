-- CreateEnum
CREATE TYPE "competition_kind" AS ENUM ('league', 'ucl', 'uel', 'world_cup', 'euro');

-- CreateEnum
CREATE TYPE "club_kind" AS ENUM ('club', 'national_team');

-- CreateTable
CREATE TABLE "competitions" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "competition_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "start_year" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clubs" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "club_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "crest_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_aliases" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "competitions_slug_key" ON "competitions"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_competition_id_label_key" ON "seasons"("competition_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "clubs_slug_key" ON "clubs"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "club_aliases_club_id_alias_key" ON "club_aliases"("club_id", "alias");

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_aliases" ADD CONSTRAINT "club_aliases_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written below: Prisma can't declare CHECK constraints

-- Season label is `2004-05` (league) or `2006` (tournament)
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_label_format_check"
    CHECK ("label" ~ '^[0-9]{4}(-[0-9]{2})?$');

ALTER TABLE "seasons" ADD CONSTRAINT "seasons_start_year_range_check"
    CHECK ("start_year" BETWEEN 2000 AND 2025);

ALTER TABLE "seasons" ADD CONSTRAINT "seasons_label_start_year_check"
    CHECK (left("label", 4) = "start_year"::text);

-- A two-year label spans consecutive years: 2004-05, 2009-10, 2099-00
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_label_consecutive_check"
    CHECK (
        length("label") = 4
        OR right("label", 2) = lpad((("start_year" + 1) % 100)::text, 2, '0')
    );

-- The contract rejects empty names, so the database does too
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_text_check"
    CHECK (btrim("slug") <> '' AND btrim("name") <> '');

ALTER TABLE "clubs" ADD CONSTRAINT "clubs_text_check"
    CHECK (btrim("slug") <> '' AND btrim("name") <> '' AND btrim("short_name") <> '');

ALTER TABLE "club_aliases" ADD CONSTRAINT "club_aliases_alias_check"
    CHECK (btrim("alias") <> '');
