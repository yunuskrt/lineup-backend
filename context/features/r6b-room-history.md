# R6b — Room History

## Status

Not Started

## Goals

- **Migration** (`npx prisma migrate dev --name game_session_is_private`):
  - `game_sessions.is_private BOOLEAN NOT NULL DEFAULT false`; every existing row becomes `false`
  - a hand-written CHECK, as B08's are: `NOT "is_private" OR "mode" = 'duel'`. A solo run is never private
  - `GameSession.isPrivate` in `prisma/schema.prisma`, `@default(false) @map("is_private")`
  - applied to `dev` and `ingest` over the direct host; never `production`
- **Persistence**, `src/duel/duel-persistence.service.ts`:
  - `FinishedDuel` gains `isPrivate`, from the room's `origin` (R6a): `true` for `room`, `false` for `queue`
  - the session row is written with it, in the same one-transaction save as today (B41)
  - stats unchanged: a room game counts toward wins, losses, draws, accuracy and streaks like any duel
- **Contract**, `src/contract/profile.ts`: the duel variant of `HistoryEntry` gains `isPrivate: boolean`. The solo variant is unchanged
- **History**, `src/users/history.service.ts`: selects `isPrivate` and sends it on every duel entry
- **Unit tests:**
  - `duel-persistence.service.spec.ts`: a room duel writes `isPrivate: true`; a queue duel `false`
  - the history mapping: a duel row carries `isPrivate` through; a solo entry has no such field
  - `src/contract/profile.spec.ts`: a duel entry without `isPrivate` fails; a solo entry with it is stripped
- **E2E**, on `dev`:
  - `test/schema/scoring-session.e2e-spec.ts`: the default is `false`; the CHECK refuses a private solo row
  - the harness room game is saved with `is_private = true`, and both players' history rows have `isPrivate: true`; a queue game has `false`
- **Docs:**
  - `context/api-contract.md` § 4: `HistoryEntry`'s `isPrivate` row (duel only)
  - OpenAPI: `HistoryEntry`'s duel variant shows `isPrivate`
  - `context/docs/scraper-data-contract.md`: the regenerated table list or schema notes, if they mention `game_sessions` columns. The scraper never writes this table

## Your part

1. **At `/feature load`:** nothing new to decide unless you want to change something below
2. **At `/feature start`:** the migration runs on `dev` and `ingest` (as for R3b). `.env` points at `dev` for `migrate dev`; I apply it to `ingest` with `migrate deploy` over its direct host, without printing it
3. **At `/feature test`:** point `.env` at `dev` for the e2e run. You edit `.env` yourself
4. **At `/feature complete`:** approve the commit, the merge into `main` and the push

## Decisions

Decided 2026-11-08, before load:

- **`is_private BOOLEAN NOT NULL DEFAULT false`**, not an `origin` enum. It maps one to one onto `HistoryEntry.isPrivate`, and existing rows need no backfill
  - rejected: a `duel_origin` enum (`queue`, `room`), which leaves room for later origins such as a rematch
- **Depends on R6a:** the room's `origin` is what the save reads. R6a ships first

## Notes

- **Why:** the web tags room games "vs friend" in history. Asked in `lineup-web/context/docs/backend-requests.md` § R6, Persistence (2026-11-08)
- **Numbering:** web request R6, persistence part. Not a `todo.md` phase. Don't edit `todo.md`
- **No code is stored.** Rooms are in memory (HC 6); only the fact that a game came from a room is recorded
- **Additive contract change:**
  - one field on the duel history entry
  - REST only, so no `PROTOCOL_VERSION` bump
  - one migration
- **The scraper keeps its own copy of `schema.prisma`.** `game_sessions` isn't one of its tables, so nothing changes for it, but its copy goes one column behind until it next syncs
- Constraints:
  - migrations only through `prisma migrate`; never edit an applied one
  - comments single-line, at most 50 characters
  - `@/` imports
  - types from `z.infer`
  - never touch `production`
  - **never run the e2e suites while `.env` points at `ingest`**
- Verification:
  - `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`
  - `npm run test:e2e` on `dev`
  - `/docs/openapi.json`: the duel `HistoryEntry` has `isPrivate`
  - on `dev`: after the harness room game, `GET /profile/history` for each player shows `isPrivate: true`. Booleans and counts only
- Afterwards, in the web: mark R6 persistence done in `backend-requests.md` with the migration name; Private Rooms B transcribes `isPrivate`

## History
