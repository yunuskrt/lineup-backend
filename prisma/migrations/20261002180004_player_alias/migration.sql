-- Hand-written: Prisma 7 no longer declares extensions in the schema
-- pg_trgm: fuzzy alias matching (B26, B28); unaccent: diacritic folding
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateTable
CREATE TABLE "players" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_aliases" (
    "id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "players_slug_key" ON "players"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "player_aliases_player_id_normalized_key" ON "player_aliases"("player_id", "normalized");

-- AddForeignKey
ALTER TABLE "player_aliases" ADD CONSTRAINT "player_aliases_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written below: Prisma can't declare CHECK constraints

ALTER TABLE "players" ADD CONSTRAINT "players_text_check"
    CHECK (btrim("slug") <> '' AND btrim("name") <> '');

ALTER TABLE "player_aliases" ADD CONSTRAINT "player_aliases_alias_check"
    CHECK (btrim("alias") <> '');

-- Shape only: lowercase, trimmed, single spaces, non-empty.
-- The full normalizer is src/game (B27); SQL never re-implements it.
ALTER TABLE "player_aliases" ADD CONSTRAINT "player_aliases_normalized_check"
    CHECK ("normalized" ~ '^\S+( \S+)*$' AND "normalized" = lower("normalized"));
