# Phase B37 — FIFO Matchmaking

## Status

Complete

## Goals

- **`src/duel/matchmaking-queue.ts`:** `MatchmakingQueue`, a FIFO of waiting players in insertion order. It's plain TypeScript with no timers and no Nest.
  - `enter(player, since)` adds a waiting entry
  - `takeOpponent(userId)` returns and removes the oldest entry that isn't the caller
  - `leave(userId)` returns whether the user was waiting
  - `has(userId)`
- **`src/duel/duel-rooms.ts`:** `DuelRooms`, the pairs made so far (**Rooms**).
  - `open(a, b)` creates `{ id, players: [a, b], pairedAt }` with a `randomUUID()` id
  - `roomOf(userId)` returns the user's room, or `null`
  - `close(roomId)`
- **`src/duel/duel-notifier.ts`:** `DuelNotifier`, the one way the duel code talks to a player.
  - `toUser(userId, event, payload)` emits to the room `user:<id>` and is typed against `DuelEventMap`
  - the gateway gives it the server in `afterInit`
  - B38–B40 reuse it
- **`src/duel/matchmaking.service.ts`:** `MatchmakingService`. It joins the queue, the rooms, the timeout timers and `CLOCK` (**Queue**).
  - `enter(user)`, `leave(userId)` and `drop(userId)` (a connection that closed or was replaced)
  - it throws `ApiException` for the refusals in **Commands**
  - on `onModuleDestroy` it clears every timer
- **`src/duel/duel.gateway.ts`:**
  - `queue:enter` and `queue:leave` become real handlers, calling the service with `socket.data.user`
  - `handleDisconnect` and a replaced socket in `handleConnection` call `drop`
  - `filters:submit`, `duel:guess` and `duel:forfeit` keep `refuseUntilOpen` until B38–B40
- **`src/duel/duel.module.ts`:** add `MatchmakingService`, `DuelRooms`, `DuelNotifier`, `SYSTEM_CLOCK` and the `QUEUE_TIMEOUT_MS` provider (Open Questions 1).
- **Tests:**
  - `src/duel/matchmaking-queue.spec.ts`: first in pairs first; a user can't take themselves; `leave` removes only that user; an empty queue gives `null`
  - `src/duel/duel-rooms.spec.ts`: `open` maps both users to one room; `close` frees both; a user is in at most one room
  - `src/duel/matchmaking.service.spec.ts` (fake timers, a fixed `CLOCK`, a recording notifier): the event order, the refusals, the timeout and `waitedMs`, `drop` while queued and while paired, timers cleared on leave, on pairing and on destroy
  - `test/duel/matchmaking.e2e-spec.ts` (**E2E**)

## Queue

- **Pairing happens on `queue:enter`.** If anyone is waiting, the oldest waiting player is paired with the newcomer straight away. If not, the newcomer waits. Since Node runs one handler at a time, the queue holds at most one waiting player. It stays a FIFO, so B46's Redis queue keeps the same shape.
- **Every entrant gets `queued` first,** `{ phase: 'queued', since }`, with `since` from `CLOCK`. That includes a newcomer who is paired at once. The web resets its lobby state on `queued`, so `queued` must never come after `paired`.
- **On pairing,** each player gets `paired`, `{ phase: 'paired', opponent }`. `opponent` is the other player's `DuelPlayer`:
  - `id`: their user id
  - `handle`: from `socket.data.user`, as loaded at the handshake
  - `lives`: `MAX_LIVES`
- **Both events reach the client before the command's ack,** since they're emitted inside the handler. The web's `enterQueue` does nothing with a successful ack, so the order is safe.
- **Timeout:** a player still waiting after `QUEUE_TIMEOUT_MS` is removed and gets `queueTimedOut`, `{ phase: 'queued', waitedMs }`, with `waitedMs` from `CLOCK`. They're idle again, so the web's "search again" is just another `queue:enter`.
- **One timer per waiting player.** It's cleared on pairing, on `leave` and on `drop`.
- **A closed or replaced connection leaves the queue.** The web's `leave()` sends `queue:leave` as a best effort, then disconnects. With "latest wins" (B36), the new socket starts idle and must enter again.
- **Events go to the user, not the socket:** `DuelNotifier` emits to `user:<id>`, and B36 keeps exactly one socket in it.

## Rooms

- **A pair is a `DuelRoom` in memory:** `{ id, players: [DuelPlayer, DuelPlayer], pairedAt }`. Its `id` becomes the duel's `sessionId` in B38.
- **No Socket.IO room per duel.** Every duel event is per player, with `you` and `opponent` swapped, so it goes to `user:<id>` anyway.
- **A user is in at most one room.** Until B38 opens filters, a pair can't do anything else. The room ends when either player's connection closes or is replaced (Open Questions 2).
- **When a room ends early,** the other player gets an `error` event, `session_over`, "Your opponent left.", and is idle again. The web treats an `error` outside a live match as a failed step. B40 replaces this with the reconnect window once a match is running.

## Commands

| Command | When | Ack |
| --- | --- | --- |
| `queue:enter` | idle | success, after `queued` (and `paired` if someone was waiting) |
| `queue:enter` | already waiting | `forbidden`, "You're already in the queue." |
| `queue:enter` | in a room | `forbidden`, "You're already in a duel." |
| `queue:leave` | waiting | success; no event |
| `queue:leave` | not waiting, or in a room | `forbidden`, "You're not in the queue." |
| either | with a payload | `invalid_input`, as in B36 |

- **The payload is still validated with its `duelCommandSchemas` entry,** inside the handler. A `@MessageBody(pipe)` parameter that's never read fails lint (B36). `refuseUntilOpen` is split: a `parseCommand(command, payload)` helper does the validation for all five handlers, and the three placeholders then throw `forbidden`.
- **The user comes only from `socket.data.user`** (set by the handshake), never from a payload.
- **A user may queue with a solo run open.** Solo and duel don't share state.

## E2E

`test/duel/matchmaking.e2e-spec.ts` boots `AppModule` with `LineupIoAdapter` on port 0, as the gateway suite does, with `QUEUE_TIMEOUT_MS` overridden to a few hundred ms. Players are guests from `POST /auth/guest`, with tokens from `GET /auth/token`. `test/duel/socket-client.ts` gets a helper that turns a fresh guest into a connected socket. B43 builds on it.

- **Pairing:**
  - A enters, gets `queued` and a success ack
  - B enters, gets `queued` then `paired`
  - A gets `paired`; each `opponent` is the other guest's id and handle, with 3 lives
- **FIFO:** A, B and C enter, A and B are paired, and C waits. D enters and is paired with C.
- **Refusals:** entering twice, entering while paired, and leaving while not waiting each get the `forbidden` ack from **Commands**. A payload on `queue:enter` gets `invalid_input`.
- **Leave:** A enters and leaves, B enters, and B waits. A gets no `paired`.
- **Timeout:**
  - A waits and gets `queueTimedOut` with `waitedMs` at least the timeout
  - A can then enter again and be paired
- **Drop while waiting:** A enters and disconnects, B enters, and B waits.
- **Replaced while waiting:** A enters, then connects again with a fresh token. The old socket is closed (B36), and B, entering next, isn't paired with A.
- **Drop while paired:** A and B are paired and A disconnects. B gets `error` `session_over` "Your opponent left." and can enter again.
- **Contract:** every event parses with its `duelEventSchemas` entry, and every ack with `socketAckSchema`.
- **Cleanup:** the suite deletes its guests and closes every client.

## Open Questions

Both settled at `/feature load`, each as recommended.

1. **How long does a player wait before `queueTimedOut`?** The contract doesn't say, and the mock's 2 s is only a demo.
   - **Recommended: 60 s,** as a `QUEUE_TIMEOUT_MS` provider that the e2e suite overrides. It's long enough to catch a second player in a small pool, and short enough that the web's "play solo with these filters" offer comes before the player gives up.
   - 30 s: suits a busy pool better, but it times out more often while the pool is thin.
   - An env variable: easy to tune per deploy, but it's one more setting to validate before there's any data to tune it with.
2. **What happens to a pair when one player leaves before B38 exists?**
   - **Recommended: the room ends, and the other player gets `error` `session_over`, "Your opponent left."** They're idle and can queue again, and nobody is stuck in a room that can't move.
   - Keep the room until both leave: the remaining player is shut out of the queue with no way back except reconnecting.
   - `opponentConnection` `forfeited`: the web only reads that during a live match, so before the match it would be ignored, a silent failure.

## Out of Scope

- Filters, the coin flip and the match (B38). `filters:submit` still answers "Duels aren't open yet."
- Typed payload checks on every emit (B39), the reconnect window and forfeit (B40), persistence (B41)
- Socket rate limits (B42), including on `queue:enter` spam; the queue holds one entry per user, so spam can't grow it
- Skill-based pairing, which project overview § D rules out at MVP
- A Redis queue for several instances (B46)

## Notes

- Scope: a single spec, covering the queue, pairing into an in-memory room, the timeout and the two queue commands. It's all proven together by one socket e2e suite. The filter coin flip starts in B38.
- Depends on: B36 (the gateway, `ConnectionRegistry`, `roomOf`, `SocketEnvelopeFilter`, the e2e socket client), B33b (`CLOCK`)
- Constraints:
  - **Project overview § D:** matchmaking is FIFO. The first two waiting clients are paired, with no rating.
  - **"Never trust a client-supplied user id":** both players come from `socket.data.user`.
  - **"Never fail silently on a game action":** every refusal is an ack, and a room that ends early tells the player left behind.
  - **HC 15:** tier plays no part in pairing.
  - The queue and rooms hold no game logic, and `src/game/` is untouched.
  - No `any`; `@/` imports; comments single-line, at most 50 characters
- Carried forward from B36: the validation pipe moves onto real handlers; `ConnectionRegistry` and `roomOf` route the events; B37 must emit `queueTimedOut` (`mock-to-backend-map.md` watch-out 5).
- For B38: open filters on the room this phase creates, use its `id` as the `sessionId`, and reuse `DuelNotifier` and `CLOCK`.
- For W31 (web): give the web session the event order, the refusal messages, the timeout length and the "Your opponent left." error after this phase, as was done for W30.
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`
  - By hand on `npm run start:dev`: connect two guests with a small `socket.io-client` script, enter both, and see `queued` and `paired` on each. Then connect one alone and see `queueTimedOut` after 60 s.

**Deviations recorded during implementation**

- **`roomOf` moved from the gateway to `duel-notifier.ts`.** The notifier needs it, and importing it from the gateway would be a runtime import cycle (the gateway injects the notifier).
- **The socket server keeps Socket.IO's default event map.** A generic `emit(event, payload)` doesn't narrow on a typed map, so the typing sits on `DuelNotifier.toUser`, checked against `DuelEventMap`. Strict emit typing stays with B39.
- **`DuelNotifier.toUser` throws if called before `afterInit` attaches the server,** rather than dropping the event.
- **`ConnectionRegistry.remove` returns whether the socket was the current one.** `handleDisconnect` calls `drop` only then, so a replaced socket's late close can't touch the new connection. The replacement path in `handleConnection` calls `drop` itself.
- **`SUCCESS_ACK` (`{ success: true, data: null }`) is exported from `socket-envelope.filter.ts`.** The queue handlers return it, since Nest acks only a non-nil return.
- **`parseCommand` returns nothing.** No handler reads the parsed payload yet. `refuseUntilOpen` calls it and then throws.
- **Exported from `matchmaking.service.ts`:** `MATCHMAKING_MESSAGES`, `QUEUE_TIMEOUT_MS` and `DEFAULT_QUEUE_TIMEOUT_MS`.
- **Gateway suite:** the three cases that used `queue:enter` or `queue:leave` as placeholders now use `duel:forfeit`, which still answers "Duels aren't open yet."
- **`test/duel/socket-client.ts` gained** `recordEvents`, `gatewayToken` and `connectGuest`.
- **E2E timeout is 1 s,** not a few hundred ms, so a slow Neon round trip can't time a player out before their partner enters. `afterEach` waits until the server has seen every close, so no waiting player leaks into the next case.
- **Added `src/duel/duel-notifier.spec.ts`,** which the goals didn't list: the user room, the event, and the throw before attach.
- **Tests:**
  - **Unit:** 953 in all (37 new), in `matchmaking-queue.spec.ts`, `duel-rooms.spec.ts`, `duel-notifier.spec.ts`, `matchmaking.service.spec.ts` and `connection-registry.spec.ts`
  - **E2E:** 378 in all (11 new), in `test/duel/matchmaking.e2e-spec.ts`
- **Mutation checks:**
  - without `drop` on replacement, the replacing-connection case fails
  - without `drop` on disconnect, the closed-connection and broken-pair cases fail
- **By hand,** on the built server (port 8081):
  - two guests each got `queued`, then `paired` with the other's id, handle and 3 lives, before a success ack
  - closing one gave the other `error` `session_over` "Your opponent left."
  - a lone guest got `queueTimedOut` with `waitedMs` 60002
  - the log held no token
  - the three guests were deleted
- **`DuelRooms.open` takes `pairedAt` as well:** `open(a, b, pairedAt)`. The clock lives in `MatchmakingService`, so the rooms store never reads the time itself.
- **Review:**
  - **Checked:** a replaced socket's late `disconnect` can't drop the new connection, because `remove` returns `false` for it. Both sockets share `user:<id>` only inside `handleConnection`, which closes the old one before returning.
  - **Checked:** no new log line, and no payload carries anything but ids, handles, lives and times. A player sees their opponent's user id, which `DuelPlayer` requires and the server never trusts from a client.
  - **Accepted until B40:** a player who reconnects while paired ends their own room, and the opponent hears "Your opponent left." B40's reconnect window replaces this once a match is running.
  - **Left for B43:** the gateway suite keeps its own guest and token helpers. Moving it onto `connectGuest` and `gatewayToken` belongs with the two-client harness.
- **At `/feature test`:** no new cases. Unit coverage of the new code:
  - 100% lines, branches and functions for `matchmaking-queue.ts`, `duel-rooms.ts`, `duel-notifier.ts` and `connection-registry.ts`
  - `matchmaking.service.ts`: 100% lines and functions, 93.75% branches. The miss is the guard in `timeOut` for a player no longer waiting. Every way out of the queue clears the timer first, so it can't be reached from outside; it stays as a guard for B38 onwards.
  - `duel.gateway.ts` and `duel.module.ts` are wiring, covered by the 11 matchmaking and 26 gateway e2e cases

## History
