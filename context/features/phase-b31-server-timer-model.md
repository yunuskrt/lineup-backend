# Phase B31 — Server Timer Model

## Status

Complete

## Goals

- `src/game/clock.ts`:
  - `startRound(now)` returns a `RoundTiming` (`startedAt: now`, `endsAt: now + ROUND_MS`)
  - `deadline(round)` returns `endsAt + GRACE_MS`, the instant the round expires
  - `hasExpired(round, now)` returns `now > deadline(round)`
- `src/game/timed-game.ts`:
  - `TimedGame` is the B30 `GameState` plus the running round's `RoundTiming`, or `null` once the game is over
  - `createTimedGame(newGame, now)` starts round 1 at `now`
- `applyTimed(timed, input, now)` takes a `TimedInput`: `guess`, `quit`, `forfeit` or `tick`. Callers can no longer send `expire`; only the clock does.
  1. **Catch-up:** while the running round has expired, apply the engine's `expire`. The next round starts at that round's deadline (**Rules**).
  2. Then apply the input to the caught-up game, unless **Rules** refuses it.
  3. Return a `TimedStep`: `{ timed, effects, rejected }`. It carries both, because catch-up effects can come with a refused input.
- **Timed effects:**
  - each `round_started` gains `startedAt` / `endsAt`; each `round_ended` gains `endedAt`
  - every other engine effect passes through unchanged
  - B34 and B41 can write `game_rounds` rows straight from these
- `nextDeadline(timed)` returns the instant the gateway (B38) should send a `tick`, or `null` once the game is over
- `src/game/clock.spec.ts` and `src/game/timed-game.spec.ts` cover every row of **Rules**, plus: a guess inside the grace window, a guess just past it, a solo run lost by being away, a duel tick that hands the turn over, and quit and forfeit after an expiry is due

## Rules

`now` is the server's receipt time, passed in by the caller. The engine stays pure (no `Date.now()`).

| Situation                                              | Result                                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Input at or before the deadline (`endsAt + 400`)       | Applied normally                                                                                     |
| `correct_new` at `now`                                 | Round ends with `endedAt: now`; the next round starts at `now`                                       |
| A round passes its deadline                            | `expire`: round ends with `endedAt: deadline`; the next round starts at `deadline`, so the clock never pauses |
| `tick` with nothing due                                | No effects, no change                                                                                |
| `tick` with rounds due                                 | Every due expiry, in order, and possibly `game_over`; the clock keeps running while away             |
| `guess` arriving after catch-up expired a round        | Catch-up effects are applied; the guess is **not**, and the step returns `round_over` (→ `session_over`) |
| `quit` / `forfeit` after a due expiry                  | Catch-up first; if that ended the game, the input is rejected with `session_over`                    |
| `quit` / `forfeit` / `guess` in time                   | `round_ended` carries `endedAt: now`                                                                 |

## Decisions

Settled at `/feature load`:

- **Catch-up.** The clock keeps running while a player is away: each round expires at its deadline and the next one starts there, so a long absence can cost several lives and end a solo run. This is the same clock as a duel, and nobody gains free thinking time by not syncing. Rejected: at most one expiry per request, with the next round starting at `now`.
- **A late guess is refused.** If catch-up expired any round during this call, the guess is not applied and the step returns `round_over`, which maps to the contract's `session_over`. This matches `api-contract.md` and the web mock. In a duel the gateway's tick has already caught the game up, so a guess for the new round is unaffected. Rejected: applying the guess to the round that has just started.

Fixed in the spec:

- **The expiry instant is the deadline (`endsAt + GRACE_MS`), not `endsAt`.** The expired round's `endedAt` and the next round's `startedAt` are both the deadline, so rounds chain with no gap and no overlap. An expired round therefore lasts 15 400 ms on the record; the summary (B33) can clamp round times to `ROUND_MS`.
- **The grace window is the same for everyone.** It is measured on server receipt, and no client can claim a time (HC 11, and "never trust a client-supplied elapsed time").
- **`tick` is the only way time moves.** For solo, B33 sends `tick` on `syncSession`, and every other call catches up as a side effect. For a duel, B38 schedules a `tick` at `nextDeadline`.
- **Callers cannot send `expire`.** That removes any path for a client request to take a life on purpose.

## Out of Scope

- Real timers (`setTimeout`), the gateway's scheduling and cancelling them (B38); the reconnect window (B40)
- Rate limits (B35, B42); persisting rounds (B34, B41); the `RoundTiming` in responses (B33, B39)
- Summary round times and clamping (B33)

## Notes

- Scope: a single spec covering two pure modules over the B30 engine.
- Depends on: B30 `createGame`, `applyInput`, `GameEffect` and `Rejection`; `ROUND_MS` and `GRACE_MS` from `src/contract/constants.ts`; the `RoundTiming` type from `src/contract/round.ts` (type-only import).
- Constraints:
  - HC 11: rounds are exactly 15 s, server-timed, with one fixed 400 ms grace window.
  - HC 1 and HC 7: pure, in `src/game/`; no clock is read inside.
  - HC 9: a life is lost only on expiry, and only the clock causes one.
  - HC 2: timing effects carry times and seats, never a player name or an alias.
- Verification: `npm test` (unit only; no database, no HTTP), `npm run build` and `npm run lint`.

**Deviations recorded during implementation**

- "Callers cannot send `expire`" is enforced by `TimedInput`'s type, and a compile-time `expectTypeOf` test checks it (it fails under `tsc` if `expire` is ever admitted); there is no runtime guard. Callers are our own typed services, and every client payload is Zod-parsed before it reaches them.
- Added in review: `applyTimed` clamps the receipt time to the running round's `startedAt`. A wall clock stepping back (NTP) would otherwise stamp `endedAt` before `startedAt` and break `game_rounds_time_check` when B34 saves it.

## History
