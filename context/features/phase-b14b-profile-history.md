# Phase B14b — Profile History

## Status

Complete

## Goals

- `src/matches/match-refs.ts`: `toCompetitionRef` and `toMatchIdentity`, pure mappers from a Prisma match (with season, competition, both teams and their clubs) to the contract `MatchIdentity`:
  - `season` is the season's `label`; `date` is `YYYY-MM-DD`
  - `home` and `away` come from the `match_teams` row for each side, and the score from their `goals`
  - `stage` and `nickname` are copied, `null` included
  - never reads a lineup: history shows the match, not the XI
- `src/users/history.service.ts`, or a `historyOf(userId, query)` method on `UsersService` (implementer's choice): one page of the user's finished games, newest first.
  - **Rows:** the user's `game_participants` whose session is `over`
  - **Excluded:** active sessions, and duels whose participant has no `duel_outcome` yet (written by B41)
  - **Order:** `ended_at` descending, then session id descending (Open Questions 1)
  - **Paging:** fetch `limit + 1` rows. The extra row's id is `nextCursor`, or `null` if there isn't one. A cursor names the first entry of its page (Open Questions 2).
- **Each `HistoryEntry`:**
  - `id`: the game session's id
  - `playedAt`: `ended_at` as ISO 8601
  - `match`: `toMatchIdentity(...)`
  - `mode`: from the session
  - `outcome`: `solo_end_reason` for solo, the participant's `duel_outcome` for duel
  - `livesRemaining`: the participant's `lives_remaining`
  - `foundCount`: `correct_new` guesses across the whole session. For a duel that's the shared found pool, both players' finds (Open Questions 4).
- **No N+1:** one page query, plus at most one grouped count for `foundCount`. Never a query per entry.
- `src/users/profile.controller.ts`: `GET /profile/history?cursor=&limit=`.
  - query validated with `historyQuerySchema` (B03a): `limit` 1–50, default 20
  - `@DocumentsSession()` and `@ContractResponse(historyPageSchema)`
- **Cursor errors are `invalid_input`** (Open Questions 3). That covers a cursor that:
  - isn't a UUID, which must never reach Prisma as a malformed uuid
  - doesn't exist
  - belongs to another user
  - names a session that isn't finished
- Tests:
  - `src/matches/match-refs.spec.ts`: `toMatchIdentity` puts sides and scores the right way round, formats the date, and passes `matchIdentitySchema`
  - history unit spec, with a mocked `PrismaService`:
    - solo and duel rows map to the right `outcome`
    - `foundCount` comes from the counts
    - a full page gives `nextCursor`, and a short page gives `null`
    - each kind of bad cursor is refused
  - `test/users/history.e2e-spec.ts`. It commits its own competition, season, clubs, match, sessions, participants, rounds and guesses (`test-history-` slugs):
    - no session gives a 401
    - a new account has an empty page with `nextCursor: null`
    - finished solo and duel games come back newest first and pass `historyPageSchema`
    - an active session and an outcome-less duel are left out
    - another user's games never appear
    - a duel's `foundCount` counts the opponent's finds too
    - paging with `limit=2` walks every entry once, with no repeats or gaps, and ends with `nextCursor: null`
    - `limit=0`, `limit=51` and every bad cursor give `invalid_input`
    - a guest's history survives an upgrade, read through this route

## Open Questions

All four settled at `/feature load`, each as recommended.

1. **Order, and what `playedAt` means.** **Recommended: order by `ended_at`, newest first, with the session id as the tie-break, and set `playedAt` to `ended_at`.**
   - The web mock records an entry when a game ends.
   - B08's CHECK guarantees `ended_at` on every finished session.
   - Ordering by session id alone (uuid v7, so start time) would put a long duel below a later, shorter solo run.
2. **Cursor meaning.** **Recommended: the cursor is the id of the first entry on the page it opens, so the page includes it.** This is the web mock's `pageOf` behaviour, and it falls out of fetching `limit + 1`. Paging is keyset: the cursor row's `(ended_at, id)` is looked up, then rows at or after it in the sort order. No offsets.
3. **A bad cursor.** The mock silently restarts from page one. **Recommended: `invalid_input`.** Restarting would show page one again inside an infinite list. The contract already lists `invalid_input` for `getHistory`.
4. **`foundCount` in a duel: yours, or the pool?** **Recommended: the shared pool,** as the mock does (`result.found.length`). It answers "how much of the XI got named", the same as the duel result screen. Per-player finds stay derivable from `guesses` if a Pro stat wants them later.

## Out of Scope

- Writing history: B34 (solo) and B41 (duel). Until then, a real account's history is empty; only the e2e fixtures fill it.
- Merging a guest's history into a different, existing account: B34 (B11a Open Questions 2).
- Indexing the history query: B26 measures it. `game_participants.user_id` is indexed already (B08).
- Post-game detail for one history entry: not in the contract.

## Notes

- Scope: `GET /profile/history` and the `MatchIdentity` mapper. B14a must be complete.
- Depends on: B14a (users module, `match-refs.ts`, `ProfileController`), B08 (session tables and CHECKs), B07 (match and team tables).
- The contract is already defined in `src/contract/profile.ts`: `historyQuerySchema` (cursor optional, `limit` coerced from text), `historyEntrySchema` and `historyPageSchema`. No new schema.
- **The squad is never sent** (Hard Constraint 2). The query selects no `lineups` and no guess text, and `foundCount` is a number, not a list of players.
- **Scoped to the session's user.** The only user id is `@CurrentUser().id`, and the cursor lookup filters on it too, so a cursor can't read or probe another user's games.
- `memorability_score` is never selected (Hard Constraint 20).
- Constraints:
  - no `any`; `@/` imports; comments single-line, at most 50 characters
  - every route keeps `@ContractResponse` (fail-closed)
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`
  - By hand: `curl` `GET /profile/history` with and without `limit` and `cursor`, against rows inserted with the docs' SQL or the e2e fixtures
  - The e2e file owns its prefixes (`test-history-` emails and slugs, `test-hi-` handles) and deletes its sessions before its users, since `game_participants → users` is `RESTRICT`

**Deviations recorded during implementation**

- **A separate `HistoryService`** (`src/users/history.service.ts`), not a method on `UsersService`. The spec left it to the implementer; it keeps the paging logic out of the stats read.
- **`match-refs.ts` exports `MATCH_IDENTITY_SELECT` next to `toMatchIdentity`.** The mapper's input type is derived from that select (`Prisma.MatchGetPayload`), so the query and the mapper can't drift, and the select names no lineup. `toCompetitionRef` takes the selected competition row.
- **`foundCount` uses Prisma's filtered relation `_count`,** one `gameRound.findMany` for the whole page, summed in memory. No raw SQL. A session has at most about 17 rounds (11 finds plus 6 expiries in a duel), so a 50-entry page reads under 900 small rows. An empty page skips the query.
- **Rows the CHECKs should rule out fail loudly** instead of being skipped or guessed:
  - a match missing a side
  - a finished session with no `ended_at`
  - a solo run with no end reason
  
  Each throws and becomes a `server_error`. B08's CHECKs make all three unreachable; a duel with no outcome is filtered out in the query, not thrown.
- **The cursor is checked with `z.uuid()` in the service** before any query, so a malformed value never reaches Prisma's uuid column. Unknown, foreign, unfinished and outcome-less-duel cursors all fail one lookup that uses the same "finished game of this user" filter as the page. Message: `BAD_CURSOR`, "That history page is not available. Start again."
- **OpenAPI:** `@ApiQuery` documents `cursor` (uuid, optional) and `limit` (integer 1–50, default 20).
- **Three schema suites' "leaves no rows behind" checks were narrowed to their own slugs:** `club-competition` (clubs), `player-alias` (players) and `match-lineup` (matches).
  - They counted every `test-` row in the database. The history suite commits `test-history-` club, player and match rows for its whole run, so the first full e2e run failed two of them.
  - B14a's `test-profile-club` and B11a's `test-guest-history` match could race them the same way.
  - This is the fix B11a applied to the seed suite: a suite checks only what it creates.
- **E2E fixtures give duels a side too:** B08's later `game_sessions_side_check` requires `side` on a duel session.
- **Tests:** 375 unit (15 new) and 293 e2e (12 new). The full e2e suite passed twice in a row after the fix.
  - `match-refs.spec.ts`: sides and scores from `side`, not list order; the date; a nickname and a null stage; a missing side throws; passes `matchIdentitySchema`
  - `history.service.spec.ts`:
    - the where, order and `take`
    - an empty page with no count query
    - solo and duel outcomes; `playedAt`
    - found counts summed in one query; 0 with no rounds
    - `nextCursor` on a full page and `null` on a short one
    - the keyset where for a cursor
    - a non-UUID refused without a query; a lookup miss refused
    - CHECK-violating rows throw
  - `test/users/history.e2e-spec.ts`:
    - 401
    - an empty page
    - solo and duel newest first, with the full `MatchIdentity`, passing `historyPageSchema`
    - active and outcome-less duels left out
    - another user's games hidden
    - a duel's pool counts both players, seen by each
    - `limit=2` walks five entries with a tie, in order, with cursors as expected
    - bad limits (`0`, `51`, `two`)
    - four bad cursors
    - a guest's history read after an upgrade
- **Checked by hand** on the built server (port 8081), with three finished solo rows on seeded matches:
  - the default page listed all three, newest first, with full match identities
  - `limit=2` gave two and a cursor; the cursor opened a page with the third and `nextCursor: null`
  - `cursor=nope` and `limit=99` gave `invalid_input`, and no session gave the 401
  
  The rows and the user were deleted, and no `test-` clubs, players, matches or users remain.
- **Review:** every goal is met. One small change: `club-competition`'s own-slug list gained `test-blank`, the slug of its rejected blank-name insert, so the list names every club slug the file uses.
  - **Keyset paging is exact:** a cursor page takes rows ending before the cursor's `ended_at`, or at the same instant with a session id at or below it. That mirrors the `(ended_at desc, id desc)` order, so a tie at the page edge is never skipped or repeated (pinned by the e2e walk). `ended_at` is `timestamp(3)` and a JS `Date` holds milliseconds, so the equality is exact.
  - **One entry per game:** `(session_id, user_id)` is unique, so a user has one participant row per session.
  - **No 500 from ordinary data:** `ContractResponse` fails a whole page on one bad field, but the database guarantees every string rule `MatchIdentity` checks: season label format, non-blank stage and nickname (`matches_text_check`), non-blank club names.
  - **Repeated query keys** (`?limit=1&limit=2`, two cursors) arrive as arrays and fail `historyQuerySchema`, giving `invalid_input`.
  - **No leaks:** a foreign cursor gets the same message as an unknown one. The internal `Error`s name only a session or match id, and the envelope filter sends a generic `server_error`.
  - **Hard Constraints:** no lineup, guess text or memorability score is selected.
- **Observation left for later (B26):** the page query joins `game_sessions` to sort by `ended_at`. `game_participants.user_id` is indexed; an index on `game_sessions (ended_at, id)` is B26's to measure once B34 and B41 write real history.
- **`/feature test`:** no new tests needed. **Coverage from unit tests:**
  - `history.service.ts`: 100% lines, statements and functions; 96% branches. The one uncovered branch (line 45, `@Injectable()`) is the constructor-parameter metadata TypeScript emits for Nest DI, as in B14a.
  - `match-refs.ts`: 100%.
  - `profile.controller.ts`'s history route and `users.module.ts` are wiring, covered by the 12 history e2e cases.

## History
