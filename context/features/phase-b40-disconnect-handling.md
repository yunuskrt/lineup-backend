# Phase B40 — Disconnect Handling

## Status

Complete

## Goals

- **`src/duel/duel-room.ts`:** `PlayingRoom` gains `away: readonly [number | null, number | null]`, each seat's reconnect deadline, or `null` while connected.
- **`src/duel/duel-play.service.ts`** (**Window**):
  - `drop(userId)` opens the seat's 20 s window instead of forfeiting
  - `rejoin(userId, socket)` resumes a `playing` room for a returning connection
  - a window that runs out applies a forfeit for that seat, catching the clock up first
  - one window timer per away seat, cleared on rejoin, on the end of the duel and on `onModuleDestroy`
- **`src/duel/duel.gateway.ts`:**
  - `handleConnection` calls `rejoin` for every admitted socket
  - a connection that replaces another while the user is `playing` resumes the duel instead of dropping it (**Replacement**)
- **`src/duel/socket.adapter.ts`:** `pingInterval` and `pingTimeout` tuned against the window (Open Questions 2; B36's note).
- **`src/duel/duel.module.ts`:** a `RECONNECT_WINDOW_MS` provider, defaulting to the contract constant, so the e2e suite can shorten it.
- **Tests:**
  - `src/duel/duel-play.service.spec.ts`:
    - a drop opens the window and tells the opponent
    - a rejoin inside it resumes, and both are told
    - the window running out forfeits for that seat
    - the clock keeps running while a seat is away
    - lives running out while away end the duel normally, with no forfeit
    - both seats away
    - a second drop after a rejoin opens a fresh window
    - every timer is cleared
  - `src/duel/socket.adapter.spec.ts`: the ping settings
  - `test/duel/disconnect.e2e-spec.ts` (**E2E**)

## Window

The contract's reconnect window is 20 s, and the dropped player's clock keeps running (`api-contract.md` §5 and §6; project overview § D).

| Moment | The player who dropped | The opponent |
| --- | --- | --- |
| a drop while `playing` | nothing (no socket) | `opponentConnection` `{ status: 'reconnecting', reconnectDeadline }` |
| back inside the window | `disconnected` `{ status: 'connected', reconnectDeadline: null }`, then `matchReady` with the current `DuelSession` | `opponentConnection` `{ status: 'connected', reconnectDeadline: null }` |
| the window runs out | nothing | `opponentConnection` `{ status: 'forfeited', reconnectDeadline: null }`, then `finished` `forfeit_win` |

- **`reconnectDeadline`** is the drop time from `CLOCK` plus `RECONNECT_WINDOW_MS`.
- **The clock keeps running.** The room's round timer is untouched, so an away player on turn loses a life on each expiry, and both players get the usual events. If those expiries end the duel, it's an ordinary `finished` (`loss` / `win`, `isForfeit: false`), and the window closes with no `forfeited` notice.
- **The opponent keeps playing** on their own turns while the other seat is away.
- **When the window runs out,** the forfeit goes through `applyTimed`, so the clock catches up first. The forfeit only applies if the duel is still running.
- **Both seats away:** each has its own window, and the first to run out forfeits that seat, so the other wins with `forfeit_win`. Nobody is connected to hear `finished`, so both players find themselves idle when they return. B41 is what makes the result visible later, in their history.
- **A finished duel closes its room as before** (B38b). A player who returns after that is idle and can queue again.
- **Commands from a player who has rejoined** work as normal.

## Rejoin

`rejoin(userId, socket)` runs in `handleConnection` for every socket the handshake admits:

- **No `playing` room:** nothing happens.
- **A `playing` room with the seat away:** the window is cancelled. The returning socket gets `disconnected` (`connected`) then `matchReady` (Open Questions 1), and the opponent gets `opponentConnection` (`connected`).
- **A `playing` room with the seat present** (a replacing connection, below): the new socket gets `matchReady`. The opponent hears nothing, since nothing changed for them.
- **Both events go through `DuelNotifier.toSocket`** to the returning socket only, which keeps B39's schema check.

## Replacement

B36's "latest wins" stays. While a duel is `playing`, a second connection now resumes the duel instead of forfeiting it (B38b's "accepted until B40"):

- the old socket gets the takeover notice and is closed, as before
- the user is **not** dropped, so no window opens
- `rejoin` sends the new socket `matchReady`

Before `playing`, a replacement still ends the room with "Your opponent left." (B37, B38a). Resuming filters or the flip is out of scope.

## Ping

Socket.IO notices a silent drop (a phone losing signal, a laptop lid shut) only through its heartbeat. The defaults, a 25 s interval and a 20 s timeout, can take 45 s to notice, longer than the whole window. Until then the server thinks the player is still there, so no window opens and the opponent isn't told.

## E2E

`test/duel/disconnect.e2e-spec.ts` reaches `matchReady` as the play suite does. `RECONNECT_WINDOW_MS` is overridden to 2 s, and `CLOCK` is real time plus a skew (B38b).

- **Drop and return:**
  - A closes their socket; B gets `opponentConnection` `reconnecting` with a deadline about 2 s ahead
  - A connects again with a fresh token and gets `disconnected` `connected`, then `matchReady` with the same `sessionId` and `found`
  - B gets `opponentConnection` `connected`
  - A can then guess on their turn
- **The window runs out:** A closes and never returns. B gets `opponentConnection` `forfeited`, then `finished` `forfeit_win`, and can queue again.
- **The clock runs while away:** A is on turn and closes; the suite adds a round's worth of skew and B sends a guess. Both seats' lives match one expiry against A, and A's `matchReady` on return shows it.
- **A second tab mid-duel:** the old socket gets the takeover notice. The new one gets `matchReady`, B gets no connection event, and the duel goes on.
- **A drop before `playing`** still gives "Your opponent left." (B38a's case stays green).
- **The contract:** every event parses, through the suites' usual `afterEach` check.

## Open Questions

Both settled at `/feature load`, each as recommended.

1. **What does a returning socket get as its snapshot?**
   - **Recommended: `matchReady` with the current `DuelSession`.** The web enters `playing` on `matchReady` from any state, so it works both for a client whose socket reconnected by itself (its state still live) and for a reloaded tab (its state empty). The contract calls `matchReady` authoritative.
   - `roundStarted`: also authoritative, but the web applies it only while already live, so a reloaded tab would ignore it.
   - A new `resumed` event: clearer, but a contract change, so `PROTOCOL_VERSION` would go up in every repo.
2. **How fast should a silent drop be noticed?**
   - **Recommended: `pingInterval` 10 s, `pingTimeout` 5 s**, so a silent drop is noticed within 15 s and the window opens while it still means something. That's one small packet every 10 s per socket.
   - Keep the defaults (25 s and 20 s): up to 45 s before anyone knows, and the dropped player loses lives to the clock with no window ever opening.
   - Tighter (5 s and 3 s): faster, but a mobile browser that throttles background tabs would drop and rejoin far more often.

## Out of Scope

- Resuming the filter step or the coin flip after a drop. Those still end with "Your opponent left."
- Saving the duel (B41), socket rate limits (B42), the two-client harness (B43)
- A queue position surviving a drop (B37: a dropped player leaves the queue)
- Several server instances, sticky sessions and the Redis adapter (B45, B46)

## Notes

- Scope: a single spec, covering the reconnect window, the rejoin snapshot, the replacement case and the heartbeat. It's proven by the play service's unit suite and one socket e2e suite.
- Depends on:
  - B36 (the handshake, `ConnectionRegistry`, the adapter)
  - B38b (`DuelPlayService`, the round timer, `drop`)
  - B39 (`DuelNotifier.toSocket`, the schemas for `opponentConnection` and `disconnected`)
- Constraints:
  - **Project overview § D:** a reconnect window of about 20 s comes before a leave counts as a forfeit, and the timer keeps running during it
  - **HC 1 and HC 11:** the window never pauses or stretches a round
  - **HC 9:** a life is still lost only to the clock, including while away
  - **"Never trust a client-supplied ... elapsed time":** the deadline comes from `CLOCK`, never the client
  - **"Never fail silently":** the opponent always hears that the other player went away, came back, or forfeited
  - No `any`; `@/` imports; comments single-line, at most 50 characters
- For B41: a forfeit after the window is a duel result like any other. Its `isForfeit` is `true`.
- For W31 (web):
  - a reloaded tab mid-duel gets `matchReady` straight after connect, so it should skip its automatic `queue:enter`; that would only get "You're already in a duel."
  - the server never sends `disconnected` `reconnecting`, since the dropped socket is gone. The web shows that state from its own transport events.
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`
  - By hand: two `socket.io-client` scripts reach `matchReady`. Kill one and reconnect it inside 20 s, and see the resume. Kill it again and wait the window out, and see the forfeit.

**Deviations recorded during implementation**

- **The provider token is `RECONNECT_WINDOW`,** exported from `duel-play.service.ts`. It defaults to the contract's `RECONNECT_WINDOW_MS`, and the e2e suite overrides it.
- **`withSeat(pair, seat, value)`** in `duel-room.ts` sets one seat of `away`.
- **`DuelPlayService.isPlaying(userId)`** was added for the gateway: a replacement skips `drop` only while the user is `playing`.
- **`rejoin` applies a `tick` first,** so the snapshot shows the clock as it is now. If that catch-up ends the duel, there's nothing left to resume, and the player gets `finished` instead.
- **A window that runs out catches the clock up before anything else,** then sends `forfeited`, then applies the forfeit. So the `forfeited` notice goes out only when the forfeit is what ends the duel.
- **`openWindow` clears any earlier timer for the seat.** A mutation that left the first window's timer running after a rejoin passed every test at first. A new case now proves a stale window can't end a second absence early, and it fails without both guards.
- **The heartbeat values** are `PING_INTERVAL_MS` and `PING_TIMEOUT_MS`, exported from `socket.adapter.ts`.
- **Adapter spec:** the merge-order case now uses `connectTimeout`, because the env sets `pingTimeout` itself. Its options are cast to `ServerOptions`, a type error that only a full `tsc` over the spec files showed.
- **The play suite's "drop mid-duel forfeits" case** moved to `test/duel/disconnect.e2e-spec.ts`, where a drop now opens the window instead.
- **Tests:**
  - **Unit:** 1060 in all (13 new), in `duel-play.service.spec.ts` and `socket.adapter.spec.ts`
  - **E2E:** 404 in all (4 new in `test/duel/disconnect.e2e-spec.ts`; 1 moved out of the play suite)
- **Mutation checks:**
  - a drop that forfeits at once fails 10 cases
  - a rejoin with no catch-up fails the "clock as it is now" case
  - a second tab dropped while `playing` fails the second-tab e2e case
  - a stale window timer fails the second-absence case (with both guards removed)
- **By hand,** on the built server (port 8081, the real 20 s window):
  - A dropped, B got `reconnecting` with a deadline 20 s ahead
  - A came back after 3 s with a new socket and got `disconnected` `connected`, then `matchReady` with the same session; B got `connected`
  - A dropped for good; the clock ran on, and B, who was on turn, lost a life
  - B got `forfeited`, then `finished` `forfeit_win`, 20 008 ms after the drop
  - the log held no token and no contract failure, and both guests were deleted
- **Review:**
  - **Simplified:** the three `opponentConnection` notices go through one `tellOpponent(room, seat, status, deadline)` helper.
  - **Checked:** if `rejoin`'s catch-up applies expiries, the returning socket hears them (`lifeLost`, `turnChanged`, `roundStarted`) before `disconnected` and `matchReady`, because it has already joined `user:<id>`. That's correct, but the **Window** table shows only the last two. The snapshot still settles the state.
  - **Checked:** with a second tab, the old socket is disconnected before `rejoin` runs, so the catch-up's events and `matchReady` reach only the new socket.
  - **Checked:** a window can't outlive its duel. Any end of the duel (lives, a draw, a forfeit, an expired window) runs through `apply`, which closes both seats' windows before closing the room.
  - **Checked:** the deadline comes from `CLOCK`, and the client sends nothing about timing.
- **At `/feature test`:** 2 new cases in `duel-play.service.spec.ts`. Unit tests are now 1062 in all (15 new in B40).
  - a rejoin whose catch-up ends the duel sends no snapshot: the player gets `finished` (`loss`) through their room, and no timer is left
  - `isPlaying` is true for both seats, false for a stranger, and false once the duel ends
  - **Coverage from unit tests:**
    - 100% lines, branches and functions for `duel-room.ts` and `socket.adapter.ts`
    - `duel-play.service.ts`: 100% lines and functions, 90% branches. The misses can't be reached from outside: `expire` finding its seat back or its room gone (a rejoin or the end of the duel closes the window first), `expire`'s catch-up ending the duel (a due round timer always fires before the window), and B38b's two timer guards.
    - the gateway's rejoin wiring is covered by the 4 disconnect e2e cases
- **At `/feature complete`:** the final full e2e run failed once on B37's queue-timeout case, which asserted `waitedMs >= TIMEOUT_MS`. Node timers run on a cached loop clock, so a timer can fire when `Date.now()` has moved 1 ms less than its delay; a 200-timer check reproduced it once. The server is right to report the wait it measured, and the contract only asks for `waitedMs >= 0`. The assertion now allows 5 ms, with a comment. Two more full runs passed, 404 of 404.

## History
