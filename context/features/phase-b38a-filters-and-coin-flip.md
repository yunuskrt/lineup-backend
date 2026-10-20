# Phase B38a — Filters & Coin Flip

## Status

Complete

## Goals

- **`src/game/coin-flip.ts`:** pure, with no Nest and no I/O.
  - `flipFilters([Filters, Filters], random)` returns `{ winner: Seat, filters }`. The winner's set is applied whole and never merged (HC 19).
  - `firstSeat(winner)`: who starts round 1 (Open Questions 1)
  - `NO_PREFERENCE`, the filter set used for a player who never submits (Open Questions 2)
- **`src/duel/duel-room.ts`:** `DuelRoom` becomes a union on `phase` (**States**). It replaces B37's single shape, and `DuelRooms` gains `save(room)`.
- **`src/matches/squad-views.ts`:** `revealOf` and `toGuessResult` move here from `src/solo/solo-views.ts`, which imports them back. The duel needs the same reveal rule, and it mustn't import from the solo module.
- **`src/duel/duel-views.ts`:** pure, per-receiver views. A seat becomes `you` or `opponent` for each player (**Views**).
  - `toFilterSubmission(room, seat)`
  - `toCoinFlip(room, seat)`
  - `toDuelSession(room, seat)`
- **`src/duel/duel-start.service.ts`:** `DuelStartService` takes a pair from `paired` to `matchReady` (**Flow**).
  - `submit(user, filters)` and `drop(userId)`
  - it owns the filter-window and flip-reveal timers, clears them on drop and on `onModuleDestroy`, and reads `CLOCK` and `RANDOM`
- **`src/duel/matchmaking.service.ts`:** pairing opens the room in `filters` and starts its filter window. `drop` of a room still before `playing` keeps B37's "Your opponent left." behaviour.
- **`src/duel/duel.gateway.ts`:** `filters:submit` becomes a real handler. `duel:guess` and `duel:forfeit` keep `refuseUntilOpen` until B38b.
- **`src/duel/duel.module.ts`:** imports `MatchesModule` and provides `DuelStartService` and `RANDOM` (`Math.random`, overridable in tests).
- **Tests:**
  - `src/game/coin-flip.spec.ts`: either seat can win, the set is returned whole, and the first seat follows the policy
  - `src/duel/duel-views.spec.ts`: both receivers of one room see the same moment with the actors swapped, and no view holds a squad player
  - `src/duel/duel-start.service.spec.ts` (selector, side picker, squad loader and Prisma mocked; fake timers):
    - the event order
    - every refusal
    - the filter window filling in `NO_PREFERENCE`
    - an empty pool after the flip
    - a squad that fails to load
    - a drop at each phase
  - `test/duel/duel-start.e2e-spec.ts` (**E2E**)

## States

| `phase` | Holds | Enters on | Leaves on |
| --- | --- | --- | --- |
| `filters` | the players and `submissions: [Filters \| null, Filters \| null]` | pairing (B37) | both submitted, or the window ends |
| `flipping` | the flip `{ winner, filters }` | the coin flip | match resolved and the reveal over: `playing`; a resolution failure: closed |
| `playing` | `match`, `side`, `squad`, `timed` (a B31 `TimedGame`), `firstRound` | `matchReady` | B38b |

- The squad lives only in `playing`, on the server (HC 2).
- Seat 0 is the player who queued first.
- A room's phase only moves forward, and every async step re-reads the room by id before writing. If the room was closed meanwhile (a drop), the step stops and emits nothing.

## Flow

1. **Paired (B37).** The room opens in `filters`, and its filter window starts (`FILTER_WINDOW_MS`).
2. **`filters:submit`:**
   - the payload is validated with `filtersSchema` (`invalid_input`)
   - the set is checked with `MatchSelectorService.check`. An empty pool is refused in the ack with `empty_pool` and `emptyBecause`, before anything is stored, so the flip can never land on an empty pool.
   - the set is stored on the player's seat, and both players get `filtersUpdated` from their own view
3. **Both sets in, or the window ends.** A missing set becomes `NO_PREFERENCE`. Both get `filtersUpdated` with both `submitted`, then `coinFlip` from their own view: `winner` is `you` or `opponent`, and `filters` is the winning set.
4. **Resolution,** with the room in `flipping`:
   - `MatchSelectorService.select(winning filters, RANDOM)`
   - `SidePickerService.pick(matchId)` (B32: the server picks the side in a duel)
   - `SquadLoaderService.load(matchId, side)`
   - the `MatchIdentity`, through `MATCH_IDENTITY_SELECT` as solo does
5. **The reveal.** `matchReady` is held until `FLIP_REVEAL_MS` after `coinFlip`, so the flip shows before any clock starts (the mock's `COIN_FLIP_REVEAL_MS`).
6. **`matchReady`.** `createTimedGame({ mode: 'duel', squad, firstSeat }, now)` starts round 1 at that instant. Both get `matchReady` with their own `DuelSession`. The room is now `playing`.

**Failures after the flip** close the room and send both players an `error` event. Both are idle and can queue again.

| Failure | `error` |
| --- | --- |
| the winning set has emptied since it was checked | `empty_pool`, with `emptyBecause` |
| the squad or match can't be loaded | `server_error`, `SERVER_ERROR_MESSAGE`. The log names the match id only. |

## Commands

| Command | When | Ack |
| --- | --- | --- |
| `filters:submit` | `filters`, not yet submitted | success, after `filtersUpdated` |
| `filters:submit` | already submitted, or the room is past `filters` | `forbidden`, "Filters are not open right now." |
| `filters:submit` | not in a room | `forbidden`, "Filters are not open right now." |
| `filters:submit` | a pool the filters empty | `empty_pool` + `emptyBecause`, "No match fits those filters. Try widening them." |
| `filters:submit` | a bad payload | `invalid_input`, naming the fields |

- The "not open" wording is the mock's, which the web already shows.
- The pool check is a database read, so the handler is async. A drop while it runs closes the room, and the store step then finds no room and refuses with `forbidden`.

## Views

`you` and `opponent` are always from the receiver's seat (`api-contract.md` §5).

- **`FilterSubmission`:** `yours` is the receiver's seat, `theirs` the other's
- **`CoinFlipResult`:** `winner` is `you` if the receiver's seat won
- **`DuelSession`:**
  - `sessionId`: the room id (B37)
  - `match`: `toMatchInPlay(identity, side, formation)`. Both players name the same XI.
  - `you` and `opponent`: `DuelPlayer` with the seat's lives
  - `turn`: `you` or `opponent`
  - `round`: the `RoundTiming` from the server clock
  - `found`: each found player through `revealOf`, with `foundBy` relative to the receiver. It's empty at `matchReady`.

## E2E

`test/duel/duel-start.e2e-spec.ts`, built like the matchmaking suite. `FILTER_WINDOW_MS` and `FLIP_REVEAL_MS` are overridden to short values, and `RANDOM` to a fixed sequence so the winner is known. The seeded mock fixtures (B09) are the pool, with `MATCH_POOL_INCLUDE_UNSCORED` on, as in the solo e2e.

- **The happy path:**
  - A and B are paired and both submit
  - each gets `filtersUpdated` twice, then `coinFlip`, then `matchReady`
  - A's `coinFlip.winner` is the opposite of B's, and both carry the same `filters`
  - `matchReady` comes no sooner than `FLIP_REVEAL_MS` after `coinFlip`
  - both sessions share `sessionId`, `match` and `round`, with `you` and `opponent` swapped, and `turn` matching the first-seat policy
  - `found` is empty
- **The winning set is applied whole:** with `RANDOM` forcing A's set, and A filtering to one club, `matchReady.match` has that club on one side.
- **Refusals:**
  - submitting twice
  - submitting when not in a room
  - a payload with `era.from > era.to`
  - filters that empty the pool get `empty_pool` and `emptyBecause`, and B never sees a `filtersUpdated` for it
- **The window:** only A submits, and when the window ends both get `coinFlip` with A's set or `NO_PREFERENCE`, then `matchReady`.
- **Drops:** a drop in `filters` and a drop in `flipping` each close the room. The other player gets "Your opponent left." and no `matchReady`.
- **No squad leaks:** no event before `matchReady` holds a player, and `matchReady.found` is empty. No payload holds an alias or a player that wasn't revealed.
- **The contract:** every event parses with its `duelEventSchemas` entry, and every ack with `socketAckSchema`.

## Open Questions

All three settled at `/feature load`, each as recommended.

1. **Who starts round 1?** B30 left it to B38.
   - **Recommended: the player whose filters lost the flip.** The winner gets their filters, and the loser gets the first name, which is the easiest to find. Neither gets both.
   - The flip winner: simpler, but it stacks both advantages on one player.
   - A second, independent coin flip: fair on average, but it can stack both, and it's one more thing to explain.
2. **What if a player never submits filters?** Nothing in the contract ends the filter step.
   - **Recommended: a 30 s window, after which a missing set becomes `NO_PREFERENCE` (every competition, every club, 2000–2025).** The flip still happens, so an idle player can't hold the other hostage.
   - End the pair with "Your opponent left." when the window closes: it throws away a pairing the active player waited for.
   - No window: the active player is stuck until the idle one disconnects.
3. **How long does the flip show before the clock starts?**
   - **Recommended: 2 s (`FLIP_REVEAL_MS`), matching the mock.** The web's flip animation is built for it, and the server owns the clock, so the server has to hold `matchReady` back.
   - No delay: round 1's 15 s would run while the web is still animating the flip.

## Out of Scope

- The round loop: `duel:guess`, the timer, `lifeLost`, `turnChanged`, `roundStarted`, `finished` and `duel:forfeit` (B38b)
- Checking every emitted payload against its schema at runtime, and the final event names (B39)
- The reconnect window (B40), persistence (B41), socket rate limits (B42)

## Notes

- Scope: the first of two B38 specs. It covers filters through `matchReady`. B38b runs the rounds and finishes the duel.
- **Taken from B39:** the per-receiver views (`duel-views.ts`). No duel event can be emitted without them. B39 keeps the runtime schema check on every emit, the final event names and a typed server event map.
- Depends on:
  - B37 (rooms, `DuelNotifier`, `MatchmakingService.drop`)
  - B25 (`select` and `check`), B32 (`SidePickerService`), B33a (`SquadLoaderService`, `MATCH_IDENTITY_SELECT`)
  - B31 (`createTimedGame`)
- Constraints:
  - **HC 19:** one set is applied whole, and both players are told whose. Never merged.
  - **HC 2:** the squad lives only in the `playing` room. No event before `matchReady` carries a player, and `matchReady` carries none.
  - **HC 15:** tier plays no part in the flip, the side or the match.
  - **HC 7:** the flip and first-seat rules live in `src/game/coin-flip.ts`, pure and tested. `src/duel/` only wires them.
  - **"Never fail silently":** a failure after the flip reaches both players as an `error`.
  - **Logging:** the match id at most, never a player, alias or filter value
  - No `any`; `@/` imports; comments single-line, at most 50 characters
- For B38b: the `playing` room holds `timed`, so B38b only adds the loop. `drop` in `playing` is B38b's to define.
- For W31 (web): the "not open" and empty-pool messages, the 30 s window, and the 2 s reveal.
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`
  - By hand: two guests with a small `socket.io-client` script, through `matchReady`. Check that each sees the other's flip result as the opposite, and that neither payload holds a squad player.

**Deviations recorded during implementation**

- **Ending a room on a drop moved from `MatchmakingService` to `DuelStartService.drop`.** `MatchmakingService.drop` leaves the queue itself, and otherwise hands the user to the start service. Pairing calls `DuelStartService.open(room)`, which starts the filter window.
- **The duel messages moved to `src/duel/duel-messages.ts`:** `MATCHMAKING_MESSAGES` and the new `DUEL_START_MESSAGES`. The matchmaking service injects the start service, and both need "Your opponent left.", so keeping the messages in either service file would be a runtime import cycle.
- **An empty pool after the flip says "No match fits the winning filters."** (the mock's wording). The spec didn't name the message.
- **`RANDOM` is `SYSTEM_RANDOM` in `src/common/random.ts`,** next to `CLOCK`. `src/game/coin-flip.ts` declares its own `Random` type, since `src/game/` imports nothing outside the contract.
- **Rooms:**
  - the types, `seatOf` and `otherSeat` live in `src/duel/duel-room.ts`
  - `DuelRooms` gained `get(roomId)` as well as `save`; `save` returns `false` for a closed room
  - a `flipping` room keeps only the flip, not the submissions
- **Views:** `toFilterSubmission(submissions, seat)` takes the submissions rather than the room. `toCoinFlip` takes any room that has a flip.
- **The squad fixture moved too,** to `src/matches/squad.fixtures.ts`. `src/solo/solo.fixtures.ts` re-exports it, so the solo specs are unchanged. The `toGuessResult` cases moved to `src/matches/squad-views.spec.ts`.
- **`filters:submit` validates through `@MessageBody(new ZodValidationPipe(filtersSchema))`.** That's the pipe on a real handler's body, as B36 planned. `parseCommand` stays for the queue commands and the two placeholders.
- **One pending timer per room:** the filter window, then the reveal. A drop or a failure clears it.
- **A drop while `playing` still ends the room with "Your opponent left."** There's no loop yet; B38b replaces it with a forfeit.
- **Logging:** a failed start logs `Duel start failed for match <id> (<Class>)`. The error's message is never logged, since a squad error could name a player.
- **Existing tests:**
  - `matchmaking.service.spec.ts`: the broken-pair cases moved to `duel-start.service.spec.ts`. New cases check that pairing hands the room on and that a paired drop is delegated.
  - The gateway suite's valid `filters:submit` case now expects "Filters are not open right now." from a player in no duel.
- **E2E:**
  - the window is 1.5 s and the reveal 300 ms
  - `RANDOM` is a fixed draw, set per case
  - the empty-pool case filters to one competition in the single season 2000–2000
- **Tests:**
  - **Unit:** 992 in all (39 new), in `coin-flip.spec.ts`, `duel-views.spec.ts`, `duel-start.service.spec.ts`, `duel-rooms.spec.ts`, `matchmaking.service.spec.ts` and `squad-views.spec.ts`
  - **E2E:** 389 in all (11 new), in `test/duel/duel-start.e2e-spec.ts`
- **Mutation checks:**
  - the flip winner moving first fails 2 cases
  - no reveal wait fails 3
  - skipping the re-read after the pool check fails the closed-during-check case
  - `begin`'s phase check can't be reached on its own, because a closed room is already `null`; it stays, to narrow the type
- **By hand,** on the built server (port 8081):
  - two guests got `filtersUpdated` twice, then opposite `coinFlip` winners with the same set
  - `matchReady` came 2001 ms after `coinFlip`, with the same `sessionId`, match and side, `you` and `opponent` swapped, and the flip loser on turn
  - the log held none of the match's 22 players and no token
  - both guests were deleted
- **Review:**
  - **Fixed:** `resolve` now re-reads the room after the squad load. Before, a drop during the load left a reveal timer running for a closed room (harmless, since `begin` re-reads, but it broke "every async step re-reads"). The closed-while-loading case now checks that no timer is left, and fails without the guard.
  - **Checked:** a pool check still pending when the window closes ends in "Filters are not open right now." That player's set became `NO_PREFERENCE` when the window flipped. Accepted: the window had already run out.
  - **Checked:** a resolution still in flight at shutdown may log one failure, and its `error` goes to a closed server. Accepted: only at shutdown, and nothing is lost that B41 would have saved.
  - **Checked:** no log line holds a player, alias, filter value or token. `coinFlip` shows the winning set to both players, as HC 19 and the contract require.
  - **Checked:** tier plays no part in the flip, the side or the match (HC 15).
- **At `/feature test`:** 3 new cases in `duel-start.service.spec.ts`. Unit tests are now 995 in all (42 new in B38a).
  - a selector that fails before any match logs `match none`, and the squad is never loaded
  - a thrown non-`Error` is logged by its type, never its value
  - a load that fails after a drop has closed the room sends nothing more; the player left behind hears only "Your opponent left."
  - **Coverage from unit tests:**
    - 100% lines, branches and functions for `coin-flip.ts`, `duel-room.ts`, `duel-rooms.ts`, `duel-views.ts`, `duel-messages.ts`, `random.ts`, `squad-views.ts` and `solo-views.ts`
    - `duel-start.service.ts`: 100% lines and functions, 95% branches. The two misses can't be reached from outside: the window firing for a room that has moved on (the flip and a drop both cancel it) and `begin`'s phase check (see **Mutation checks**).
    - `matchmaking.service.ts`: 100% lines, 91.66% branches. The miss is B37's `timeOut` guard.
    - `duel.gateway.ts` and `duel.module.ts` are wiring, covered by the 48 duel e2e cases

## History
