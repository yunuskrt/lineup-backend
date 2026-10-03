# Phase B08 — Scoring & Session Schema

## Status

Complete

## Goals

- `prisma/schema.prisma`, following B05–B07's conventions:
  - **Enums** (values identical to the contract's wherever one exists):
    - `GameMode`: `solo`, `duel`
    - `GameStatus`: `active`, `over`
    - `SoloEndReason`: `lives_out`, `quit`, `perfect_clear`
    - `DuelOutcome`: `win`, `loss`, `draw`, `forfeit_win`
    - `RoundEndReason`: `found`, `expired`, `ended`
    - `GuessOutcome`: `correct_new`, `already_found`, `not_in_xi`
  - **`MemorabilityScore` → `memorability_scores`:** one row per match.
    - `matchId` (unique), `score` (0–100), `signals` (`Json`: the per-signal breakdown for QA), `algorithmVersion`, `computedAt`
  - **`GameSession` → `game_sessions`:** one solo run or one duel.
    - `id`, `mode`, `status`, `matchId`
    - nullable `side`: a solo run has none until the player picks it
    - `startedAt`, nullable `endedAt`, nullable `soloEndReason`
  - **`GameParticipant` → `game_participants`:** one row per player in a session (Open Questions 2).
    - `id`, `sessionId`, `userId`, `seat` (0, or 0–1 in a duel)
    - `livesRemaining` (0–3), nullable `duelOutcome` (from this player's view)
    - unique on (`sessionId`, `seat`) and on (`sessionId`, `userId`)
  - **`GameRound` → `game_rounds`:**
    - `id`, `sessionId`, `number` (1, 2, …), `participantId` (whose turn)
    - `startedAt`, `endsAt` (the server clock), nullable `endedAt` and `endReason`
    - unique on (`sessionId`, `number`)
  - **`Guess` → `guesses`:**
    - `id`, `roundId`, `text` (as received, trimmed), `outcome`
    - nullable `playerId`: the starter it resolved to; null for `not_in_xi`
    - `receivedAt` (server time)
  - **`UserStats` → `user_stats`:** `userId` (primary key) and the profile counters (Open Questions 3).
- `prisma/migrations/<timestamp>_scoring_session/`: created with `--create-only`, then the CHECKs from Notes added by hand before the first apply
- `test/schema/scoring-session.e2e-spec.ts`: rolled-back tests covering:
  - a solo run and a duel round-tripping
  - every constraint, by its exact name
  - delete behaviour

## Open Questions

All three settled before `/feature start`.

1. **How do these tables refer to users before B10 exists?** Better Auth creates its own user tables in B10. Its default ids are strings, not UUIDs, and its own `Session` model takes that name. **Decided:**
   - `userId` columns are plain `String` (`text`, not `@db.Uuid`), with **no foreign key yet**
   - B10 adds the foreign keys in its own migration, once `users` exists and its id type is known

   The alternative is a hand-made `users` table now, which means guessing Better Auth's required columns before B10 has researched them.
2. **How are a duel's two players stored?** Each has their own lives, turn and outcome. **Decided: a `game_participants` table,** one row for a solo run and two for a duel, with rounds pointing at the participant whose turn it was. This is one table beyond the todo line. The alternative is two user columns on `game_sessions`, which duplicates every per-player field.
3. **Are profile stats stored or computed?** **Decided: a stored `user_stats` row** updated in the same transaction that ends a session (B34 solo, B41 duel). Columns:
   - `played`, `wins`, `losses`, `draws`, `perfectClears`, `bestStreak`
   - `correctGuesses`, `totalGuesses` (accuracy is derived)
   - nullable `favouriteClubId`

   The profile then reads one row. Computing from history every time gets slower as history grows, and the overview lists `stats` as a persisted table.

## Out of Scope

- The `users` table, auth sessions, accounts and guests: B10/B11. Foreign keys from `user_id` arrive with them.
- Live state (queue, timers, sockets): in memory, later Redis (B46). Only a game's lasting record is persisted here. Duel phases like `queued` / `paired` never reach the database.
- Writing any of these rows: B19 (scores), B34 (solo), B41 (duel). B08 is the shape only.
- Per-club and per-era stat breakdowns, and most-missed players (Pro): deferred with monetization.
- Which filter set won a duel's coin flip: B41 adds a column if the history screen needs it.

## Notes

- Scope: six tables, six enums, one migration and a database-level test.
- Depends on: B07 (`matches`, `players`), B05 (`clubs`), and the shared test helpers.
- **`memorability_score` is never exposed** (Hard Constraint 20): no contract field, no endpoint, no sort order anyone can see. Only the selector (B25) and the QA report (B22) read it.
- **Guess text is stored as received** (trimmed, 1–64 characters). `project-overview.md` collects "known misspellings from live play" for the alias table, which needs the raw text. Guesses are never logged (`CLAUDE.md`).
- Guesses hold `playerId` for what they resolved to. That's server-side data, and only revealed players reach a client.
- CHECKs to add by hand:
  - `memorability_scores`: `score` between 0 and 100; non-blank `algorithm_version`
  - `game_sessions`:
    - `(status = 'over') = (ended_at IS NOT NULL)`
    - `solo_end_reason` set only when `mode = 'solo'` and the session is over
    - `ended_at >= started_at`
  - `game_participants`: `lives_remaining` 0–3; `seat` 0–1
  - `game_rounds`:
    - `number ≥ 1`
    - `ends_at > started_at`
    - `(ended_at IS NULL) = (end_reason IS NULL)`
  - `guesses`:
    - `text = btrim(text)` and length 1–64
    - `(outcome = 'not_in_xi') = (player_id IS NULL)`
  - `user_stats`:
    - every counter ≥ 0
    - `wins + losses + draws ≤ played`
    - `correct_guesses ≤ total_guesses`
- Rules that span rows, enforced by the services (B34/B41) instead:
  - a solo session has exactly one participant and a duel exactly two
  - `duel_outcome` only in a duel
  - a round's participant belongs to its session
- Delete behaviour:
  - Participants, rounds and guesses cascade from their session or round.
  - `game_sessions → matches`, `guesses → players` and `memorability_scores → matches` restrict, so history can't lose its match or player.
  - `user_stats.favourite_club_id → clubs` is `SetNull`.
- Conventions carried from B05–B07:
  - snake_case names, `uuid(7)` ids, every FK indexed
  - hand-written SQL only between `--create-only` and the first apply
  - a drift probe afterwards, then **`npm run db:generate`**
  - tests name the exact constraint
- Verification:
  - `npx prisma validate` and `npx prisma format --check` pass.
  - `npm run db:migrate` applies. `db:status` exits 0. The drift probe is empty.
  - `npm run test:e2e`: a solo run and a duel round-trip, every CHECK and unique key rejects its row by name, and cascade and restrict behave as listed.
  - `npm test`, `npm run build` and `npm run lint` pass. The dev branch holds 0 rows in the new tables afterwards.

**Deviations recorded during implementation**

- **`solo_end_reason` is "if and only if", not just "only when".** `game_sessions_end_reason_check` is `(solo_end_reason IS NOT NULL) = (mode = 'solo' AND status = 'over')`, so a finished solo run can't be missing its reason either. That's stricter than the spec's wording, so nothing the spec allowed is lost.
- One rule beyond the listed ones: `game_rounds_time_check` also requires `ended_at >= started_at`. `ended_at` may pass `ends_at` (the 400 ms grace window, or a late expiry); a test pins 15.4 s. Corrected at review: this note first claimed two extra CHECKs, but `game_sessions_time_check` was in the spec's list.
- 15 CHECK constraints in all:
  - `memorability_scores_score_check` / `_version_check`
  - `game_sessions_status_check` / `_end_reason_check` / `_time_check`
  - `game_participants_lives_check` / `_seat_check`
  - `game_rounds_number_check` / `_time_check` / `_end_check`
  - `guesses_text_check` / `_player_check`
  - `user_stats_counters_check` / `_results_check` / `_guesses_check`

  The drift probe was empty and was deleted unapplied.
- **Second migration, `scoring_session_checks`,** added at `/feature test` from the review. The first migration was already applied, and an applied migration is never edited. It adds two CHECKs, making 17 for B08:
  - `game_sessions_side_check`: `mode = 'solo' OR side IS NOT NULL`. A solo run may wait for its side; a duel never can, because the server picks it before the session exists.
  - `user_stats_best_streak_check`: `best_streak <= 11`. The web mock's profile streak is `Math.max` of per-game streaks, and one XI has 11 starters, so a higher value means B34/B41 counted across games.

  The drift probe was empty. Four tests cover the rule and its allowed case for each. The suite now has 46 cases.
- **Considered, not done:** a composite FK `game_rounds (participant_id, session_id) → game_participants (id, session_id)` would stop a round pointing at another session's player in the database. It costs an extra unique index and a more complex Prisma relation; the rule stays with B34/B41 as the spec says.
- `score` is `Float` (`double precision`). `NaN` is rejected: Postgres orders `NaN` above every number, so `BETWEEN 0 AND 100` fails. A test pins it.
- `user_id` is `TEXT NOT NULL` with no foreign key, in `game_participants` and as the primary key of `user_stats`. **B10 must add both foreign keys** once Better Auth's `users` table exists, with matching id types.
- Back-relations on existing models: `Match.sessions`, `Match.memorability`, `Player.guesses`, `Club.favouredBy`. No column changes to earlier tables.
- `GameSession.startedAt` and `Guess.receivedAt` default to `now()`. `GameRound.startedAt` / `endsAt` have no default, because the server clock sets them explicitly.
- **`buildMatch()` moved** from the B07 suite into `test/schema/schema-fixtures.ts` (with `POSITIONS_442` and `Built`). Both suites import it; B07's 52 tests still pass.
- The new suite has 42 cases: a solo run and a duel round-trip, every CHECK and unique key by name, cascade from a session, the SetNull on a favourite club, and three restricted deletes. All six new tables held 0 rows afterwards.

## History
