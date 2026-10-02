# Phase B06 — Player & Alias Schema

## Status

Complete

## Goals

- `prisma/schema.prisma`: two models, following B05's conventions:
  - `Player` → `players`: `id`, unique `slug`, `name` (display form, diacritics kept: `Oğuzhan Şimşek`), nullable `imageKey`
  - `PlayerAlias` → `player_aliases`: `id`, `playerId`, `alias` (as written: `Ciarán O'Donovan`, `Ibra`), `normalized` (`ciaran odonovan`, `ibra`). Unique on (`playerId`, `normalized`), cascade-deleted with its player
  - `createdAt` / `updatedAt` on both
- `prisma/migrations/<timestamp>_player_alias/`: created with `--create-only`, then edited by hand before its first apply to add:
  - `CREATE EXTENSION IF NOT EXISTS pg_trgm` and `CREATE EXTENSION IF NOT EXISTS unaccent`
  - CHECKs: non-blank `slug` and `name` on `players`. On `player_aliases`: non-blank `alias`, and `normalized` in normal-form shape per Open Questions 1
- `test/schema/schema-test-utils.ts`: move B05's `rolledBack()` and `violation()` helpers here, so both schema suites share them instead of copying
- `test/schema/player-alias.e2e-spec.ts`: rolled-back transactions, as in B05. Covers:
  - round-trips
  - a shared alias across players
  - each constraint by its exact Prisma code and constraint name
  - cascade delete
  - `similarity()` and `unaccent()` both callable

## Open Questions

Settled before `/feature start`.

1. **What form is an alias stored in?** The mock stores aliases already normalized (`ciaran odonovan`, `o donovan`), and every player's list includes its own normalized full name. The matcher normalizes a guess the same way and compares. The recommendation was the normalized form only, in one column. **Decided: raw + normalized columns.** `alias` keeps the form as written; `normalized` holds the matcher's form, with a CHECK for the shape normalization always produces:
   - lowercase
   - trimmed
   - single spaces
   - non-empty

   The full pipeline (diacritics, Turkish `İ/ı/ş/ğ/ç`, punctuation) is B27's pure function in `src/game/`. The database can't run it, so it only guards the invariant.

   **Who fills `normalized` before B27 exists:** both columns are `NOT NULL`, and whoever writes the row supplies both. Until B27, the only writer is B09's seed. The mock's aliases are already normalized, so the seed writes the same value to both. No SQL copy of the normalizer is written, since a second implementation would drift from B27's. When B27 lands, it adds a check that every stored `normalized` equals `normalizeName(alias)`.

## Out of Scope

- Lineups and the player–match link: B07. Position is per lineup slot, not per player.
- A trigram index on `player_aliases.normalized`, and measuring its cost: B26. B06 only makes `pg_trgm` available.
- The normalization pipeline: B27. Fuzzy matching and its threshold: B28. Surname collisions inside the XI: B29.
- Alias `kind` or `source` columns (surname, nickname, "collected from live play"). B29 can find ambiguity by comparing aliases within the squad, so no kind is needed yet. Add a column when a phase actually reads it.
- Player attributes used for scoring or entity resolution (birth date, caps, Ballon d'Or shortlists): B17 and B19 add what they use.
- Image URLs: `imageKey` is the bucket key, URL building is B23, and licensed ingest is B24.

## Notes

- Scope: two tables, two extensions, one migration and a database-level test.
- Depends on: B05 (conventions, the hand-edited migration workflow, the rolled-back test pattern and the `violation()` helper's approach).
- Conventions carried from B05:
  - snake_case via `@@map` / `@map`
  - `@db.Uuid` ids with `uuid(7)`, plus a unique `slug`
  - explicit `onDelete`
  - hand-written SQL added only between `--create-only` and the first apply
  - tests assert Prisma's code and the exact Postgres constraint, never just "throws"
- Extensions:
  - The `postgresqlExtensions` preview feature is deprecated in Prisma 7. Extensions go in the migration SQL as `CREATE EXTENSION IF NOT EXISTS`, not in the schema.
  - Check they're available on Neon (`pg_available_extensions`) before writing the migration.
  - After applying, run a `--create-only` drift probe, as in B05. Prisma must not try to drop the extensions or the CHECKs. Delete the probe unapplied.
- Constraints:
  - **The squad is never sent to a client.** These tables hold every player, and nothing here exposes them. B07's lineups decide who is in an XI, and only revealed players ever leave the server (Hard Constraint 2).
  - Aliases aren't globally unique. `harlow` legitimately belongs to two players in the mock, the same clash B29 has to resolve. Only (`playerId`, `normalized`) is unique: two spellings that normalize alike (`Ibrahimović` and `Ibrahimovic`) are one alias.
  - Matching (B26–B28) reads `normalized` only. `alias` is for display, QA and provenance, never compared against a guess.
  - "Ronaldo" must never resolve to "Ronaldinho" (`mock-to-backend-map.md`, watch-out 2). That's B28's threshold, but this phase's test should record the raw `similarity('ronaldo', 'ronaldinho')` value so B28 starts from a measured number.
  - `unaccent()` isn't `IMMUTABLE`, so it can't appear in an index expression or a generated column without a wrapper. Note this for B26; don't work around it here.
- Verification:
  - `npx prisma validate` and `npx prisma format --check` pass.
  - `npm run db:migrate` applies cleanly. `npm run db:status` exits 0. `pg_extension` lists `pg_trgm` and `unaccent` on the dev branch.
  - The drift probe comes back empty.
  - `npm run test:e2e`: valid rows round-trip, each constraint rejects its row by name, and both extension functions run.
  - `npm test`, `npm run build` and `npm run lint` pass. The dev branch holds 0 rows after the tests.

**Deviations recorded during implementation**

- **The `normalized` CHECK is exactly the decided shape:** `normalized ~ '^\S+( \S+)*$' AND normalized = lower(normalized)`, so lowercase, trimmed, single spaces, non-empty, no tabs. It doesn't also force ASCII, even though all 345 mock aliases are `[a-z ]`, so it won't block B27's choice for non-Latin names. B27 may tighten it with a new migration once its alphabet is fixed.
- 3 CHECK constraints (`players_text_check`, `player_aliases_alias_check`, `player_aliases_normalized_check`) and 2 extensions. Both extensions sit at the top of the migration as `CREATE EXTENSION IF NOT EXISTS`. They were available on Neon (`pg_trgm` 1.6, `unaccent` 1.1) and not yet installed.
- The drift probe came back empty: Prisma won't try to drop the extensions or the CHECKs. It was deleted unapplied.
- **Prisma 7's `migrate dev` no longer regenerates the client.** Run `npm run db:generate` after every migration, or the new models don't exist in TypeScript. `prebuild` and `postinstall` still cover builds and fresh clones.
- **New `@test/*` path alias** in `tsconfig.json` for test-only code. `@/` is scoped to `src/`, and shared test helpers shouldn't ship in the build. This departs from the "`@/` only" import rule, for test code only.
- `test/schema/schema-test-utils.ts` exports `useRolledBackDb()`, which owns the Prisma setup and teardown as well as `rolledBack()`, plus `violation()` and `Tx`. The B05 suite moved onto it and its 22 tests still pass.
- Constraint order again: a test that writes `''` to both columns trips `player_aliases_alias_check` first. The normalized-shape tests write a valid raw alias (`Ibra`) so only the `normalized` CHECK can fail.
- **Measured for B28:** `similarity('ronaldo', 'ronaldinho')` = **0.4615**, but `pg_trgm`'s default `show_limit()` is **0.3**. With defaults, the `%` operator *would* match Ronaldo to Ronaldinho. B28 must set its own threshold above that, or not rely on trigram similarity alone. Other reference points: `ibrahimovic`/`ibrahimovich` 0.7857, `harlow`/`harlowe` 0.6667, `xavi`/`xabi` 0.25.
- **Measured for B27:** `unaccent()` folds `İbrahimović` → `Ibrahimovic`, and `ı ş ğ ç ö ü İ` → `i s g c o u I`. That's the SQL side only; the canonical normalizer is still B27's TypeScript.
- The dev branch holds 0 players and 0 aliases after the suites.
- The `lower()` CHECK holds for non-ASCII letters: the dev database uses the built-in `C.UTF-8` collation, so `ÇİŞĞÖÜ` lowercases correctly, `İbra` is rejected and a non-breaking space doesn't count as a word character. Checked at review.
- Fixed at `/feature test`:
  - Five comments over the 50-character limit were shortened. Three of them had come from B05's test file, where the B05 review missed them.
  - The Ronaldo/Ronaldinho test now pins the score (≈ 0.4615) and the default `show_limit()` (0.3), and asserts `'ronaldo' % 'ronaldinho'` is true. The B28 trap is now in code, not only in this note.
- Housekeeping, outside B06's scope: a repo-wide scan found six more comments over 50 characters from earlier phases, fixed here:
  - `test/vitest.e2e.setup.ts`, `src/prisma/prisma.service.ts`, `src/prisma/prisma.service.spec.ts` and `prisma.config.ts` (B04)
  - `src/common/envelope-exception.filter.ts` (B03b)
  - Nest's two-line scaffold comment in `vitest.config.ts`

  Every comment in `src/`, `test/` and the root configs is now 50 characters or fewer.

## History
