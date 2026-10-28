# R1 — Transfermarkt Ids

## Status

Complete

## Goals

- `prisma/schema.prisma`: `transfermarktId String? @unique @map("transfermarkt_id")` on `Club`, `Player` and `Match`
- One migration, `prisma/migrations/<ts>_transfermarkt_ids/migration.sql`, made with `prisma migrate dev --create-only`, with three hand-written CHECKs added under the usual "Hand-written below" comment:
  - `clubs_transfermarkt_id_check`, `players_transfermarkt_id_check`, `matches_transfermarkt_id_check`
  - each `CHECK ("transfermarkt_id" ~ '^[0-9]+$')` (`NULL` passes, as for every nullable CHECK)
  - unique indexes `clubs_transfermarkt_id_key`, `players_transfermarkt_id_key`, `matches_transfermarkt_id_key` from Prisma
- Migration applied to the `dev` branch (`prisma migrate dev`) and to the `ingest` branch (`br-steep-paper-b1z0rlqq`, `npm run db:deploy` with its URL)
- Schema e2e cases in `test/schema/` (club-competition, player-alias, match-lineup suites): a digit id is accepted; many `NULL`s are accepted; a non-digit or empty id is refused by the CHECK; a duplicate id is refused by the unique index
- No client exposure: every select that feeds a REST or socket payload stays explicit and leaves `transfermarktId` out; no change to `src/contract/`, OpenAPI or `PROTOCOL_VERSION`
- `context/docs/scraper-data-contract.md` regenerated: "Generated from" header and latest migration, § 2.3 clubs, § 2.5 players, § 2.7 matches (column, unique key, CHECK), and § 1.4's note that slugs stay the natural key with `transfermarkt_id` as a second unique key

## Notes

- Scope: one schema change for the scraper's backend request R1 (`lineup-scraper/context/docs/backend-requests.md` § R1, asked 2026-10-27). Not a `todo.md` phase.
- Depends on: B05 (clubs), B06 (players), B07 (matches), and the data contract written 2026-10-24.
- **Why:** every club, player and match row carries the id of the Transfermarkt page it came from, so a row can be traced to its source and checked against it.
- **Text, not integer:** the scraper's raw records keep ids as digit strings.
- **Nullable:** the mock seed rows have none, and a later source may not either. Postgres allows many `NULL`s under `UNIQUE`.
- **Not the loader's key.** Slugs stay the natural key; the scraper's loader writes and checks this second unique key.
- **Never sent to a client:** web and mobile have nothing to do. Hard Constraint 2 and the "never selects a lineup" selects are untouched.
- **The seed is unaffected:** it doesn't write the column, and diff-then-write compares only the fields it writes, so `npm run db:seed` must still print `0 changed`.
- **Before release:** if Transfermarkt is replaced rather than licensed, these columns stay as history; dropping them is a later migration.
- **Neon:** `production` (`br-square-feather-b17d6fhc`) has no schema until B45 and is not touched. `ingest` is deployed in `/feature test` with its connection string from the Neon MCP (decided at load).
- Constraints:
  - Migrations only through `prisma migrate`; never edit an applied migration
  - comments single-line, at most 50 characters
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`
  - `npm run db:seed` on dev prints `0 changed`
  - Neon: both `dev` and `ingest` have the three columns, unique indexes and CHECKs, and `_prisma_migrations` lists the new migration
- Afterwards, in the scraper: copy `schema.prisma` and `data-contract.md`, then `npm run db:check` must pass. Mark R1 done in its `backend-requests.md`.

**Deviations recorded during implementation**

- **Migration made with `migrate diff`, not `migrate dev --create-only`.** The unique-index warning makes `migrate dev` ask for confirmation, and it refuses in a non-interactive shell. The SQL came from `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` into `prisma/migrations/20261028105720_transfermarkt_ids/`, with the three CHECKs added by hand. The generated part is exactly the three columns and three unique indexes, which also shows the dev branch had no drift.
- **Applied to dev with `npm run db:deploy`** (`migrate deploy`), for the same reason. Afterwards `migrate status` reports 10 migrations, up to date, and `migrate diff --exit-code` reports no drift.
- **One new suite, `test/schema/transfermarkt-id.e2e-spec.ts`,** instead of the same cases copied into three suites. It runs every case for `clubs`, `players` and `matches` with `describe.each`: a digit id, `NULL` on many rows, seven refused values (`''`, `abc`, `12a`, a leading space, a trailing space, `-1`, `1.5`) and a duplicate. 31 cases, including its own leftover check.
- **`prisma format` realigned the three models' columns.** Ignoring whitespace, the schema diff is only the three fields and their comments.
- **No code change for client exposure.** Every client-bound read uses an explicit `select` (`MATCH_IDENTITY_SELECT`, `CLUB_REF_SELECT`, the catalog's selects), and responses pass the contract's Zod `safeParse`, which drops unknown keys. One read loads a whole club row, `users.service.ts`'s `include: { favouriteClub: true }`, but `toClubRef` copies only `id`, `name` and `shortName`. Left as it is; tightening it is outside this change.
- **The data contract also got two stale rows fixed:** § 10's `ingest` row (the branch now exists, `br-steep-paper-b1z0rlqq`) and § 2.12 (the new columns have no runtime reader).
- **Already broken before this branch:** `npx tsc --noEmit` reports `crestKey` in `src/matches/match-refs.spec.ts` (first recorded in B25). Checked by stashing this branch's changes: the same single error. Not fixed here.
- **Unit tests unchanged:** 1118 pass. Lint and build pass.
- **Ingest deployed in `/feature test`** over the branch's **direct** host (`ep-fancy-fog-b1t4k7j7`), not the pooled one the Neon MCP returns, matching dev's `.env`: Prisma's migration lock wants a direct connection. The URL lived in a scratchpad file for one command and was deleted.
- **`/feature test`:**
  - `.env` points at dev: its host `ep-purple-math-b109jauj` is dev's compute
  - ingest had all 9 earlier migrations, finished; after the deploy, `migrate status` reports 10, up to date, and `migrate diff --exit-code` no drift
  - Neon, both `dev` and `ingest`: 3 nullable `text` columns, `*_transfermarkt_id_key` unique indexes, `*_transfermarkt_id_check` as `CHECK ((transfermarkt_id ~ '^[0-9]+$'::text))`, and `20261028105720_transfermarkt_ids` finished
  - `npm run test:e2e`: 447 pass (416 before, plus 31 new); `npm run db:seed` on dev prints `0 changed` for all 8 tables
  - No unit tests added: R1 adds no service, `src/game/` or utility code; its rules live in the database and the e2e suite covers them. The CHECK and duplicate cases assert the constraint's name, so a missing constraint fails them
  - Production untouched: still no schema until B45

## History
