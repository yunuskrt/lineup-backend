-- CreateEnum
CREATE TYPE "tier" AS ENUM ('free', 'pro');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "tier" "tier" NOT NULL DEFAULT 'free';
