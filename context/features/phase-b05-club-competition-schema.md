# Phase B05 — Club & Competition Schema

## Status

Complete

## Goals

- `prisma/schema.prisma`: the first four models, with snake_case tables and columns via `@@map` / `@map`:
  - `Competition` → `competitions`: `id`, unique `slug`, `kind` (enum `CompetitionKind`: `league`, `ucl`, `uel`, `world_cup`, `euro`), `name`
  - `Season` → `seasons`: `id`, `competitionId`, `label` (`2004-05` or `2006`), `startYear`. Unique on (`competitionId`, `label`)
  - `Club` → `clubs`: `id`, unique `slug`, `kind` (enum `ClubKind`: `club`, `national_team`), `name`, `shortName`, nullable `crestKey`
  - `ClubAlias` → `club_aliases`: `id`, `clubId`, `alias`. Unique on (`clubId`, `alias`), cascade-deleted with its club
  - `createdAt` / `updatedAt` on every model
- `prisma/migrations/<timestamp>_club_competition/`: the first migration, created with `--create-only`, then the CHECK constraints from Open Questions 2 added by hand, then applied with `npm run db:migrate`
- `test/schema/club-competition.e2e-spec.ts`: inserts and reads every model against the dev branch inside a transaction that's always rolled back, and proves each constraint rejects bad rows

## Open Questions

Both settled before `/feature start`.

1. **Where do national teams live?** World Cup and Euro matches have national teams on both sides, and the contract types both as `ClubRef`. **Decided: in `clubs`, with `kind = national_team`.** One table keeps `matches.home` / `away` (B07) a single foreign key, and the B25b catalog can still split clubs from nations for filters. The alternative is a separate `nations` table, which doubles every match-side relation.
2. **Enforce season rules in the database?** Prisma can't declare CHECK constraints, but they can be written into the migration SQL before it's applied. **Decided: yes, on `seasons`:**
   - `label` matches `^\d{4}(-\d{2})?$`
   - `start_year` is between 2000 and 2025
   - `label` starts with `start_year`
   - a two-year label's second part is `(start_year + 1) % 100`

   Ingestion (B16) bugs then fail at the database instead of reaching the pool. The tournament-vs-league rule needs the competition's kind, a cross-table check, so it stays in ingestion code.

## Out of Scope

- Matches, lineups and players: B06, B07.
- A normalized alias column, trigram indexes and `unaccent`: B06 / B17 / B26. Aliases are stored as written for now.
- Crest URLs: `crestKey` is the bucket object key; building the CDN URL is B23.
- Seed data: B09.
- Any endpoint: the catalog is B25b.

## Notes

- Scope: four tables, two enums, their first migration, and a DB-level test that the constraints hold.
- Depends on: B04 (Prisma, `db:migrate`, dev branch).
- Conventions set here for every schema phase (B05–B08):
  - Model names in PascalCase, singular. Tables and columns in snake_case via `@@map` / `@map`, matching the table names in `project-overview.md`.
  - `id String @id @default(uuid(7))`: time-ordered UUIDs index well. A unique `slug` is the stable key that idempotent seeding (B09) and ingestion (B16) upsert on.
  - Enum values are lowercase and identical to the contract's (`CompetitionKind` in `src/contract/common.ts`), so mapping a row to a `CompetitionRef` is a plain copy.
  - Every foreign key states its `onDelete`. `Season → Competition` is `Restrict`; `ClubAlias → Club` is `Cascade`.
  - Foreign-key columns are indexed. A composite unique key starting with the FK counts as the index.
- Constraints:
  - Migrations only through `prisma migrate`. A migration may be edited between `--create-only` and its first apply, never after (`coding-standards-backend.md` § Data).
  - The contract is the ceiling for what reaches clients. `ClubRef` exposes `id`, `name`, `shortName`, `crestUrl`; `slug`, `kind` and timestamps stay internal.
  - Aliases aren't globally unique: "United" or "Real" can belong to several clubs. Only (`clubId`, `alias`) is unique.
  - The e2e test must leave the dev branch exactly as it found it. Run everything inside `$transaction` and throw at the end to roll back.
- Shadow database (carried over from B04): this is the first `migrate dev` that needs one. Record whether Neon's owner role could create it. If it couldn't, add `SHADOW_DATABASE_URL` pointing at a second Neon branch and record that instead.
- Verification:
  - `npx prisma validate` and `npx prisma format --check` pass.
  - `npm run db:migrate` applies cleanly, and `npm run db:status` now exits 0 ("Database schema is up to date").
  - The four tables appear on the dev branch in the Neon console.
  - `npm run test:e2e`: valid rows round-trip, and each CHECK and unique constraint rejects its bad row.
  - `npm test`, `npm run build` and `npm run lint` pass.

**Deviations recorded during implementation**

- **Shadow database: no extra setup needed.** `migrate dev --create-only` built its shadow database on Neon without complaint, so no `SHADOW_DATABASE_URL` is needed. This closes the B04 risk.
- Ids are `@db.Uuid` (native Postgres `uuid` columns) rather than `text`. The `uuid(7)` default is generated by Prisma Client, not the database, so a raw SQL insert has to supply its own id.
- Enums map to snake_case Postgres types (`competition_kind`, `club_kind`), matching the table naming.
- **Extra CHECKs beyond the season rules:** non-blank `slug` and `name` on `competitions`, `slug`, `name` and `short_name` on `clubs`, and `alias` on `club_aliases`. The contract rejects empty names, so an empty one in the database would otherwise only surface as `server_error` at response time. 7 CHECK constraints in all.
- Postgres checks constraints in name order and reports the first failure. A label like `2005-06` with start year 2004 breaks two rules and is reported as `seasons_label_consecutive_check`. The test uses `2005` to hit the start-year rule alone.
- Prisma doesn't diff CHECK constraints: a follow-up `migrate dev --create-only` produced an empty migration, so the hand-written CHECKs survive future migrations. The probe migration was deleted unapplied.
- The e2e suite boots `ConfigModule` + `PrismaModule` only, not the full `AppModule`. Each case runs in its own `$transaction` (15 s timeout), always rolled back, and the dev branch was checked to hold 0 rows afterwards.
- **The season range lives in two places.** `2000` and `2025` are in `src/contract/constants.ts` (`FIRST_SEASON_START` / `LAST_SEASON_START`) and in `seasons_start_year_range_check`. Admitting 2026-27 means changing the constant *and* writing a new migration that drops and re-adds that CHECK; the applied one can't be edited.
- Tightened at `/feature test`: the duplicate and restricted-delete tests now assert Prisma's code and the exact Postgres constraint (`P2002` + `seasons_competition_id_label_key`, `clubs_slug_key`, `competitions_slug_key`, `club_aliases_club_id_alias_key`; `P2003` + `seasons_competition_id_fkey`) instead of any error. The codes were probed first: with the `pg` adapter the constraint name is in `meta.driverAdapterError.cause.constraint.index`. Breaking an expected name or code makes the test fail.
- `.env.example` now uses `sslmode=verify-full`. `pg` warns that `require` is treated as `verify-full` today but will weaken in its next major version; `verify-full` keeps today's behaviour. The local `.env` should make the same change.

## History
