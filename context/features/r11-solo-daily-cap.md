# R11 — Solo Daily Cap

## Status

Complete

## Goals

- **The constant**, `src/contract/constants.ts`: `SOLO_DAILY_RUNS = 5`, applied only when the effective tier is `free`
- **The day**, pure helpers in `src/solo/daily-cap.ts`: `utcDayStart(now)` and `nextUtcMidnight(now)` (epoch ms), and the allowance from a tier and a count. The clock is the injected `CLOCK`
- **What counts** (`SoloService`, counted in memory, decided before load): the user's solo runs whose side was picked since the last UTC midnight, by the run's `firstRound.startedAt`, which is the side pick
  - saved: `game_sessions` rows, `mode = 'solo'`, the user's participant row, `started_at` since the day start
  - in memory: the store's runs with a side for that user, since the day start, saved or not
  - merged by run id (a saved run keeps its id as `game_sessions.id`), so nothing counts twice
  - an offer with no side never counts; a quit run does; duels never count; practice runs (R14) won't
- **`POST /solo/sessions`:** a Free user with 5 used is refused before anything else (no match is picked, and an open run is not ended): `forbidden`, `reason: 'daily_cap'`, `retryAfterMs` = milliseconds to the next UTC midnight, message "You've played your 5 solo runs today. Duels are unlimited."
- **`POST /solo/sessions/:id/side`:** checks again and counts in one step. The saved rows are read last, then the count, the cap check and the store's save run with no `await` between them, so on one instance two side picks can't both take the fifth run. Refused the same way
- **Never for Pro, never with `PRO_ENABLED=false`:** the tier is the session's `User.tier` (R9's effective tier, read with the session on every request)
- **The envelope**, `src/contract/envelope.ts`: `retryAfterMs` is set with `rate_limited`, or with `forbidden` + `reason: 'daily_cap'`, and `null` otherwise. R9 allowed it with `rate_limited` only
- **`GET /solo/allowance`** (session required, `default` rate limit), `src/solo/allowance.controller.ts`:
  - response `SoloAllowance` = `{ limit: number | null, used: number, resetsAt: epoch ms }`, in `src/contract/solo.ts`, registered as a contract type
  - `limit` is `5` for Free and `null` for Pro or with the switch off; `used` counts as above for every tier; `resetsAt` is the next UTC midnight
- **Unit tests:**
  - `daily-cap.ts`: the day start and next midnight around a midnight, the allowance for Free and Pro
  - `SoloService`: five side picks, then the sixth start is refused with `daily_cap` and the exact `retryAfterMs`; after UTC midnight (moved clock) a start works; Pro never refused; an offer with no side doesn't count, a quit run does; saved and in-memory copies of a run count once; two concurrent side picks at 4 used on two offers: exactly one succeeds; the refused start keeps the open run
  - `envelope.spec.ts`: `retryAfterMs` with `daily_cap` parses; `daily_cap` without it fails; `retryAfterMs` with `pro_required` fails
  - `SoloAllowance` is in the registry
- **E2E**, on `dev` (`test/solo/daily-cap.e2e-spec.ts`):
  - Free: five runs (start, side, quit), then the sixth start gets the refusal with its message, reason and `retryAfterMs`; the allowance reads `{ limit: 5, used: 5 }`
  - the clock moved past UTC midnight: the same user starts again
  - Pro (set in the database), and a stored-Free user with the switch off: a sixth run is not refused; the allowance has `limit: null`
  - an offer with no side pick doesn't count
  - two concurrent side picks at 4 used: exactly one succeeds
  - `GET /solo/allowance` with no session is `unauthorized`
- **Docs:** `context/api-contract.md`: `SoloAllowance` and `GET /solo/allowance` (row 19), the refusal on `findMatch` and `chooseSide`, and the `retryAfterMs` rule in § 2. OpenAPI: `SoloAllowance`

## Your part

1. **At `/feature load`:** nothing new to decide unless you want to change something below
2. **At `/feature test`:** `.env` points at `dev` for the e2e run. You edit `.env` yourself
3. **At `/feature complete`:** approve the commit, the merge into `main` and the push

## Decisions

Decided 2026-11-12, before load:

- **Counted in memory**, not written at side pick: `used` merges today's saved rows with today's runs in the store, by run id. B34's one-transaction save at the run's end is unchanged, and history and stats need no filter for active rows
  - trade-off: a run in play lost to a restart isn't counted, and B46 (Redis, several instances) must move the check-and-claim with the store
  - rejected: inserting the `game_sessions` row at side pick under a per-user lock, then updating it at the end

## Notes

- **Why:** Free plays 5 solo runs a day; Pro is unlimited. Duels are never capped (`monetization.md` § Rejected). Asked in `lineup-web/context/docs/backend-requests.md` § R11 (2026-11-10); web spec `context/features/pro-c-solo-cap.md`. Needs R9 (`fcf2079`)
- **Numbering:** web request R11. Not a `todo.md` phase. Don't edit `todo.md`
- **UTC for everyone:** the client never sends a time zone
- **The envelope change is a loosening** for clients: the web's `ApiError` has `retryAfterMs` nullable with no rule tying it to a code, so it already parses the refusal
- **No migration.** Additive contract change: one call, one type, `reason: 'daily_cap'` (R9). No `PROTOCOL_VERSION` bump
- Constraints:
  - comments single-line, at most 50 characters
  - `@/` imports
  - types from `z.infer`
  - never touch `production`
  - **never run the e2e suites while `.env` points at `ingest`**
- Verification:
  - `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`
  - `npm run test:e2e` on `dev`
  - `/docs/openapi.json`: `SoloAllowance` and `/solo/allowance`
- Afterwards, in the web: mark R11 done in `backend-requests.md` with the commit, the counting choice and the message; Pro C (`pro-c-solo-cap.md`) reads `GET /solo/allowance` and handles the refusal

**Deviations recorded during implementation**

- **`SoloAllowance.limit`** is a positive integer or `null`, not the literal `5`: the request types it `number | null`, and the value can change without a contract change
- **`GET /solo/allowance`** has its own `AllowanceController` (`@Controller('solo')`) in the solo module, beside `SoloController`'s `solo/sessions` base. `default` rate limit, as planned
- **The message is built from `SOLO_DAILY_RUNS`**, so it reads exactly "You've played your 5 solo runs today. Duels are unlimited."
- **The start's check costs Free one query** (today's saved run ids) before the match is picked. Pro skips it, in both the start and the side pick
- **The two-side-picks race, e2e:** over HTTP it runs on one offer, since a start replaces the user's open offer, and exactly one pick succeeds. The race across two offers at 4 used, where the cap itself decides, is a unit test (two offers put in the store, as two tabs would have)
- **Review (2026-11-12):** `start` reads the clock once for its check; `usedToday`'s comment says why it is synchronous. Checked, not changed: the count query uses `game_participants(user_id)`; `usedToday` scans the whole in-memory store, as `activeOf` already does, which B46 replaces

**Test results (2026-11-12)**

- `npm test` 1379 passed (90 files); lint, build, `npx tsc --noEmit` clean; Prettier clean but for `test/auth/session-guard.e2e-spec.ts`, already unformatted on `main`
- `npm run test:e2e` on `dev`: 491 passed (38 files), including `test/solo/daily-cap.e2e-spec.ts` (6). The existing solo suites still pass with `PRO_ENABLED=true`: none plays more than 5 runs on one guest
- After the review fix, `/feature test`: `npm test` 1379 and `npm run test:e2e` on `dev` 491 again; lint, build and `npx tsc --noEmit` clean. The built server on `dev`: `/docs/openapi.json` has `SoloAllowance` (`limit` a nullable positive integer, `used`, `resetsAt`) and `GET /solo/allowance` answering with it; with no session the route is `401`. No new unit tests: the day helpers (8 cases) and the cap in `SoloService` (8 cases) were already covered

## History
