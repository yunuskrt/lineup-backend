# Phase B34 — Solo Persistence

## Status

Complete

## Goals

- **The effect log carries what a `guesses` row needs.**
  - `src/game/engine.ts`: `guess_resolved` carries the guess `text`. The engine already holds it.
  - `src/game/timed-game.ts`: `stamp` adds `receivedAt`, the clamped receipt time. That is the same instant the guess was judged at.
  - Today the log has neither, so B30's "write rows straight from the effects" isn't yet true.
- **`src/game/run-record.ts` (pure):** `runRecord(firstRound, effects)` turns a finished run's log into rows (**Record**). B41 reuses it for duels.
- **`src/users/stats-writer.ts`:** `recordGame(tx, userId, game)` upserts `user_stats` inside the caller's transaction (**Stats**). It is exported from `UsersModule`, and B41 reuses it.
- **`src/solo/solo-persistence.service.ts`:** `save(run)` writes one finished run in a single transaction (**Write**):
  - the `game_sessions` row
  - its `game_participants` row
  - every `game_rounds` row, and every `guesses` row
  - the `user_stats` upsert
- **`src/solo/solo.service.ts`:**
  - after every call, a run that is over and unsaved is saved before the response goes out
  - `guess`, `sync`, `quit` and `summary` become `async`
  - `start` saves the open run that it ends
- **`src/solo/solo-run.ts`:** a `savedAt: number | null` field on `PlayedRun`. The store's `evictIdle` never drops an over run that is still unsaved.
- **`src/solo/solo.module.ts`:** the timer runs every minute (**Sweep**). It ticks every run in play, saves those the clock has ended, retries failed saves, then evicts idle runs.
- **Tests:**
  - `run-record.spec.ts`:
    - rounds numbered from 1, timed from `firstRound` and the `round_started` effects, and ended by `round_ended`
    - each guess filed under the round it was made in, with `playerId` null only for `not_in_xi`
    - covers found, expired and quit endings, and a perfect clear
  - `stats-writer.spec.ts`: a stubbed transaction client:
    - the first game creates the row, and later games add to it
    - `bestStreak` is a max, never a sum
    - `perfectClears` counts only perfect clears
    - solo never touches `wins`, `losses` or `draws`
    - the favourite-club query is issued with the user id only
  - `solo-persistence.service.spec.ts`: the transaction's writes in order, the run id reused as the session id, and a duplicate-key error read as "already saved"
  - Additions to `solo.service.spec.ts` and `solo.module.spec.ts`:
    - the call that ends a run saves it
    - a failed save keeps the run unsaved and still answers the player
    - the sweep saves an abandoned run and retries a failed one
  - `test/solo/solo-persistence.e2e-spec.ts` (**E2E**)

## Record

```ts
type RoundRecord = {
  number: number;
  startedAt: number;
  endsAt: number;
  endedAt: number;
  endReason: 'found' | 'expired' | 'ended';
  guesses: {
    text: string;
    outcome: GuessOutcome;
    playerId: string | null;
    receivedAt: number;
  }[];
};
```

- **Every round of a finished run has ended,** so `endedAt` and `endReason` are never null. That satisfies `game_rounds_end_check`.
- **`endedAt ≥ startedAt` always holds.** B31's clamp guarantees it, so `game_rounds_time_check` passes.
- **`already_found` keeps its `playerId`; only `not_in_xi` has none.** This matches `guesses_player_check`.
- **A refused guess (`round_over`, `session_over`) was never judged,** so it gets no row, the same as in `runFigures`.

## Write

| Table | Row |
| --- | --- |
| `game_sessions` | `id` = the run id; `mode` solo; `status` over; `side`; `startedAt` = `firstRound.startedAt`; `endedAt` = the last round's `endedAt`; `soloEndReason` |
| `game_participants` | `seat` 0; `userId` from the session, never the client; `livesRemaining` |
| `game_rounds` | one per `RoundRecord`, pointing at the single participant (B08's cross-row rule) |
| `guesses` | one per judged guess, under its round |
| `user_stats` | upserted by `recordGame` |

- **One transaction.** A run is in the history, and counted in the profile, both or neither (the B08 decision).
- **Idempotent.** The run id is the primary key. A second save, from a retry or two concurrent calls, fails on that key inside its own transaction, which also rolls back its stats. `save` reads that duplicate-key error as "already saved".
- **A failed save never fails the player's call.**
  - The summary is still served from memory, and the run stays `savedAt: null`, so the sweep retries it.
  - The failure is logged with the run id only. It never includes the squad, a guess text or Prisma's arguments, so the `$transaction` call is wrapped (the B04 note).
- **`endedAt` is when the run actually ended,** not when it was saved. An abandoned run swept a minute later still shows its true end time in the history, which sorts by `ended_at`.

## Stats

`recordGame(tx, userId, game)`, for one finished solo game:

| Column | Change |
| --- | --- |
| `played` | `+ 1` (as the web mock counts every finished game) |
| `perfectClears` | `+ 1` on `perfect_clear` |
| `bestStreak` | `max(stored, the run's best streak)`; the CHECK caps it at 11 |
| `correctGuesses`, `totalGuesses` | `+` the run's `correct_new` and judged-guess counts, the same definitions as `runFigures` |
| `wins`, `losses`, `draws` | untouched: duel only (B41) |
| `favouriteClubId` | recomputed from the user's finished games |

- **Favourite club:** the club of the side the user played most often, across solo and duel. A tie goes to the most recent game. This is the same rule as the web mock's `favouriteClubOf`.
- It is one grouped query over the user's finished participations, inside the same transaction, so it sees the game just written.

## Sweep

- **Every minute,** the module timer:
  1. ticks each run in play, using `CLOCK`
  2. saves every over run whose `savedAt` is null
  3. evicts runs idle for 30 minutes that are saved, or were never played
- **A run abandoned mid-play still reaches the history** within about a minute of its last life running out. It ends as `lives_out`, at the deadline that ended it. Closing the tab can't dodge a bad run.
- **Ticks are synchronous;** the saves are awaited one after another. A sweep that is still saving when the next one starts is skipped.

## E2E

`test/solo/solo-persistence.e2e-spec.ts` uses `AppModule` and the test `CLOCK` override, playing as a guest:

- **Perfect clear:**
  - `GET /profile/history` lists the run: `mode: solo`, `outcome: perfect_clear`, `foundCount` 11, 3 lives
  - `GET /profile` shows `played` 1, `perfectClears` 1, `bestStreak` 11, accuracy 1, and the favourite club set
- **Rows match the run:**
  - the session, participant, rounds and guesses read back through Prisma, with the guess text as typed
  - 11 rounds, each ended `found`
  - every guess has its `playerId`
- **Quit after a miss and an expiry:** the history shows `quit`. Profile accuracy is 0, `played` is 2, and `bestStreak` stays 11.
- **Abandoned run:** the clock moves past three deadlines, then the sweep runs (called directly). The history gains a `lives_out` entry, whose `playedAt` is the third deadline.
- **Starting a new run** saves the open one as `quit`.
- **Saved once:** a second `quit` or `summary` call writes no second session row, and the stats don't double.
- **No row before a side is chosen:** an untaken offer leaves no `game_sessions` row.
- **Cleanup:** `game_sessions` for the test guests go first, then the guests themselves. Participants restrict a user delete (B10a).

## Decisions

Settled at `/feature load`:

- **Rows are written once, when the run ends.** One transaction writes the session, the participant, every round and guess, and the stats upsert, as B08 decided. No database round trip happens inside a 15 s round, and runs that never finish leave nothing to clean up. A crash loses runs in progress, which it already does at MVP. Rejected: writing as the run goes, which costs a database write per guess and needs a cleanup job.
- **An abandoned run is saved by the sweep.** Once the clock ends it, it is saved within about a minute as `lives_out`, at the deadline that ended it. Closing the tab can't erase a bad run from the stats. Rejected: saving only when a later call happens to see the end.
- **A guest's history is not merged into a different, existing account, and the merge is deferred.** Upgrading in place already keeps a guest's history (overview § F). A merge needs a Better Auth hook, moved participant rows and recomputed stats; it is rare and can be a phase of its own. Rejected: merging in B34, which pulls auth-flow changes into a persistence phase.

## Out of Scope

- Duel persistence: B41 reuses `runRecord` and `recordGame`
- Rate limits: B35, including the per-run guess cap from the B33a review
- Serving a summary or history entry for a run after it is evicted from memory: the history endpoint already lists it
- Per-club and per-era breakdowns, and most-missed players (Pro, deferred)
- Guest-to-existing-account merge (**Decisions**): deferred to a phase of its own
- Indexes for the history query: B26

## Notes

- Scope: a single spec. It covers the effect-log additions, the pure record transform, the stats writer, the transactional save, and the sweep, verified together through `/profile` and `/profile/history`.
- Depends on: B33 (the run, the store, the service, the module timer); B08 (tables and CHECKs); B14 (the profile and history readers, unchanged); B10a (user FKs, which restrict deletes).
- Constraints:
  - **CLAUDE.md:**
    - the squad is never logged
    - **the guess text is stored but never logged**
    - the effect log, which now holds guess texts, is never logged or serialised to a client
  - **"Never trust a client-supplied user id":** `userId` comes from the run, which got it from the session.
  - **B08's cross-row rules, enforced here:**
    - a solo session has exactly one participant
    - every round points at that participant
    - `duel_outcome` stays null
  - **HC 6:** Postgres is the record. The in-memory run is live state only.
  - **HC 7:** `run-record.ts` is pure and lives in `src/game/`. Persistence calls it and decides nothing.
- Verification: `npm test`, `npm run test:e2e` (dev branch; the guests and their sessions are deleted afterwards), `npm run build`, `npm run lint`. By hand: play a run, then read `GET /profile/history` and `GET /profile`.

**Deviations recorded during implementation**

- **`runRecord` rows carry `seat`,** on each round and each guess, so B41 can point rounds at the right participant. `outcome` is typed as `GuessVerdict['kind']`, because `src/game` can't import Prisma's enums; the values are identical.
- **`recordGame` is a plain function in `src/users/stats-writer.ts`,** imported directly rather than provided by `UsersModule`. It only needs the caller's transaction.
- **`recordGame` runs two raw SQL statements:**
  - one atomic upsert: increments, plus `GREATEST` for the best streak, which Prisma's `upsert` can't express
  - one `UPDATE` that sets the favourite club from a grouped query
- **The save uses `createManyAndReturn` for rounds,** to map round numbers to the ids that the guess rows need.
- **Store additions:**
  - `played()` lists runs with a side
  - `markSaved(id, at)` updates the latest copy of a run
  - `isUnsaved` lives in `solo-run.ts`
- **The sweep re-reads each run from the store before ticking it.** A request may have moved the run on while an earlier save was awaited. A sweep tick doesn't count as the player touching the run.
- **`SoloModule` now depends on `SoloService`** and exports `SWEEP_EVERY_MS`. A failed sweep is logged with the error class only.
- **A failed save logs the run id plus the Prisma code or error class.** The database test captured all output during a forced CHECK failure: Prisma printed nothing of its own, only `Run <id> was not saved (P2039)` appeared, and the guess text was absent.
- **The spec's E2E line "profile accuracy is 0" was wrong.** Accuracy is lifetime: 11 correct of 12 judged guesses gives 11/12, and the test asserts that.
- **The existing `test/solo/solo.e2e-spec.ts` cleanup now deletes the guests' sessions first,** because participants restrict a user delete.
- Added in testing:
  - a regression test for the sweep race: a guess made while the sweep waits on another run's save survives; it fails if the sweep uses its stale list
  - failure-log tests for a Prisma code and a non-Error throw
  - store tests for `markSaved`, `played()`, and an unsaved run surviving eviction
- After the full suite, the dev branch held 0 rows in the session, round, guess and stats tables. The by-hand run left one guest with one saved quit run.

## History
