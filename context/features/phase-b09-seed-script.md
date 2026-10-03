# Phase B09 — Seed Script

## Status

Complete

## Goals

- `scripts/seed/data/`: the web mock's fixtures, transcribed by hand from `lineup-web/src/lib/api/mock/data/`. Same ids, names, dates, scores, formations and aliases:
  - `competitions.ts`: 6 competitions
  - `clubs.ts`: 11 clubs (7 clubs, 4 national teams)
  - `players.ts`: 167 players with their aliases
  - `matches.ts`: 10 matches, each with two XIs
- `scripts/seed/seed-data.schema.ts`: Zod schemas that validate the transcription before any write, built from `src/contract/` pieces (`competitionKindSchema`, `positionGroupSchema`, `formationSchema`, `isoDateSchema`, the season constants)
- `scripts/seed/seed.ts`: `seed(tx)` writes the whole set inside one transaction and returns counts. Idempotent: a second run changes nothing.
- `scripts/seed/main.ts`: the entry point. It refuses `NODE_ENV=production`, opens its own `PrismaClient` (adapter-pg, like `PrismaService`), runs `seed` and prints one count line per table.
- Wiring:
  - `prisma.config.ts`: `migrations.seed` runs the entry point
  - `package.json`: a `db:seed` script
  - `tsconfig.json`: an `@scripts/*` alias
  - `npm run lint`: also covers `scripts/`
- Tests:
  - `scripts/seed/seed-data.spec.ts` (unit, no database):
    - the transcription parses
    - the counts are 6 / 11 / 167 / 10
    - every lineup id resolves to a player
    - each side has 11 unique slots and players, with GK only in slot 0
    - no player starts for both sides
    - every season label agrees with its date
    - every alias is non-blank and passes the `normalized` CHECK's pattern
  - `test/seed/seed.e2e-spec.ts` (rolled back):
    - `seed(tx)` run twice gives identical row counts and ids
    - one match round-trips with both XIs
    - an edited fixture converges: a changed name and a removed alias are updated, not duplicated

## Data

How the mock maps onto the B05–B08 tables:

| Mock | Table and columns |
| --- | --- |
| Competition `id`, `kind`, `name` | `competitions`: `slug` = mock id |
| A match's `season` within its competition | `seasons`: `(competition_id, label)`, `start_year` = the label's first four digits |
| Club `id`, `name`, `shortName` | `clubs`: `slug` = mock id. `kind` is `national_team` for `nat-*` ids, else `club` |
| Club `crestUrl` | `clubs.crest_key`: `null` (Open Questions 3) |
| Player `id`, `name` | `players`: `slug` = mock id, `name` keeps its diacritics |
| Player `aliases` (already normalized by the web) | `player_aliases`: `alias` and `normalized` both take the mock string |
| Player `imageUrl` | `players.image_key`: `null` (Open Questions 3) |
| Match `id`, `date`, `stage`, `nickname` | `matches`: `slug` = mock id. `extra_time` is false, shootouts are null |
| `score.home` / `score.away`, `homeClubId` / `awayClubId`, `formation` | `match_teams`: one row per side |
| `lineup[]` entries | `lineups`: `slot`, `position`, `player_id` |

The mock has no events, club aliases, shootouts or extra time. Those tables and columns stay empty; nothing is invented to fill them.

## Open Questions

All three settled at `/feature load`.

1. **Should the seed write placeholder `memorability_scores`?** The pool needs a score (Hard Constraint 13), and B19 computes it. The mock carries no events or cultural signals, so B19 may score these matches low. **Decided: no.** A score is an engine output, never hand-made, and B19/B25 decide how dev fixtures enter the pool.
2. **How does the TypeScript seed run?** Plain Node doesn't resolve `@/` or `@scripts/`, or map the `.js` import suffixes back to `.ts`. **Decided: `tsx` as a devDependency.** It reads the tsconfig paths, and `prisma db seed` and `npm run db:seed` both call it.
3. **What goes into `crest_key` and `image_key`?** They are bucket keys, never URLs. The mock's root-relative paths point at the web's `public/` folder, which no bucket holds, and W27 tightens `imageUrlSchema` to absolute URLs. **Decided: `null` everywhere.** The contract allows a null crest and image, and B24 fills in real keys.

## Out of Scope

- Real data: B15–B24. Nothing here calls a provider.
- `memorability_scores`, `game_*`, `guesses` and `user_stats` rows.
- Pruning: the seed never deletes a competition, club, player or match missing from the data. Deleting would hit the Restrict foreign keys from history. Only a seeded match's own lineups and a seeded player's own aliases are synced.
- Re-normalising aliases with the backend's own pipeline. That belongs to B27 (see Notes).
- Checking each `position` against its formation slot. The web's fixtures test already enforces it, and the backend's formation logic belongs to `src/game/`.

## Notes

- Scope: one script, its data and two test files. No module in `src/`, and no migration.
- Depends on: B05–B08 (the tables and CHECKs) and the shared test helpers in `test/schema/`.
- **No cross-repo import.** The data is copied file by file, never imported or symlinked from `lineup-web`; this repo must still build with the web repo deleted. The header comment says the data is fictional and transcribed from the web mock.
- **Idempotency.** Every write is keyed by a natural unique key:
  - `slug` for competitions, clubs, players and matches
  - `(competition_id, label)` for seasons
  - `(match_id, side)` for match teams
  - `(player_id, normalized)` for aliases

  Lineups are synced by replacing that side's rows inside the transaction, since swapping two players between slots would otherwise hit `lineups_match_team_id_player_id_key` partway through. Ids stay stable across runs because nothing top-level is ever deleted.
- **One transaction.** The run is all or nothing: a CHECK failure halfway leaves the database as it was. Writes are batched with `createMany` where possible, and the interactive transaction gets a longer timeout, because Neon round-trips add up over about 900 rows.
- **The squad is never logged.** The entry point prints only table counts. No player names, lineups or aliases appear on stdout or in an error message. Prisma's `errorFormat: 'minimal'` stays.
- **Slugs are the mock ids** (`club-northgate`, `pl-gareth-pennock`, `match-crown-2003`), so a seeded row can be traced to the web fixture. None of them starts with `test-`, so the existing suites' leftover checks still work with the seed loaded.
- **Alias normalisation now lives in the web's pipeline.** The mock stores aliases already normalised (its `normalizeName`), so both columns take the same string. **B27 must check that its own pipeline maps every seeded alias to itself** and re-seed if not. Some aliases collide on purpose (`harlow` belongs to two players), which tests B29's surname rule.
- Constraints:
  - `@/` and `@scripts/` imports only
  - comments are single-line and at most 50 characters
  - no `any`
  - `scripts/` may import from `src/`, never the reverse
- Verification:
  - `npm test` passes, including the transcription spec.
  - `npm run test:e2e` passes, including the seed suite, with every existing suite still green while the seed's rows sit in the dev branch.
  - `npm run db:seed` loads the dev branch. A second run prints the same counts, and spot queries show no duplicate rows.
  - `npx prisma db seed` runs the same entry point.
  - `npm run build` and `npm run lint` pass. `dist/` contains nothing from `scripts/`.

**Deviations recorded during implementation**

- **Diff-then-write, not upsert.** Each table is read once, then only missing rows are created (`createManyAndReturn`) and only changed rows are updated. A Prisma upsert would bump `updated_at` on every rerun. A second run writes nothing at all, and the e2e suite checks that every id and `updated_at` stays the same.
- **The seed writes only what the mock carries.** `crest_key`, `image_key`, `extra_time` and the shootout columns are left out of the writes, so new rows take their defaults (`null`, `false`). A rerun never clears a value set later, such as a B24 image key.
- **Report shape:** `seed()` returns `{ rows, changes }` per table, and the entry point prints one line each. A rerun printing `0 changed` everywhere is the idempotency check.
- **Wiring:**
  - `db:seed` is `prisma db seed`. `prisma.config.ts` runs `tsx scripts/seed/main.ts`, and its `loadEnvFile` supplies `DATABASE_URL`.
  - To run the entry point without Prisma, use `node --env-file=.env --import tsx scripts/seed/main.ts`.
  - The `format` script now covers `scripts/` too.
- **`tsx` is pinned exactly to 4.23.15.** npm's install-scripts policy skipped esbuild's postinstall. tsx works anyway, because esbuild's platform binary arrives as an optional dependency.
- **Transcription:** the web's `competitions.ts` holds both competitions and clubs. It's split here into `competitions.ts` and `clubs.ts`. `imageUrl` and `crestUrl` were dropped, since nothing stores them. All other values are copied unchanged.
- **Validation errors name a path, never a value,** for example `matches[0].home.lineup[3].playerId: Unknown player`. A bad fixture can't print a name or an XI. Validation runs before the first write, and a test pins that.
- **Counts loaded into the dev branch:**

  | Table | Rows |
  | --- | --- |
  | competitions | 6 |
  | seasons | 10 |
  | clubs | 11 |
  | players | 167 |
  | player aliases | 345 |
  | matches | 10 |
  | match teams | 20 |
  | lineups | 220 |

  Every player starts at least once. Events, scores and sessions stay at 0. A cold run took about 3 s, and the second printed `0 changed` everywhere.
- **Tests:**
  - 29 unit cases cover counts, references, slots, the shared `harlow` surname, 14 rejections and 10 `seasonIssue` cases.
  - 6 e2e cases cover:
    - a rerun as a no-op
    - a match round-trip
    - national teams without crests
    - convergence: a renamed player, a dropped alias, and two starters swapped between slots
    - a match and its side updated in place: date, nickname, score and formation, with the same ids
    - invalid data writing nothing
  - The match update case and the "player twice in one XI" rejection were added at `/feature test`.
  - With the seed's rows in the dev branch, all suites are green: 177 unit and 168 e2e.
  - **Coverage:** `seed-data.schema.ts` is at 98% of lines from unit tests alone. `seed.ts` is at 86% of lines from the e2e suite.
  - What's left uncovered in `seed.ts`:
    - the competition, season and club update callbacks, which run the same `sync` path the tests already cover
    - an alias update, impossible while `alias` equals `normalized`
    - a stored XI with more than 11 rows, which the unique keys prevent
  - `main.ts` has no automated test. Its production refusal and count-only output were checked by hand.
- **Review fixes:**
  - The per-entity schemas are no longer exported. Only `seedDataSchema`, `seasonIssue` and the input and output types are used outside the file.
  - The stale-lineup check uses a key set instead of a nested `some`.
- **Known limit, found at review:** swapping a match's home and away clubs fails the rerun on `match_teams_match_id_club_id_key`. The home row is updated first, while the away row still holds that club. The transaction rolls back cleanly, so nothing is half-written. No fixture swaps clubs; if one ever does, delete that match's teams by hand before reseeding.
- The pg warning "client.query() when the client is already executing a query" was already there: the B07 suite prints it too. It comes from the adapter's interactive transactions, not from the seed.

## History
