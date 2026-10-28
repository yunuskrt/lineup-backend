-- AlterTable
ALTER TABLE "clubs" ADD COLUMN     "transfermarkt_id" TEXT;

-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "transfermarkt_id" TEXT;

-- AlterTable
ALTER TABLE "players" ADD COLUMN     "transfermarkt_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "clubs_transfermarkt_id_key" ON "clubs"("transfermarkt_id");

-- CreateIndex
CREATE UNIQUE INDEX "matches_transfermarkt_id_key" ON "matches"("transfermarkt_id");

-- CreateIndex
CREATE UNIQUE INDEX "players_transfermarkt_id_key" ON "players"("transfermarkt_id");


-- Hand-written below: Prisma can't declare CHECK constraints

-- A Transfermarkt page id: digits only, never ''
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_transfermarkt_id_check"
    CHECK ("transfermarkt_id" ~ '^[0-9]+$');

ALTER TABLE "players" ADD CONSTRAINT "players_transfermarkt_id_check"
    CHECK ("transfermarkt_id" ~ '^[0-9]+$');

ALTER TABLE "matches" ADD CONSTRAINT "matches_transfermarkt_id_check"
    CHECK ("transfermarkt_id" ~ '^[0-9]+$');
