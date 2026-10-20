# Phase B38b — Duel Round Loop

## Status

Not Started

## Goals

- **`src/duel/duel-views.ts`** (from B38a) gains:
  - `toDuelResult(room, seat)`
  - `toFoundPlayer(room, playerId, seat)`, a `DuelFoundPlayer` with `foundBy` relative to the receiver
  - `toLifeLost(effect, seat)`
- **`src/duel/duel-events.ts`:** `eventsFor(room, effects)`, pure. It turns one step's B31 `TimedEffect`s into the ordered list of `{ seat, event, payload }` each player receives (**Events**). It's the only place a seat becomes an event.
- **`src/duel/duel-play.service.ts`:** `DuelPlayService`, the loop over a `playing` room (**Loop**).
  - `guess(user, request)`, `forfeit(user)` and `drop(userId)`
  - one round timer per room, scheduled at `nextDeadline`
  - it applies every input through `applyTimed` and emits through `DuelNotifier`
  - a finished duel closes its room
- **`src/duel/duel.gateway.ts`:** `duel:guess` and `duel:forfeit` become real handlers. `refuseUntilOpen` and `DUELS_NOT_OPEN` go, since all five commands are real.
- **`src/duel/matchmaking.service.ts`:** `drop` sends a `playing` room to `DuelPlayService.drop` (**Drops**).
- **Tests:**
  - `src/duel/duel-events.spec.ts` (pure): the order for each **Events** row, both receivers' views of one step, the guesser-only `guessResolved`, and a catch-up over several expiries
  - `src/duel/duel-views.spec.ts`: `toDuelResult` for win, loss, draw and forfeit from both seats
  - `src/duel/duel-play.service.spec.ts` (fake timers, a fixed `CLOCK`, a recording notifier, a seeded `playing` room):
    - every refusal
    - expiry by the timer alone
    - a late guess
    - a draw on 11
    - lives out
    - forfeit
    - a drop
    - the timer cleared on finish and on destroy
  - `test/duel/duel-play.e2e-spec.ts` (**E2E**)

## Loop

- **The server owns the clock** (HC 1, HC 11). A timer per room fires at `nextDeadline(timed) + 1` and applies `{ kind: 'tick' }`. Every input also catches up first (B31), so a guess that lands after a missed tick still sees the right round.
- **After every step,** the room is saved, the events are emitted, and the timer is rescheduled at the new `nextDeadline`. It's cleared once the duel is over.
- **The guess text** goes only into `applyTimed`. It is never logged, emitted to the opponent or put in an error (B36's note for B39).
- **A finished duel** closes its room, so both players are idle and can queue again. B41 saves it before the room closes.
- **Ack order:** a command's events are emitted before its ack, as in B37.

## Events

From the moment's effects, in this order. `you` and `opponent` are from each receiver's seat.

| Moment | Guesser | Both players |
| --- | --- | --- |
| correct, new name | `guessResolved` (`correct_new`) | `playerRevealed`, `turnChanged`, `roundStarted` |
| the 11th name | `guessResolved` | `playerRevealed`, `finished` (`draw` for both) |
| already found | `guessResolved` (`already_found`) | nothing: the turn and clock carry on |
| not in the XI | `guessResolved` (`not_in_xi`) | nothing |
| expiry, lives left | | `lifeLost`, `turnChanged`, `roundStarted` |
| expiry, last life | | `lifeLost`, `finished` (`loss` / `win`) |
| forfeit, or a drop (**Drops**) | | `finished` (`loss` / `forfeit_win`, `isForfeit: true`) |

- **`turnChanged` and `roundStarted`** both carry the `DuelSession` after the handover: the new `turn`, the new `round`, and the updated `found` and lives. That matches the mock and `api-contract.md` §5.
- **A catch-up over several expiries** emits each expiry's rows in order before the input's own rows.
- **`finished`** is the receiver's `DuelResult`:
  - `outcome` is from their view
  - `found` is the shared pool
  - `isForfeit` is set from the engine's result
  - `match` is the `MatchIdentity`
  - `you` and `opponent` carry the final lives

## Commands

| Command | When | Ack |
| --- | --- | --- |
| `duel:guess` | your turn, round running | success, after the events |
| `duel:guess` | not your turn | `forbidden`, "Wait for your turn." |
| `duel:guess` | round over by the time it lands (B31 `round_over`) | `session_over`, "That round had already ended." The catch-up's events are still emitted. |
| `duel:guess` | `sessionId` isn't your room's id | `invalid_input`, "That guess is for another duel." |
| `duel:guess` | no `playing` room, or the duel is over | `session_over`, "This duel is not running." |
| `duel:guess` | a bad payload | `invalid_input`, naming the fields |
| `duel:forfeit` | `playing` | success, after `finished` |
| `duel:forfeit` | anything else | `forbidden`, "There is no duel to forfeit." |

The wording follows the mock's, which the web already shows.

## Drops

- **Until B40, a drop while `playing` is an immediate forfeit by the player who dropped.** The other player gets `finished` with `forfeit_win`. B40 puts the 20 s reconnect window in front of it.
- A replaced connection counts as a drop (B37), so a second tab mid-duel forfeits the first. B40 turns this into a reconnect.
- **A drop before `playing`** keeps B38a's behaviour.

## E2E

`test/duel/duel-play.e2e-spec.ts` reaches `matchReady` the way B38a's suite does, with `RANDOM` fixed so the first seat is known. The suite reads the seeded squad's names straight from Postgres (the test's own query, never through an API) so it can guess correctly. Round length can't be overridden (HC 11), so expiry cases use fake time on the server's `CLOCK`, or one real 15.4 s wait.

- **A correct name:**
  - the guesser gets `guessResolved` `correct_new`
  - both get `playerRevealed`, then `turnChanged` and `roundStarted` with the turn handed over
  - the opponent's `playerRevealed.foundBy` is `opponent`
- **A wrong name and an already-found name:** `guessResolved` to the guesser only, and the opponent gets nothing
- **Out of turn:** `forbidden`, and nobody gets an event
- **Expiry:** the player on turn loses a life, the turn passes, and `lifeLost.who` is `you` for one player and `opponent` for the other
- **A draw:** all 11 named across turns ends in `finished` `draw` for both, with 11 in `found`
- **Lives out:** three expiries against one player give them `loss` and the other `win`
- **Forfeit:** the forfeiter gets `loss` and the other `forfeit_win`, both with `isForfeit: true`
- **A drop mid-duel:** the other player gets `forfeit_win`
- **After the end:** both can `queue:enter` again
- **No squad leaks:** no event carries a player before they're revealed, and no payload holds the guess text, except the guesser's own `guessResolved`, which holds none
- **The contract:** every event and ack parses

## Open Questions

1. **How do the e2e tests reach an expiry?** The 15 s round can't be shortened (HC 11).
   - **Recommended: override `CLOCK` in the suite with a controllable clock, and step it past the deadline before sending the next input.** The catch-up applies the expiry exactly as the timer would. One case still waits out a real round, to prove the timer fires by itself.
   - Real waits only: three expiries take over 45 s per case.
   - A test-only round length: it breaks HC 11 in the one place meant to prove it.

## Out of Scope

- The reconnect window, `opponentConnection` and `disconnected` (B40)
- Saving the duel and the players' stats (B41)
- Socket rate limits on `duel:guess` (B42)
- The runtime schema check on every emit and the final event names (B39)
- The two-client harness for win, loss, draw and forfeit at scale (B43)

## Notes

- Scope: the second B38 spec, from round 1 to `finished`. Together with B38a, two browsers can duel to the end, with no persistence.
- Depends on: B38a (the `playing` room, the views, `DuelNotifier`), B30 (the engine), B31 (`applyTimed`, `nextDeadline`)
- Constraints:
  - **HC 1, 9–11, 18:**
    - the server decides every outcome
    - a life is lost only to the clock
    - a correct new name ends the turn; an already-found one or a name not in the XI leaves the turn and clock alone
    - rounds are exactly 15 s plus the 400 ms grace
    - all 11 named is a draw
  - **HC 2 and CLAUDE.md:** players reach a payload only through `revealOf`, once found. The squad and the guess text are never logged.
  - **HC 7:** every outcome comes from `src/game/`. `src/duel/` maps effects to events and holds no rule of its own.
  - **"Never trust a client-supplied ... elapsed time":** timing comes from `CLOCK` on receipt, never from the client.
  - No `any`; `@/` imports; comments single-line, at most 50 characters
- For B40: `DuelPlayService.drop` is the one place the reconnect window goes in.
- For B41: save the finished room before it closes. `effects` give the rounds and guesses, as solo's do (B34).
- For W31 (web): the event order table and the refusal messages.
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`
  - By hand: two `socket.io-client` scripts play one duel to a draw, and another to a forfeit. Check that the log holds no guess text or squad player.

## History
