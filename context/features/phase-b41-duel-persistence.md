# Phase B41 — Duel Persistence

## Status

Complete

## Goals

- **`src/duel/duel-room.ts`:** `PlayingRoom` gains `effects: readonly TimedEffect[]`, the duel's whole effect log, as `PlayedRun` has for solo. `DuelStartService.begin` starts it empty, and `src/duel/duel.fixtures.ts` follows.
- **`src/duel/duel-play.service.ts`:** `apply` appends each accepted step's effects to the room.
  - When the step ends the duel, the finished room goes to `DuelPersistenceService.record` before `rooms.close`, and before any event goes out.
  - A refused input appends nothing.
- **`src/users/stats-writer.ts`:** `FinishedGame` gains `duelOutcome: DuelOutcome | null`, and `recordGame` adds to `wins`, `losses` or `draws` (**Stats**). Solo passes `null`, so solo's writes are unchanged.
- **`src/duel/duel-persistence.service.ts`:** `record(room)` keeps a finished duel until it is in Postgres (**Write**, **Retry**).
  - `save` writes the duel in one transaction.
  - A minute timer retries anything still unsaved.
- **`src/duel/duel.module.ts`:** provides `DuelPersistenceService` and its `DUEL_RETRY_MS` token, so tests can shorten the retry.
- **Tests:**
  - `duel-persistence.service.spec.ts`, with a stubbed transaction client:
    - the session, both participants, rounds pointing at the seat whose turn it was, and the guesses, in that order
    - stats for both players, in user-id order
    - the room id reused as the session id, and a duplicate-key error read as "already saved"
    - a failed save stays pending, the timer retries it, and a saved duel leaves the pending list
    - the failure log holds the duel id and the Prisma code or error class, and never a guess text or a player name
    - a pending duel holds no squad
  - `duel-play.service.spec.ts`:
    - effects build up across guesses and ticks
    - a refused guess adds none
    - each way a duel ends hands it over exactly once, with its full log: lives out, all 11 named, `duel:forfeit`, and an expired reconnect window
  - `stats-writer.spec.ts`:
    - `win` and `forfeit_win` add a win, `loss` a loss, `draw` a draw
    - a duel never touches `perfectClears`
    - the solo cases still pass unchanged
  - `test/duel/duel-persistence.e2e-spec.ts` (**E2E**)

## Write

One transaction per duel. A duel is in both players' histories and counted in both profiles, or in neither.

| Table | Row |
| --- | --- |
| `game_sessions` | `id` is the room id, already the `sessionId` both clients hold. `mode` duel, `status` over, `side` the server's pick, `startedAt` from `firstRound.startedAt`, `endedAt` from the last round's `endedAt`, `soloEndReason` null |
| `game_participants` | Two rows, seats 0 and 1. `userId` comes from `room.players`, never the client. `livesRemaining` is `timed.game.lives[seat]`; `duelOutcome` is `result.outcomes[seat]` |
| `game_rounds` | One per `runRecord` row. `participantId` is the participant at that row's `seat` |
| `guesses` | One per judged guess, filed under its round, as in B34 |
| `user_stats` | `recordGame` once for each player |

- **`runRecord` is reused as it is.** Its rows already carry `seat` (a B34 deviation made for this phase), and every way a duel ends emits a `round_ended`, so the final round always has a row.
- **The CHECKs hold:**
  - `side` is set, as `game_sessions_side_check` requires
  - `soloEndReason` stays null, as `game_sessions_end_reason_check` requires
  - seats are 0 and 1, and lives run 0–3
- **The history needs no change.** `HistoryService` already lists a duel once its `duel_outcome` is written. Its `foundCount` counts every `correct_new` in the session, which is the shared pool. That matches the web mock's `result.found.length`.
- **Idempotent.** A second save collides on the session id inside its own transaction, which rolls back its stats too. `save` reads that as "already saved".
- **Lock order.** The two `user_stats` upserts run in user-id order. Without it, a retried save and a newer duel between the same two players could take the row locks in opposite orders and deadlock.

## Stats

What each player's `recordGame` call gets:

| Field | Value |
| --- | --- |
| `correctGuesses`, `totalGuesses` | That seat's own judged guesses only, never the opponent's |
| `bestStreak` | `0`. A correct name ends the turn, so a duel has no streak; this is the web mock's rule. `GREATEST` keeps the stored best |
| `isPerfectClear` | `false` |
| `duelOutcome` | That seat's outcome |

| Outcome | Adds |
| --- | --- |
| `win`, `forfeit_win` | `wins + 1` |
| `loss` (including your own forfeit) | `losses + 1` |
| `draw` | `draws + 1` |

- **`played + 1` for both players,** so `user_stats_results_check` (wins + losses + draws ≤ played) still holds.
- **The favourite club is recomputed as in B34.** Both players named the same XI, so for both it counts the club of `match_teams` at the session's `side`.

## Retry

- **`record(room)`** keeps a `FinishedDuel`: the id, both user ids, the match id, the side, `firstRound`, the effects, both lives and the result. It drops the squad. A save starts at once, and the call returns without waiting for it.
- **A failed save** stays in the pending map. The timer, every `DUEL_RETRY_MS` (60 s, as B34's sweep), retries each pending duel one after another and skips a run while the last one is still going.
- **A failed save never reaches a player.** The game is already over, so the events go out as normal.
- **Pending duels live only in memory.** A crash loses them, as it already loses solo runs in play (HC 6: in-memory state is what's safe to lose). Flushing them on shutdown is B45's job, for solo and duel alike.

## E2E

`test/duel/duel-persistence.e2e-spec.ts` follows `disconnect.e2e-spec.ts`: two guests, `CLOCK` with a skew, a fixed `RANDOM`, a short reveal and window. Each case waits for the session row with `vi.waitFor`, since the write runs after `finished`.

- **Lives out:**
  - the clock moves past three of one player's deadlines
  - both histories list the duel, `mode: duel`: `win` for one, `loss` for the other, with each one's own lives
  - both profiles show `played` 1; one has `wins` 1, the other `losses` 1
- **Draw:**
  - the two players name all 11 between them
  - both histories show `draw` with `foundCount` 11
  - each profile's accuracy counts only that player's own guesses
- **`duel:forfeit`:** `loss` for the player who forfeited, `forfeit_win` for the other
- **Window expiry:** a player drops and never returns. That player's history shows `loss`, and the other's shows `forfeit_win`.
- **Rows match the duel:**
  - one session with two participants, seats 0 and 1
  - each round's participant is the seat whose turn it was
  - guess texts are stored as typed
- **Saved once:** after the retry timer has run, the session count for the room id is still 1 and the stats haven't doubled.
- **No row before play:** a pair who leave during filters leaves no `game_sessions` row.
- **Cleanup:** the guests' `game_sessions` go first, then the guests.

## Open Questions

Settled at `/feature load`, as recommended.

1. **When is the duel written, relative to `finished`?**
   - **Recommended: `finished` goes out at once, and the write runs in the background, retried every minute until it lands.** `apply` stays synchronous on every timer path, and a slow or unavailable database never delays a result. The history can trail `finished` by one write, about 100 ms.
   - Await the write before sending `finished`. The history is always there by the time `finished` arrives, but `apply` and every timer callback become async, and if Postgres is down every duel's result waits on it.

## Decisions

- **A duel that ends before `matchReady` writes nothing:** an opponent leaving during filters or the flip. No match was played, and `game_sessions` needs a side. This is the same as solo's "no row before a side is chosen".
- **Your own forfeit is a loss,** as the engine and the web mock have it. Only the other player's outcome is `forfeit_win`.

## Out of Scope

- Socket rate limits (B42), and the two-client harness (B43)
- Flushing unsaved games on shutdown (B45)
- Redis, or moving the retry list out of memory (B46)
- Any payload or contract change: `PROTOCOL_VERSION` stays 1
- Per-club and per-era breakdowns (Pro, deferred)

## Notes

- Scope: a single spec. It covers the room's effect log, the transactional save with retry, and the outcome counts in the stats writer, proven together through `/profile` and `/profile/history`.
- Depends on:
  - B34: `runRecord`, `recordGame`, and the duplicate-key reading
  - B38b and B40: the room, `apply`, the forfeit paths
  - B14: the history and profile readers, unchanged
  - B08: the tables and CHECKs
- Constraints:
  - **CLAUDE.md:** the squad and guess texts are stored but never logged. A failure log holds the duel id and the error code or class only, so the `$transaction` call is wrapped (the B04 note).
  - **"Never trust a client-supplied user id":** both user ids come from the room, which got them from the verified handshake.
  - **HC 6:** Postgres is the record; the room and the pending list are live state.
  - **HC 7:** nothing new in `src/game/`. Persistence turns the engine's log into rows and decides no outcome.
  - **B08's cross-row rule:** every round points at a participant of its own session.
  - No `any`; `@/` imports; comments single-line, at most 50 characters
- **Existing e2e suites now leave rows.** `duel-play` and `disconnect` finish duels, so their cleanup must delete the guests' `game_sessions` before the guests, because participants restrict a user delete (B10a).
- For W31 and W32: the history and profile endpoints already serve duels with the shapes the web expects. Fetching `/profile/history` right after `finished` can miss the newest duel by one write.
- Verification:
  - `npm test`, `npm run test:e2e` on the dev branch (afterwards, the guests and their sessions are gone), `npm run build`, `npm run lint`
  - By hand: two `socket.io-client` guests play a duel to `finished`, then each reads `GET /profile/history` and `GET /profile`

**Deviations recorded during implementation**

- **`src/prisma/save-errors.ts` is new:** `isAlreadySaved` (P2002) and `failureKind` (the Prisma code, the error class, or `unknown`). They moved out of `SoloPersistenceService`, so solo and duel share one copy, and solo now imports them.
- **`recordGame` always writes `wins`, `losses` and `draws`.** Solo adds 0 to each. B34's "leaves the duel results alone" case is replaced by a "no result for solo" case and four outcome cases.
- **`finishedDuel(room)` is exported** from the persistence service. It builds the squad-free snapshot that `record` keeps.
- **`isPending(id)` and `retry()` are public.** The e2e suite waits on `isPending` and calls `retry` directly, as B34's suite calls the sweep.
- **The retry timer lives in `DuelPersistenceService`** (`OnModuleInit` and `OnModuleDestroy`), not in the module as solo's sweep does. The service owns the pending map, so it owns the timer too.
- **`test/duel/socket-client.ts` gains `removeGuests`,** which deletes the guests' sessions, then the guests, inside `vi.waitFor`. A save that lands after `finished` could otherwise slip in between the two deletes and block the user delete. `duel-play`, `disconnect` and the new suite use it.
- **`src/duel/duel-views.spec.ts`'s playing room** gained `effects`, which `tsc` caught.
- **E2E:** the window is 1 s. The "rows match" and "saved once" checks sit in the draw case. The "no row before play" case pairs two guests, and one leaves during filters.
- **Tests:**
  - **Unit:** 1089 in all (27 new; 1090 after the review), in `duel-persistence.service.spec.ts`, `duel-play.service.spec.ts` and `stats-writer.spec.ts`
  - **E2E:** 409 in all (5 new, in `test/duel/duel-persistence.e2e-spec.ts`)
- **Dev branch after the full e2e run:** 0 duel sessions. The 6 solo sessions there date from by-hand checks on Oct 16–18.
- **Review:** one change.
  - **Fixed:** a retry pass could start a second save of a duel whose first save was still running, for example one recorded just before the timer fired. The duplicate key kept the data right, but it cost a wasted transaction, and two error logs while the database is down. A `saving` set now skips a duel already being written. A new unit case covers it and fails without the guard. The "one pass at a time" case now waits for the first save's failure log, not just its start.
  - **Checked:** `record` runs before `rooms.close` and before any event. `finishedDuel` throws only for a room with no duel result, which `apply` never passes.
  - **Checked:** the two `user_stats` upserts are the only row locks two duel saves can share. The participant inserts take only shared key locks on `users`, so the user-id order is enough.
  - **Checked:** a pending duel holds the effect log, guess texts included, only in memory. It never holds the squad, and nothing from it reaches a log.
  - **Left alone:** a save that can never succeed is retried every minute and logged each time, as B34's solo saves are; an example is a user deleted between `finished` and the save. B44's observability is the place to alert on it.
  - **Left alone:** the user-id sort uses `localeCompare`. It only needs to be consistent within one process, which it is.
  - Unit tests: 1090 (28 new in B41).
- **At `/feature test`:**
  - **New:** `src/prisma/save-errors.spec.ts` (7 cases: P2002 against other codes, plain errors and non-error throws, and what `failureKind` names). Also a `duel-persistence.service.spec.ts` case: a duel with no ended round is refused, nothing is written, and the log names only the error class.
  - **Unit tests:** 1098 in all (36 new in B41)
  - **Coverage from unit tests:**
    - 100% lines and functions for `duel-persistence.service.ts`, `stats-writer.ts` and `save-errors.ts`
    - `duel-play.service.ts` and `solo-persistence.service.ts`: the uncovered branches are from earlier phases
  - **Mutation checks,** each caught by the unit suite:
    - no user-id sort
    - rounds pointed at the first participant, not their seat
    - stats counting both seats' guesses
    - outcomes swapped between seats
    - a duel streak written
    - effects not appended
    - the hand-off moved after the events
    - `forfeit_win` not counted as a win
    - the pending entry never cleared
  - **By hand,** on the built server (port 8081):
    - two guests paired, played to `matchReady`, then one miss and a forfeit
    - the forfeiter's history shows `loss` and the other's shows `forfeit_win`, both with 3 lives and `foundCount` 0
    - the profiles show `played` 1, with `losses` 1 and `wins` 1, and the favourite club set
    - the rows on the dev branch: one duel session with `side` set and no `solo_end_reason`; seats 0 and 1 with their outcomes; one round, ended `ended`, on seat 0; the guess text as typed
    - the server log never contained the guess text
    - the guests and their session were then deleted

## History
