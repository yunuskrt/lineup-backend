# Phase B43 — Duel Integration Harness

## Status

Complete

## Goals

- **`test/duel/duel-harness.ts`:** `DuelHarness`, the one way a duel test boots the app and drives two clients (**Harness**).
  - `bootDuelApp(overrides)`: `AppModule` with the socket adapter, on a random port, plus the clock skew and the provider overrides a suite needs
  - `pair()`: two fresh guests, queued, paired and through filters to `matchReady`, each with a full event log
  - `squadOf(duel)`: the named XI's names and player ids, read from Postgres, never from a payload
  - `close()`: closes every socket, waits for the server to see it, then runs `removeGuests`
- **`test/duel/duel-harness.e2e-spec.ts`:** four complete duels, each played from `paired` to `finished` by two clients (**Games**):
  - a win and a loss, seen from the two sides of one duel lost on lives
  - a draw, with all 11 named between them
  - a forfeit by `duel:forfeit`
  - a forfeit by a dropped connection that never returns
  - each game is checked against the rules in **Checks**
- **`test/duel/socket-client.ts`:** `connectGuest` also returns the guest's gateway token, so the gateway suite can use it.
- **Existing suites move onto the harness,** with their cases unchanged (Open Questions 1):
  - `duel-play`, `disconnect`, `duel-persistence` and `socket-rate-limit` drop their own boot code and `duel()`
  - `gateway` drops its own `guest`, `tokenFor` and `player` for `connectGuest` and `gatewayToken`
- **`package.json`:** `npm run test:harness` runs `test/duel/` only (Open Questions 2). `npm run test:e2e` still runs everything.

## Harness

```ts
type HarnessOptions = {
  overrides?: [token: unknown, value: unknown][];
  env?: Partial<Env>;
};

type Client = GuestPlayer & { events: Recorded[] };
type Paired = { a: Client; b: Client; sessionId: string; match: MatchInPlay };
```

- **Seats are fixed by the queue:** `a` enters first, so it holds seat 0. The default `RANDOM` is a fixed 0.1, so `a` wins the flip and `b` names first. A suite can override both.
- **The clock is `Date.now() + skew`.** `harness.skew(ms)` moves it, so a game can run past five 15 s deadlines in milliseconds. Timers still run on real time, so the next command or tick applies the catch-up, as B31 designed.
- **Every event is recorded and schema-checked.** `afterEach` fails a test if any event either client received doesn't parse with its `duelEventSchemas` entry. Today four suites each carry a copy of this loop.
- **A short reveal (100 ms) and a short window (1 s) by default.** These are the values the current suites already override.

## Games

The event lists each client must receive, from `matchReady` on. `b` names first.

| Game | How it is played | `a` ends with | `b` ends with |
| --- | --- | --- | --- |
| Lives out | `b` names one starter, `a` misses once, then the clock runs past five more deadlines | `finished` `win` | `finished` `loss`, 0 lives |
| Draw | they alternate the 11 names, `b` first; `b` misses once on the way | `finished` `draw`, 11 found | `finished` `draw`, 11 found |
| Forfeit | `a` sends `duel:forfeit` on `b`'s turn | `finished` `loss`, `isForfeit` | `finished` `forfeit_win`, `isForfeit` |
| Dropped | `b` closes its socket and never returns | `opponentConnection` `reconnecting`, then `forfeited`, then `finished` `forfeit_win` | nothing after the drop |

## Checks

Each game's two event logs are held to the contract (`api-contract.md` § 5, "Duel behaviour"):

- **Order:**
  - a correct new name gives the guesser `guessResolved`, `playerRevealed`, `turnChanged`, `roundStarted`, and the other client the same list without `guessResolved`
  - a miss gives the guesser `guessResolved` only, and the other client nothing
  - an expiry gives both `lifeLost`, `turnChanged`, `roundStarted`
  - `finished` replaces the last two when the duel ends
  - nothing follows `finished`
- **Mirror:** every `matchReady`, `turnChanged`, `roundStarted` and `finished` reaches the two clients as one moment from two views:
  - the same `sessionId`, `round` and match
  - `you` and `opponent` swapped, and `turn` swapped
  - `found` the same list, with `foundBy` swapped
  - outcomes paired: `win` with `loss`, `forfeit_win` with `loss`, `draw` with `draw`
- **The squad never leaks (HC 2):** no payload either client receives holds an unrevealed starter's id or name. The check runs on the JSON of every event, before and after each reveal, against `squadOf`.
- **The clock is the server's:** every `roundStarted` has `endsAt - startedAt` = 15 000, and no round starts before the one it follows.
- **History:** once the save lands, both players' `/profile/history` lists the duel with their own outcome (B41).

## Open Questions

Both settled at `/feature load`, as recommended.

1. **Do the existing duel suites move onto the harness?**
   - **Recommended: yes, the four that copy `duel()` and the boot code, plus the gateway suite onto the shared guest helpers.** Their cases stay as they are. About 250 lines of copied setup become one module, and every suite gets the schema check from one place.
   - Only the new suite uses the harness. The copies stay, and each new duel suite keeps adding another.
2. **Does the harness get its own command?**
   - **Recommended: `npm run test:harness`,** running `test/duel/` only. `coding-standards-backend.md` says the harness runs as a separate command, and it's the quick check before a duel change. `test:e2e` still runs it.
   - No new script. `npx vitest run -c vitest.config.e2e.ts test/duel` does the same, unnamed.

## Out of Scope

- New server behaviour. This phase adds tests and test helpers only, so `src/` doesn't change.
- Playwright and browser flows (W34)
- Load or soak testing with many pairs
- A third client watching (spectating is postponed)

## Notes

- Scope: a single spec. It covers the harness module, the four-game suite, the moves of the existing suites, and the new script. All of it is proven by `npm run test:e2e`.
- Depends on:
  - B36–B42: the gateway, matchmaking, start, play, disconnect, persistence and rate limits that the games run through
  - B41: `removeGuests`, and the history the games read back
- Constraints:
  - **HC 2:** the leak check reads the squad from Postgres. The harness never asks the server for it.
  - **HC 1:** the clients only send commands and read events. Nothing in the harness decides a result.
  - **Testing standard:** E2E runs against the dev Neon branch only, and leaves no rows behind.
  - No `any`; `@/` and `@test/` imports; comments single-line, at most 50 characters
- **For W31:** the **Games** and **Checks** tables are the event order the web's socket client should expect, and the harness is the reference when the two disagree.
- Verification:
  - `npm run test:harness` and `npm run test:e2e` (the case count only grows), `npm test`, `npm run build`, `npm run lint`
  - Afterwards, the dev branch holds no duel sessions and no test guests

**Deviations recorded during implementation**

- **The lives-out script changed.** In the spec's script (`b` names, `a` misses, then five deadlines), the expiries start on `a`'s turn, so `a` would have lost. Now `b` names, then `a` misses and names one, so the expiries go `b`, `a`, `b`, `a`, `b` and `b` runs out, as the Games table's outcomes say.
- **`DuelHarness.boot(options)`, not `bootDuelApp(overrides)`.** The options are named: `random`, `revealMs`, `windowMs`, `filterWindowMs` and `env`. These are the only knobs any suite needed, so no suite passes a raw override list. The methods are:
  - `client`, `reconnect`, `drop` and `ack`
  - `pair` and `squadOf`
  - `settle`, for `afterEach`, and `close`
  - `skew`, `resetClock` and `now`
- **`squadOf(match)` takes the match** and returns `names`, `ids` and `others`, the other side's starters. `duel-play`'s leak case needs `others`.
- **`socket-client.ts`:**
  - `connectGuest` returns the guest's `token`
  - a new `guestSession(server)` gives a guest with no socket, for the gateway suite's handshake-refusal cases
  - cookie parsing now lives in one place
- **Each moved suite keeps its own timings:**
  - `duel-play`: a 20 s window and a 5 s filter window
  - `disconnect`: a 2 s window
  - `duel-persistence`: a 1 s window
  - `socket-rate-limit`: the harness defaults, with limits switched on through `env`. Its clock is now the harness's at skew 0, which is the system clock.
- **`duel-persistence` and `socket-rate-limit` now get the per-event schema check.** Before the move, neither had one.
- **`socket-rate-limit`'s reconnect goes through `h.reconnect`,** so `settle` closes that socket too.
- **Not moved:**
  - `matchmaking` and `duel-start` carry no `duel()` copy
  - `gateway` keeps its own `deleteMany` cleanup, since none of its duels finish
- **Size:** the five moved suites lost 511 lines and gained 161. The harness module and the four-game suite are new.
- **One flake, outside this phase:**
  - In the first full e2e run, 10 cases in `test/auth/auth.e2e-spec.ts` each timed out at 20 s.
  - That suite passes on its own (96 of 96), and two more full runs passed with 416 of 416.
  - Nothing in `test/auth/` or `src/` changed in this phase.
- **Tests:**
  - **Unit:** 1118 (unchanged)
  - **E2E:** 416 in all (4 new)
  - **`npm run test:harness`:** 74 cases in 8 files
- **Dev branch afterwards:** 0 duel sessions, no guests from the last hour.
- **Review:** four fixes, all in test code.
  - **Fixed:** `game()` now asserts the squad has 11 starters. Before, a wrong or empty `squadOf` would have let the leak check pass vacuously in the forfeit and drop games, which never guess a name.
  - **Fixed:** `playOf` returns nothing when a client never saw `matchReady`. Before, `findIndex`'s -1 made `slice(-1)` quietly return the last event.
  - **Fixed:** `duel-play` passes `RECONNECT_WINDOW_MS` instead of a copied `20_000`.
  - **Fixed:** `close()` also closes any socket a failed case left open, before deleting the guests. Before, it relied on `settle` having run.
  - **Deviation noted:** the spec's `close()` was to close sockets, wait, then delete. The work is now split: `settle` (in `afterEach`) closes, checks and waits, and `close` (in `afterAll`) closes any socket still open, deletes the guests and stops the app.
  - **Checked:** the mirror check leaves out `finished`, which `expectMirroredResults` covers, with outcomes paired by `isForfeit`.
  - **Checked:** the exact event lists also prove "nothing after `finished`", because each comparison runs after a 300 ms quiet period.
  - **Checked:** `pair()` makes the two guests concurrently but queues them one after the other, so `a` always holds seat 0.
  - **Checked:** a reconnected client has the same guest id, so `guestIds` stays a set and the cleanup deletes each guest once.
  - **Checked:** no `src/` file changed (`git diff --stat src` is empty).
- **At `/feature test`:** no unit tests were added. No service or `src/game/` code changed; the phase is test code, so the test of it is whether the harness catches a broken server.
  - **Server mutations,** each run against the four-game suite and then restored. Each was caught:
    - an unrevealed starter's name put in `match.nickname`: all 4 games failed. `expectNoLeak` caught it at `matchReady`, even in the forfeit game, which never guesses a name.
    - `turn` built from seat 0's view for both clients: 4 of 4 failed
    - `foundBy` from seat 0's view: 2 of 4 failed, the two games with found players
    - one outcome for both seats: 2 of 4 failed, since a draw and the drop game's single-client result can't show it
    - every round 1 ms longer: 4 of 4 failed
    - `roundStarted` sent before `turnChanged`: 2 of 4 failed, the two games with handovers
    - the duel never saved: 4 of 4 failed, at the history check
  - **Stability:** `npm run test:harness` passed three more times in a row, 74 of 74 each time
  - **Dev branch afterwards:** 0 duel sessions, no guests from the last two hours
  - **Unit tests:** 1118, unchanged

## History
