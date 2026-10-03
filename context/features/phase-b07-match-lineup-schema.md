# Phase B07 — Match & Lineup Schema

## Status

Complete

## Goals

- `prisma/schema.prisma`: three enums and four models, following B05's conventions.
  - **Enums:** `Side` (`home`, `away`), `PositionGroup` (`GK`, `DF`, `MF`, `FW`) and `MatchEventKind` (Open Questions 1). Values are identical to the contract's.
  - **`Match` → `matches`:**
    - `id`, unique `slug`, `seasonId` (→ `seasons`, the competition comes through the season)
    - `date` (`@db.Date`), nullable `stage` (display text: `Final`, `Matchday 34`), nullable `nickname`
    - `extraTime` (default `false`), nullable `shootoutHome` / `shootoutAway`
  - **`MatchTeam` → `match_teams`:** one row per side.
    - `id`, `matchId`, `side`, `clubId`, `goals`
    - nullable `formation`: metadata-only matches have no lineup yet (B16 before B20)
    - unique on (`matchId`, `side`) and on (`matchId`, `clubId`)
  - **`Lineup` → `lineups`:** one row per starter.
    - `id`, `matchTeamId`, `playerId`, `slot` (0–10), `position`
    - unique on (`matchTeamId`, `slot`) and on (`matchTeamId`, `playerId`)
  - **`MatchEvent` → `match_events`:** `id`, `matchId`, `kind`, `minute`, nullable `addedTime`, `side`, nullable `playerId`.
- `prisma/migrations/<timestamp>_match_lineup/`: created with `--create-only` and edited by hand before its first apply to add:
  - an `IMMUTABLE` SQL function `formation_outfield_total(text)`
  - the CHECKs listed in Notes
- `test/schema/match-lineup.e2e-spec.ts`: rolled-back tests using `@test/schema/schema-test-utils`. Covers:
  - a full match with two XIs round-tripping
  - every constraint, by its exact name
  - delete behaviour

## Open Questions

Settled before `/feature start`.

1. **How much match detail for B19's drama signals?** `project-overview.md` scores goal count, a comeback from a half-time deficit, extra time, penalties, a 90th-minute-plus winner, red cards and hat-tricks. **Decided: model exactly enough to compute those:**
   - `MatchEventKind` = `goal`, `own_goal`, `penalty_goal`, `red_card`
   - each event has a `minute`, `addedTime` (90+3 is minute 90, added 3), the `side` it counts for, and the player when known
   - a shootout isn't an event: it's `shootoutHome` / `shootoutAway` on the match, with an `extraTime` flag

   Assists, yellow cards, substitutions and missed penalties are left out until a signal needs them.

## Out of Scope

- **Exactly 11 starters per side.** A row-level CHECK can't count rows, and lineups are written one row at a time during ingestion. The unique slot key and the 0–10 range make "at most 11" structural. "Exactly 11, and every player has an alias set" is the guessability gate (B21, Hard Constraints 13 and 17).
- **Position matching its slot in the formation**, and **no player on both sides of one match.** Both need several rows. The seed (B09) and the gate (B21) enforce them; B03a already noted that slot ↔ position is the server's job.
- **A structured stage** (final, semi, quarter, group, league) for stage weight: B16/B19 add it when scoring reads it. `stage` stays display text.
- Substitutes: never stored as answers (Hard Constraint 17). `lineups` holds starters only, with no `isStarter` flag. A goal scored by a substitute still records its `playerId` on the event.
- Memorability scores and game sessions: B08. Seeding the mock fixtures: B09.

## Notes

- Scope: four tables, three enums, one SQL helper function, one migration and a database-level test.
- Depends on: B05 (`seasons`, `clubs`), B06 (`players`), and the shared test helpers.
- **This is where the squad lives.** `lineups` is the answer key (Hard Constraint 2). Nothing in B07 reads it out. B33 and B38 must load it server-side only and send revealed players one at a time.
- CHECKs to add by hand:
  - `matches`:
    - non-blank `slug`, and `stage` / `nickname` non-blank when present
    - shootout scores both null or both set, each ≥ 0 and unequal
  - `match_teams`:
    - `goals ≥ 0`
    - `formation` null, or matching `^[1-9](-[1-9]){2,4}$` with `formation_outfield_total(formation) = 10`
  - `lineups`:
    - `slot` 0–10
    - `(slot = 0) = (position = 'GK')`: slot 0 is the goalkeeper and no other slot is (`api-contract.md` § RevealedPlayer)
  - `match_events`:
    - `minute` 1–120, `added_time` null or 1–30
    - `added_time` only at minute 45, 90, 105 or 120
- Delete behaviour:
  - `MatchTeam → Match`, `Lineup → MatchTeam` and `MatchEvent → Match` cascade: a match owns its sides, lineups and events.
  - `Match → Season`, `MatchTeam → Club`, `Lineup → Player` and `MatchEvent → Player` restrict: a player or club with history can't vanish.
- Indexes: every FK column indexed (`matches.season_id`, `match_teams.club_id`, `lineups.player_id`, `match_events.match_id`, `match_events.player_id`), or covered by a composite unique that starts with it.
- Conventions carried from B05 and B06:
  - snake_case names, `@db.Uuid` + `uuid(7)` ids, explicit `onDelete`
  - hand-written SQL only between `--create-only` and the first apply
  - a drift probe afterwards
  - **`npm run db:generate` after migrating**, since Prisma 7 doesn't do it
  - tests name the exact constraint
- Verification:
  - `npx prisma validate` and `npx prisma format --check` pass.
  - `npm run db:migrate` applies. `db:status` exits 0. The drift probe is empty: Prisma ignores the function and the CHECKs.
  - `npm run test:e2e`: the round-trip passes, every CHECK and unique key rejects its row by name, and cascade and restrict behave as listed.
  - `npm test`, `npm run build` and `npm run lint` pass. The dev branch holds 0 match rows after the suites.

**Deviations recorded during implementation**

- Back-relations added to existing models, which Prisma requires on both sides: `Season.matches`, `Club.matchTeams`, `Player.lineups`, `Player.matchEvents`. No column changes to the B05/B06 tables.
- **`formation_outfield_total(text)` returns `NULL` for anything that isn't single digits joined by dashes.** SQL doesn't guarantee that `regex AND function()` evaluates left to right. If the function cast `'a'::integer`, `4-a-2` would raise a cast error instead of a clean CHECK violation. `false AND NULL` is `false`, so the CHECK still rejects. Declared `IMMUTABLE STRICT PARALLEL SAFE`.
- 8 CHECK constraints, plus the helper function:
  - `matches_text_check`, `matches_shootout_check`
  - `match_teams_goals_check`, `match_teams_formation_check`
  - `lineups_slot_check`, `lineups_goalkeeper_check`
  - `match_events_minute_check`, `match_events_added_time_check`

  The drift probe was empty, so Prisma ignores both the function and the CHECKs. It was deleted unapplied.
- `match_teams.match_id` has no separate index; the `(match_id, side)` unique key covers it.
- `matches.date` is `@db.Date`. Prisma returns it as a JS `Date` at UTC midnight, so the API layer (B33/B38) must format it as `YYYY-MM-DD` for `MatchIdentity.date`, never `toISOString()` whole.
- The e2e suite uses a `buildMatch()` fixture: competition, season, 2 clubs, 22 players and two 4-4-2 XIs, built with `createManyAndReturn`. Each of the 44 cases builds a fresh one inside its own rolled-back transaction. The dev branch held 0 rows in all four tables afterwards.
- **A shootout doesn't require `extra_time = true`.** That's deliberate: some competitions go straight to penalties at 90 minutes. A test pins it.
- **`match_teams.goals` isn't reconciled with goal events.** The two can disagree because the rule spans rows. Ingestion (B16/B20) and scoring (B19) must not assume they agree until something reconciles them.
- **For B17:** `lineups → players` and `match_events → players` are `Restrict`. Merging duplicate players means moving their lineup and event rows to the surviving player *before* deleting the duplicate.
- Tests added at `/feature test`:
  - `formation_outfield_total()` called directly: `4-2-3-1` → 10, `4-4-3` → 11, `4-a-2` / `10-0` / `''` / `NULL` → `NULL`
  - a shootout without extra time is accepted

  52 cases in the suite.
- **Housekeeping:** five comments in `prisma/schema.prisma` were over 50 characters, three of them from B05/B06; B06's repo-wide scan had missed `.prisma` files. All shortened, and a second drift probe confirmed the change was comment-only.

## History
