# R6a — Private Rooms

## Status

Complete

## Goals

- **Contract**, `src/contract/duel.ts`:
  - `roomCodeSchema`: 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `0 O 1 I L`), **uppercased before the check**, so `k7qm2x` is accepted as `K7QM2X`
  - `roomStateSchema` (`RoomState`): `code` (uppercase), `filters: Filters` (as applied), `expiresAt: epoch ms`
  - `roomExpirySchema` (`RoomExpiry`): `code`
  - `roomJoinRequestSchema` (`RoomJoinRequest`): `{ code }`
  - `coinFlipResultSchema` gains `source: 'coin' | 'room'` (a new `CoinFlipSource` enum)
  - `duelCommandSchemas` gains `room:create` (`Filters`), `room:join` (`RoomJoinRequest`) and `room:leave` (none)
  - `DUEL_COMMAND_REFUSALS`:
    - `room:create`: `forbidden`, `invalid_input`, `empty_pool`, `rate_limited`, `server_error`
    - `room:join`: `not_found`, `forbidden`, `invalid_input`, `rate_limited`, `server_error`
    - `room:leave`: `forbidden`, `invalid_input`, `rate_limited`, `server_error`
  - `duelEventSchemas` gains `roomCreated` (`RoomState`) and `roomExpired` (`RoomExpiry`)
  - the socket catalogue (`x-socket`) and the typed socket maps follow from these, as in B39
- **Codes**, a pure `src/duel/room-code.ts`:
  - `ROOM_CODE_ALPHABET` and `ROOM_CODE_LENGTH`
  - `newRoomCode(isTaken, pick)`: draws characters with `pick` until the code is not taken (D1)
  - the service draws with `crypto.randomInt`, never the injectable game `RANDOM`, so a code can't be predicted. Tests inject their own `pick`
- **Rooms**, a new `PrivateRooms` service, `src/duel/private-rooms.service.ts`. The name keeps clear of `DuelRooms`, which holds paired duels:
  - in memory only (HC 6): open rooms by code, and each creator's code
  - `create(user, filters)`:
    - `forbidden` if the user is queued, hosting an open room, or in a duel
    - checks the pool with `MatchSelectorService.check`, as `filters:submit` does: `empty_pool` + `emptyBecause`, and nothing is stored
    - re-checks the user's state after that await, since a drop or another command may have won
    - stores the room, starts its timer and sends `roomCreated` to the creator
  - `join(user, code)`:
    - `invalid_input` if the code isn't 6 characters of the alphabet (the schema does this)
    - `forbidden` if the user is queued, hosting or in a duel. The user's own code is also `forbidden`
    - `not_found` if no open room has that code: wrong, expired, left or already joined (D2)
    - otherwise the room closes, its code is freed, and the pair starts (below)
  - `leave(userId)`: `forbidden` if not hosting an open room; otherwise it closes and frees the code. No event: the ack is the answer
  - `drop(userId)`: the creator's socket closed or was taken over, so the room closes at once. No reconnect window before the pairing
  - the wait timer: `ROOM_WAIT_MS`, injectable like `QUEUE_TIMEOUT_MS`, default 10 minutes. On expiry the room closes and the creator gets `roomExpired`. `unref`'d, and cleared on module destroy
- **Queue and rooms exclude each other**:
  - `queue:enter` refuses a creator with `forbidden`, with its own message
  - `room:create` and `room:join` refuse a queued player
  - `filters:submit` is unchanged. A creator has no duel, so it's `forbidden` as today
- **The pairing**, from a join:
  - `DuelRooms` gains `openRoom(creator, joiner, filters, pairedAt)`: a `FlippingRoom` with the creator at seat 0, the joiner at seat 1, and `flip: { winner: 0, filters }`
  - `RoomBase` gains `origin: 'queue' | 'room'`. A queue pairing is `queue`
  - `paired` goes to both, as for the queue
  - `DuelStartService.openFlipped(room)` sends `coinFlip` at once and runs the same `resolve` → 2 s reveal → `matchReady` path. There's no filter window and no `filtersUpdated`
  - `toCoinFlip` sends `source: 'room'` for a room and `source: 'coin'` for a queue pairing. In a room, `winner` is the creator: `you` to the creator, `opponent` to the joiner
  - **the joiner names first:** `firstSeat(winner)` already gives the turn to the flip's loser, seat 1 (D3)
  - an empty pool after the join uses the existing `error` event (`empty_pool`, "No match fits the winning filters.") to both, and the room closes
  - everything from `matchReady` on is unchanged: turns, reveals, lives, reconnect window, forfeit, `finished`, persistence (B41)
- **Gateway**, `src/duel/duel.gateway.ts`:
  - three handlers, each validated with its schema and acked with `SUCCESS_ACK`
  - `handleDisconnect` and a takeover reach `PrivateRooms.drop` through `MatchmakingService.drop`, before the queue and the duel
- **Rate limits**, `SOCKET_LIMITS` in `src/common/rate-limits.ts` (D4):
  - `room:join`: 10 a minute per user
  - `room:create`: 10 a minute per user, like `queue:enter`
  - `room:leave`: the shared default
- **Messages**, a `ROOM_MESSAGES` set in `src/duel/duel-messages.ts`: hosting already, not hosting, no room for that code, your own room, and hosting a room (for `queue:enter`)
- **Unit tests:**
  - `room-code.spec.ts`: 6 characters of the alphabet; no `0 O 1 I L`; it skips a taken code; the alphabet holds 31 characters
  - `private-rooms.service.spec.ts`:
    - create sends `roomCreated` with the code, the parsed filters and `expiresAt` = now + 10 min
    - create refuses a queued player, a creator, and a player in a duel; an empty pool stores nothing
    - join pairs creator (seat 0) and joiner (seat 1); a lowercase code works; a wrong code is `not_found`; your own code is `forbidden`; a second join with the same code is `not_found`
    - leave frees the code (a join after it is `not_found`); leave when not hosting is `forbidden`
    - the timer sends `roomExpired` and frees the code; a joined room's timer never fires
    - the creator's drop closes the room, sending nothing
  - `duel-start.service.spec.ts`: a room start sends `paired`, then `coinFlip` (`source: room`, `winner` the creator, the room's filters), then `matchReady` after the reveal, with no `filtersUpdated`; the joiner has the first turn; a queue pairing still sends `source: coin`
  - `matchmaking.service.spec.ts`: `queue:enter` refuses a creator
  - `rate-limits.spec.ts`: the two new limits
  - `duel-views.spec.ts`: `toCoinFlip` maps `origin` to `source` and `winner` per receiver
- **E2E**, on `dev`:
  - the B43 `DuelHarness` gains `createRoom` and `joinRoom`
  - a whole room game from create to `finished`, with `coinFlip.source` = `room` and the joiner naming first
  - a creator who leaves while waiting: the code is then `not_found`
  - a creator whose socket closes while waiting: the same
  - a burst of `room:join` gets `rate_limited` + `retryAfterMs`, in the socket rate-limit suite
  - a room game is persisted like any duel (B41), with W/L/D in stats
- **Docs:**
  - `context/api-contract.md` § 5: the three commands, the two events, `RoomState`, `RoomExpiry`, `CoinFlipResult.source`, the rules (code alphabet, one room a creator, 10-minute wait, the creator's drop, join errors, the joiner names first)
  - `context/project-overview.md`: the six edits from `lineup-web/context/features/private-rooms-a-mock.md` § Shared spec, word for word, so the file stays identical in both repos (applied with this spec, 2026-11-08)

## Your part

1. **At `/feature load`:** confirm the proposed decisions D1–D3, or change them (done 2026-11-08)
2. **At `/feature test`:** point `.env` at `dev` for the e2e run. You edit `.env` yourself
3. **At `/feature complete`:** approve the commit, the merge into `main` and the push

## Decisions

Decided 2026-11-08, before load:

- **R6 is split into R6a (rooms, this spec) and R6b (room history: the migration and `isPrivate`).** R6a needs no migration. Until R6b, a room game is saved and counted like any duel, so the web can wire rooms before the "vs friend" tag
- **D4. `room:join` is limited to 10 a minute per user**, and `room:create` to 10 a minute, like `queue:enter`. With about 887 million codes and a handful open at once, guessing is hopeless at that rate. A typo or two never hits it

Approved at `/feature load` (2026-11-08), all three as proposed:

- **D1. Codes are drawn with `crypto.randomInt` and redrawn on a clash with an open room.** At a few open rooms in 887 million, a clash is almost never drawn, but the loop makes uniqueness certain rather than likely
  - alternative: the injectable `RANDOM`. Faster to test, but it isn't a secure source, so codes could be predicted
- **D2. A join after the room is full is `not_found`**, the same as a wrong or expired code. On a join the room leaves the open set at once, so "full" never needs its own state, and a stranger learns nothing about which codes were ever real
  - alternative: `forbidden` for a full room, which needs a closed-room record and tells a guesser the code existed
- **D3. The joiner names first.** In a duel the flip's loser names first, and the room's flip is fixed with the creator as winner, so `firstSeat` gives the first turn to the joiner with no new rule. It matches R6's suggestion
  - alternative: the creator names first, which needs a special case in `firstSeat`

## Notes

- **Why:** players want to duel a friend, not only a stranger. One player creates a room and shares a code; the friend joins with it; the game is today's duel. Asked in `lineup-web/context/docs/backend-requests.md` § R6 (2026-11-08); web specs `context/features/private-rooms-a-mock.md` and `private-rooms-b-wiring.md`
- **Numbering:** web request R6. R6a is the rooms; R6b (`r6b-room-history.md`) is the persistence. Not `todo.md` phases. Don't edit `todo.md`
- **Decided by the user in R6 (2026-11-08):** anyone can create and join, guests included (Pro gating later, not enforced); the creator's filters are used, with no filter window and no coin flip; the game starts at once on join; 6-character codes; 10 minutes of waiting; room games count in stats; rematch is a later request
- **In a room, `coinFlip` is a reveal, not a flip.** The event is reused so the web's start sequence stays one path; `source: 'room'` tells it to name the creator's filters instead of a toss
- **HC 2 holds:** no squad leaves the server; a room only changes how two players meet
- **HC 15 holds:** the rules are identical in a room
- **HC 19:** the edited constraint now covers rooms: the creator's set is applied whole, and both are told
- **Additive contract change:**
  - three commands, two events, one field on `CoinFlipResult`
  - a web build from before R6 never sends a room command and ignores `source`, so no `PROTOCOL_VERSION` bump
  - no migration in R6a
- **Not here:** the `is_private` flag and `HistoryEntry.isPrivate` (R6b); rematch; Pro gating; previewing a room before joining; mobile
- Constraints:
  - `src/game/` stays pure; `firstSeat` and `flipFilters` are unchanged
  - comments single-line, at most 50 characters
  - `@/` imports
  - types from `z.infer`
  - never log a code with a user id beside it, nor a squad
  - never touch `production`
  - **never run the e2e suites while `.env` points at `ingest`**
- Verification:
  - `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`
  - `npm run test:e2e` on `dev`, including the harness room games
  - `/docs/openapi.json`: `RoomState`, `RoomExpiry`, `RoomJoinRequest` and `CoinFlipResult.source` listed; the `x-socket` catalogue shows the three commands with their refusals and the two events
  - `diff` of `context/project-overview.md` against the web's copy is empty once the web's Private Rooms A has landed
- Afterwards, in the web: mark R6 rooms done in `backend-requests.md`, with the join limit (10 a minute), who names first (the joiner), the full-room answer (`not_found`) and any name changes; Private Rooms B transcribes the commands, events and `CoinFlipResult.source`

**Deviations recorded during implementation**

- `ROOM_CODE_ALPHABET`, `ROOM_CODE_LENGTH` and `ROOM_WAIT_MS` live in `src/contract/constants.ts`, not `room-code.ts`: `roomCodeSchema` needs them, and the contract can't import from `src/duel/`. `room-code.ts` holds `newRoomCode` and `SECURE_PICK`; the `ROOM_WAIT` and `ROOM_CODE_PICK` tokens sit in `private-rooms.service.ts`
- `MatchmakingQueue` became a shared provider. `PrivateRoomsService` reads it to refuse a queued player, and `MatchmakingService` asks `PrivateRoomsService.isHosting`, so the exclusion needs no circular dependency. `MatchmakingService` gains the queue and `PrivateRoomsService` as its first two constructor arguments
- `join` checks the caller's own state before it looks up the code: a creator, a queued player or one in a duel gets `forbidden` whatever code they send
- `PrivateRoomsService` sends `paired` itself, as `MatchmakingService` does for the queue; `DuelStartService.openFlipped` starts at `coinFlip`. Its unit tests begin there too
- `PrivateRoomsService.drop` returns whether a room closed; `leave` reuses it, and `MatchmakingService.drop` stops there when it's true
- The three harness room games sit in `test/duel/duel-harness.e2e-spec.ts`, beside the four whole games, to share its checks (mirrored views, no leak, history). The `room:join` burst sits in `socket-rate-limit.e2e-spec.ts`
- Existing tests updated for the additive contract: the event lists (`duel.spec.ts`, `socket.spec.ts`, and the `x-socket` counts in `test/contract.e2e-spec.ts`, now 8 commands and 17 events), the exact `coinFlip` payloads in `duel-start.service.spec.ts` and `test/duel/duel-start.e2e-spec.ts` (`source: 'coin'`), and `origin` in the `DuelRooms` and view fixtures
- Added at `/feature review` (2026-11-08): `create` takes the command's socket id and, after the pool check, stores the room only if that socket is still the user's current one (`ConnectionRegistry`). A socket that closed or was taken over during the check left a ghost room: open for 10 minutes, and a friend who joined would face an absent creator. Two unit tests cover both cases, and both fail without the fix. `PrivateRoomsService` gains `ConnectionRegistry` as its first constructor argument
- Added at `/feature review` (2026-11-08): the harness room game checks `/profile` stats for both players (played 1, draws 1), as the goal's "W/L/D in stats" asks
- Added at `/feature test` (2026-11-08): a shutdown case in `private-rooms.service.spec.ts`, the one uncovered function (`onModuleDestroy` stops every waiting room's timer)

**Test results (2026-11-08)**

- `npm test` 1274 passed (+44 from R6a); lint, build and `npx tsc --noEmit` clean
- Coverage of the R6a code: 98.9% of lines; `PrivateRoomsService`, `room-code.ts`, `DuelRooms` and `toCoinFlip` fully covered. Uncovered: defensive branches only
- `npm run test:e2e` on `dev`: 461 passed (457 + 3 harness room games + the `room:join` burst). The room game is a draw from create to `finished`: `roomCreated → paired → coinFlip` for the creator, `paired → coinFlip` for the joiner, `source: room`, the joiner on turn, history saved, `played 1 / draws 1` in both players' stats, and the code `not_found` afterwards
- `/docs/openapi.json`: `RoomState` (`code, filters, expiresAt`), `RoomExpiry`, `RoomJoinRequest` (code pattern `^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$`) and `CoinFlipSource` (`coin, room`) listed; `CoinFlipResult.source` required; `x-socket` lists 8 commands and 17 events, the three room commands with their refusals
- `context/project-overview.md` is byte-identical to the web's working copy, which holds Private Rooms A's edits

## History
