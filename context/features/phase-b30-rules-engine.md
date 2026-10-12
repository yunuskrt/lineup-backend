# Phase B30 — Rules Engine

## Status

Complete

## Goals

- `src/game/engine.ts` — the game state and its types: `GameState`, `Seat` (`0 | 1`), `GameInput`, `GameEffect`, `GameResult`, `Step`, `Rejection`
- `createGame({ mode, squad, firstSeat })` — 3 lives for each seat, an empty found-pool, round 1 on `firstSeat`. Solo has seat 0 only.
- `applyInput(state, input)` returns a `Step`: either `{ state, effects }` or `{ rejected }`. It never mutates the state it was given.
- Guesses go through B29's `classifyGuess` against the squad held in the state, so the found-pool and the verdict can never disagree
- The transitions in **States** below, each with its effects in contract order
- `GameResult`:
  - solo: `endReason` (`lives_out` / `quit` / `perfect_clear`) and `livesRemaining`
  - duel: a `DuelOutcome` for each seat and `isForfeit`
- `src/game/engine.spec.ts` — every row of **States** for solo and duel, plus:
  - a full solo perfect clear and a full solo lives-out
  - a duel draw on the 11th name
  - a duel won on lives
  - a forfeit
  - every rejection
  - the input state left unchanged after each call

## States

The engine has no clock. `expire` is an input; B31 adds the server clock that sends it.

| Input              | When                         | Effects (in order)                                                                    | Next                                    |
| ------------------ | ---------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------- |
| `guess` seat, text | `correct_new`, < 11 found    | `guess_resolved`, `player_revealed`, `round_ended` found, `round_started` (next seat) | duel: turn passes · solo: same seat     |
| `guess` seat, text | `correct_new`, 11th found    | `guess_resolved`, `player_revealed`, `round_ended` found, `game_over`                 | over: solo `perfect_clear`, duel `draw` |
| `guess` seat, text | `already_found`, `not_in_xi` | `guess_resolved`                                                                      | unchanged (same round, no life lost)    |
| `expire`           | lives > 1                    | `life_lost`, `round_ended` expired, `round_started` (next seat)                       | duel: turn passes · solo: same seat     |
| `expire`           | last life                    | `life_lost`, `round_ended` expired, `game_over`                                       | over: solo `lives_out`, duel the other seat `win`, this seat `loss` |
| `quit` (solo)      | active                       | `round_ended` ended, `game_over`                                                      | over: `quit`, lives kept                |
| `forfeit` seat (duel) | active                    | `round_ended` ended, `game_over`                                                      | over: the leaver `loss`, the other `forfeit_win`, `isForfeit` |

**Rejections** (the state is unchanged and there are no effects):

| Rejection           | When                                                    | Maps to (B33, B38) |
| ------------------- | ------------------------------------------------------- | ------------------ |
| `session_over`      | any input once the game is over                         | `session_over`     |
| `not_your_turn`     | a duel `guess` from the seat that does not hold the turn | `forbidden`       |
| `wrong_mode`        | `quit` in a duel, `forfeit` in solo                     | `forbidden`        |
| `unknown_seat`      | seat 1 in solo, or a seat outside `0 \| 1`              | `forbidden`        |

## Decisions

- **Seats, not `you` / `opponent`.** The server keeps absolute seats, matching `game_participants.seat`. Turning a seat into `you` / `opponent` for each receiver is B39's view mapping.
- **Who moves first is an input.** `createGame` takes `firstSeat`, and B38 decides the duel policy for it. Solo always starts on seat 0.
- **Effects mirror the persisted enums:**
  - `round_ended` carries `found`, `expired` or `ended`, the same values as `RoundEndReason`
  - a verdict carries `correct_new`, `already_found` or `not_in_xi`, the same values as `GuessOutcome`
  - this lets B34 and B41 write rows straight from the effects

Settled at `/feature load`:

- **The engine holds the squad.** The state keeps the `SquadEntry[]` and calls `classifyGuess` itself, so the found-pool cannot drift from the verdict. The state lives on the server only and is never serialized to a client. Rejected: callers classifying the guess and passing the verdict in.
- **One engine for both modes.** It branches on `mode` only where the rules differ: handover, the end result, and quit vs forfeit. Rejected: two machines that would duplicate the guess and expiry paths.

## Out of Scope

- The clock: `startedAt` / `endsAt`, the 15 s round, the 400 ms grace window, and turning a late guess into an expiry (B31)
- Building `RevealedPlayer` / `MatchInPlay` views and the per-receiver `you` / `opponent` mapping (B33, B39)
- Summary figures (accuracy, best streak, round times): pure helpers in `src/game/`, specced with B33
- Who moves first in a duel (B38); the reconnect window before a forfeit (B40); rate limits (B35, B42)
- Persistence of sessions, rounds and guesses (B34, B41)

## Notes

- Scope: a single spec covering one pure module and its tests.
- Depends on: B29 `classifyGuess` and `GuessVerdict`; `MAX_LIVES` and `SQUAD_SIZE` from `src/contract/constants.ts` (plain constants, so `src/game/` stays pure).
- Constraints:
  - HC 1 and HC 7: this is the only rules implementation, and it is pure: no NestJS, no Prisma, no I/O, no `Date.now()`.
  - HC 9: exactly 3 lives, and a life is lost only on `expire`.
  - HC 10: `correct_new` ends the turn; `already_found` and `not_in_xi` change nothing.
  - HC 17 and HC 18: the answer set is the 11 starters, and naming all 11 is a draw (a perfect clear in solo).
  - HC 2: no effect or rejection carries the squad or an alias; `player_revealed` carries only the id of the player just found.
- Verification: `npm test` (unit only; no database, no HTTP), `npm run build` and `npm run lint`.

**Deviations recorded during implementation**

- `createGame` takes `NewGame`, a union in which only a duel carries `firstSeat`, so solo cannot be started on seat 1.
- `createGame` throws if the squad is not 11 starters. Added because a short squad could never end in a clear; the pool gate (B21) makes it unreachable. The message names no player.

## History
