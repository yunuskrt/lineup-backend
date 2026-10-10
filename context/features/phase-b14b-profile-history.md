# Phase B14b — Profile History

## Status

Not Started

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

## History
