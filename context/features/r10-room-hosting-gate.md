# R10 — Room Hosting Gate

## Status

Complete

## Goals

- **A fresh tier read**, `TierService.effectiveTierOf(userId)` in `src/auth/tier.service.ts`, exported by `AuthModule`:
  - reads `users.tier` from the row at the call; never the handshake's `User`, the gateway token or a cache
  - applies R9's `effectiveTier`: with `PRO_ENABLED=false` it is `pro` without a query
  - a missing row reads `free` (R9's `storedTier`): it fails closed
- **The gate**, `PrivateRoomsService.create` (`src/duel/private-rooms.service.ts`):
  - a user whose effective tier is `free` gets `forbidden`, `reason: 'pro_required'`, message "Hosting a room needs Pro. Anyone can join one." (`ROOM_MESSAGES.proToHost`)
  - checked first in `create`, so right after the gateway's payload validation and before the hosting, queue and duel checks and the pool check
  - nothing is stored and nothing is sent on a refusal: no room, no code, no `roomCreated`
- **`room:join` is unchanged:** a Free player joins a Pro player's room, and the duel inside is identical for both (HC 15)
- **An open room stays open** if its host's tier drops while it waits: the tier is read only at `room:create`. It is joined, left or expires as usual
- **With `PRO_ENABLED=false`** everyone is Pro, so nothing changes for anyone
- **Unit tests:**
  - `src/auth/tier.service.spec.ts`: switch off reads `pro` with no query; switch on reads the stored tier by the user's id; a missing row reads `free`
  - `src/duel/private-rooms.service.spec.ts`: a Free `create` is refused with the reason and the message, stores nothing, sends nothing and never checks the pool; the tier is read first, even when the user is already hosting; a Pro `create` opens a room; a room whose host drops to Free is still joined
- **E2E**, on `dev`, the two-client harness (`test/duel/`):
  - the harness's room game: a Pro creator and a Free joiner play to `finished`
  - with the switch on, a Free `room:create` gets the refusal with its reason, and nothing is stored: the same code can't be joined, and the user can still enter the queue
  - with the switch on, a host dropped to Free in the database while the room waits: the room is still joined
  - with the switch off, a stored-`free` user opens a room
  - the harness's other room cases (leave, socket close) use a Pro creator
- **Docs:** `context/api-contract.md` § 5: `room:create`'s ack errors gain `forbidden` + `reason: 'pro_required'` (Free host); the private rooms notes say hosting needs Pro while the switch is on

## Your part

1. **At `/feature load`:** nothing to decide unless you want to change something below
2. **At `/feature test`:** `.env` points at `dev` for the e2e run. You edit `.env` yourself
3. **At `/feature complete`:** approve the commit, the merge into `main` and the push

## Notes

- **Why:** "Private lobbies: Free join only, Pro host + join" (`project-overview.md` § Free vs Pro). Asked in `lineup-web/context/docs/backend-requests.md` § R10 (2026-11-10); web spec `context/features/pro-b-room-hosting.md`. Needs R9 (`fcf2079`)
- **Numbering:** web request R10. Not a `todo.md` phase. Don't edit `todo.md`
- **Why a fresh read:** the socket's `User` is resolved once at the handshake, so its tier can be a whole session old. R9's script, and later a purchase, must apply at the next `room:create`
- **No contract shape change:** `reason` exists since R9. No migration, no `PROTOCOL_VERSION` bump
- **HC 15 holds:** only who may open a room changes. Joining, the coin flip (the creator's filters), the rounds and the result are the same for Free and Pro
- Constraints:
  - comments single-line, at most 50 characters
  - `@/` imports
  - never touch `production`
  - **never run the e2e suites while `.env` points at `ingest`**
- Verification:
  - `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`
  - `npm run test:e2e` on `dev`
- Afterwards, in the web: mark R10 done in `backend-requests.md` with the commit and the message; Pro B (`pro-b-room-hosting.md`) handles the refusal

**Deviations recorded during implementation**

- **The harness gained a tier**: `DuelHarness.client(tier = 'free')` and `setTier(client, tier)` write the stored tier. With `PRO_ENABLED=true` in the e2e setup (R9), the harness's existing room cases needed a Pro creator: `pairByRoom` is now a Pro creator and a Free joiner, and so are the leave and socket-close cases. The room game also checks both players' `/profile` tier (`pro`, `free`)
- **The gate's own e2e** is a new file, `test/duel/room-hosting.e2e-spec.ts`, booting the harness with the switch on and off. Added beyond the request's list: the tier is read at the command (Pro, then Free, on the same socket)
- **A Pro host who drops to Free while already hosting** gets `pro_required`, not `alreadyHosting`, on a second `room:create`: the tier is checked first, as the request asks
- **Review (2026-11-12):** the harness writes a tier only for a Pro client (a new guest is stored `free`), saving a query per client across the duel suites. The Free-refusal e2e checks "nothing is stored" by the queue opening to the user and no `roomCreated`; no code is issued, so there is none to try joining

**Test results (2026-11-12)**

- `npm test` 1363 passed (89 files); lint, build, `npx tsc --noEmit` and Prettier clean
- `npm run test:e2e` on `dev`: 485 passed (37 files), including `test/duel/room-hosting.e2e-spec.ts` (4) and the harness's room game, Pro creator and Free joiner, to `finished` (a draw)
- After the review fix, `/feature test`: the same counts again, `npm test` 1363 and `npm run test:e2e` on `dev` 485; lint, build and `npx tsc --noEmit` clean. No new unit tests: `TierService` (4 cases) and the gate in `PrivateRoomsService` (3 new cases) were already covered

## History
