# R9 — Pro Tier & Switch

## Status

Complete

## Goals

- **The switch**, `src/config/env.schema.ts`: `PRO_ENABLED: z.stringbool().default(false)`. Unset means every user and guest is Pro, so a deploy mistake never locks anyone out
  - `.env.example` documents both values; your dev `.env` sets `PRO_ENABLED=true`
  - `test/vitest.e2e.setup.ts` sets `PRO_ENABLED=true`, as dev does; suites about the switch override it
- **Migration** (`npx prisma migrate dev --name user_tier`):
  - a `tier` Postgres enum (`free`, `pro`), and `users.tier tier NOT NULL DEFAULT 'free'`; every existing user and guest reads `free`
  - `User.tier` in `prisma/schema.prisma`: `Tier @default(free)`
  - applied to `dev` and `ingest` over the direct host; never `production`
- **Better Auth**, `src/auth/auth.factory.ts`: `tier` in the user `additionalFields`, `type: ['free', 'pro']`, `input: false`, `defaultValue: 'free'`. getSession then reads it with the user row on every request (no cookie cache), and `/api/auth/update-user` refuses to set it
- **The effective tier**, a pure `effectiveTier(stored, proEnabled)` in `src/auth/tier.ts`: `stored` when `proEnabled`, `'pro'` when not
- **Every `User` the API returns carries it**: `toContractUser(user, proEnabled)` in `src/auth/auth-flow.service.ts` replaces the hard-coded `'free'`
  - covers session, sign-in, sign-up, guest, upgrade and profile (all through `AuthFlowService`), and the socket handshake (`SocketAuthService`, which selects `tier` with its fresh user row)
  - a missing or unknown stored value reads as `free`: with the switch on, it fails closed
  - **read fresh per request**: `SessionGuard` resolves the session, so the user row, on every guarded request. Nothing caches it, and the gateway token carries `sub` only. The socket reads it at each gated command from R10 on
  - the solo summary's `missed` follows it with no change (`toSoloSummary(run, user.tier)`)
- **Upgrade keeps the tier**: the guest's `users` row is updated in place (B11), so `tier` carries over. Tested anyway
- **`GET /config`**, `src/config/config.controller.ts`:
  - `@Public()`, `catalog` rate limit, `Cache-Control: public, max-age=300`
  - response `AppConfig` = `{ proEnabled: boolean }`, in `src/contract/config.ts`, registered as a contract type
  - for showing Pro wording and locks only; it grants nothing
- **A reason on `forbidden`**, `src/contract/envelope.ts`:
  - `ApiError.reason`: optional `forbiddenReasonSchema` (`pro_required`, `daily_cap`), registered as `ForbiddenReason`
  - a refine: set only with `forbidden`, as `emptyBecause` is only with `empty_pool`
  - `ApiException` takes `reason` in its extras. REST envelopes and socket acks both carry it
  - nothing sends one yet: R10–R14 do
- **The dev script**, `npm run user:tier -- <email or handle> <free|pro>`:
  - `scripts/user-tier/main.ts` (entry) and `scripts/user-tier/user-tier.ts` (argument parsing and the update)
  - an argument with `@` is an email, lowercased; otherwise a handle, matched case-insensitively, as its unique index is. A guest is found by its `guest-…` handle
  - prints the handle and the tier before and after; refuses an unknown user, a bad tier or a missing argument with exit code 1
  - refuses `NODE_ENV=production`, as `db:seed` does
  - no HTTP route can change a tier
- **Unit tests:**
  - `effectiveTier`: both switch values × both stored tiers
  - `toContractUser`: stored `free` reads `pro` with the switch off and `free` with it on; a missing tier reads `free` with it on
  - `envSchema`: `PRO_ENABLED` defaults to `false`, parses `true` and `false`
  - `src/contract/envelope.spec.ts`: an error with `reason` parses; one without still does; a `reason` on a non-`forbidden` code fails
  - `AppConfig` and `ForbiddenReason` are in the registry
  - the script's argument parsing: email vs handle, bad tier, missing arguments
- **E2E**, on `dev`:
  - every session-returning call (session, sign-in, sign-up, guest, upgrade, profile) reports `pro` for a stored-`free` user with the switch off, and `free` with it on
  - a guest set to `pro` stays `pro` after upgrading, with the switch on
  - a tier set in the database applies on the next request, without signing in again
  - `/api/auth/update-user` with `tier: 'pro'` is refused and the tier stays `free`
  - `GET /config` with both values, with no session, with its `Cache-Control`
  - the script's update: by email, by guest handle, and an unknown user refused
  - the socket handshake's user carries the effective tier
- **Shared spec:** copy `../lineup-web/context/project-overview.md` over this repo's copy (the Free vs Pro table, the switch paragraph, the `/archive` and `/pro` routes)
- **Docs:**
  - `context/api-contract.md`: `ApiError.reason`, `User.tier` as resolved, `AppConfig` and `GET /config` (row 18)
  - OpenAPI: `AppConfig`, `ForbiddenReason`, `ApiError.reason`

## Your part

1. **At `/feature load`:** nothing new to decide unless you want to change something below
2. **At `/feature start`:** the migration runs on `dev` and `ingest` (as for R6b). `.env` points at `dev` for `migrate dev`; I apply it to `ingest` with `migrate deploy` over its direct host, without printing it. Add `PRO_ENABLED=true` to your `.env`
3. **At `/feature test`:** point `.env` at `dev` for the e2e run. You edit `.env` yourself
4. **At `/feature complete`:** approve the commit, the merge into `main` and the push

## Decisions

Decided 2026-11-12, before load:

- **The tier comes in through Better Auth**, as an `input: false` additional field. It is read with the session's user row, so it is fresh on every request at no extra query, and Better Auth's own routes can't set it
  - rejected: a separate Prisma lookup after each `getSession`, one more round-trip per guarded request
- **The script refuses `NODE_ENV=production`**, as `db:seed` does. Production tiers come from payments later; with `PRO_ENABLED=false` nobody there needs one
  - rejected: allowing it anywhere

## Notes

- **Why:** five Pro features are coming, all behind one switch. This builds the switch and the tier; R10–R14 each gate one feature on it. Asked in `lineup-web/context/docs/backend-requests.md` § R9 (2026-11-10); overview `lineup-web/context/docs/pro-features.md`; web spec `context/features/pro-a-switch.md`
- **Numbering:** web request R9. Not a `todo.md` phase. Don't edit `todo.md`
- **The backend alone decides** (HC 16). The client never asserts a tier; `GET /config` only tells it whether the split exists
- **Payments are out of scope.** The script is the only way to set a tier
- **Additive contract change:**
  - `User.tier` already exists and becomes real
  - `AppConfig` and `GET /config` are new; `reason` is optional
  - no `PROTOCOL_VERSION` bump
  - one migration
- **The scraper keeps its own copy of `schema.prisma`.** `users` isn't one of its tables, so nothing changes for it, but its copy goes one column behind until it next syncs
- Constraints:
  - migrations only through `prisma migrate`; never edit an applied one
  - comments single-line, at most 50 characters
  - `@/` imports
  - types from `z.infer`
  - never touch `production`
  - **never run the e2e suites while `.env` points at `ingest`**
- Verification:
  - `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`
  - `npm run test:e2e` on `dev`
  - `/docs/openapi.json`: `AppConfig`, `ForbiddenReason` and `ApiError.reason`
  - `npm run user:tier` on `dev` against a throwaway guest, then `GET /auth/session` shows the tier
- Afterwards, in the web: mark R9 done in `backend-requests.md` with the commit and the migration name; Pro A (`pro-a-switch.md`) reads `GET /config` and `User.tier`

**Deviations recorded during implementation**

- **`GET /config` sits in its own `AppConfigModule`** (`src/config/app-config.module.ts`), not in `ConfigModule`: the controller injects `ENV`, which `config.module.ts` defines, so registering it there would be an import cycle. The controller is `src/config/config.controller.ts`, as planned
- **Added `storedTier(value)`** beside `effectiveTier` in `src/auth/tier.ts`: it turns Better Auth's loosely typed field into a `Tier`, reading anything missing or unknown as `free`
- **The script loads `.env` itself** (`process.loadEnvFile`): `tsx` runs it, not Prisma, so nothing else would. A variable already set wins, so `NODE_ENV=production npm run user:tier …` is still refused. It prints `<handle>: <before> -> <after>`
- **Migration `20261111235103_user_tier`**: the generated `CREATE TYPE "tier"` and `ADD COLUMN "tier" NOT NULL DEFAULT 'free'`, nothing hand-written. Applied to `dev` (`migrate dev`) and to `ingest` (`migrate deploy`, its direct host from the Neon MCP, passed only as an environment variable). Both checked afterwards: recorded as finished, the column `NOT NULL DEFAULT 'free'`, no user other than `free`
- **E2E in one suite**, `test/auth/tier.e2e-spec.ts`, booting the app twice (switch on, switch off). The script's update is tested through `setUserTier` there; its argument parsing in `scripts/user-tier/user-tier.spec.ts`. The update-user refusal asserts Better Auth's `FIELD_NOT_ALLOWED`
- **Review (2026-11-12):** `setUserTier` reads the handle and the stored tier in its lookup, so the script runs one SELECT and one UPDATE. Three new comments shortened to 50 characters. Noted, not changed: Better Auth's own `GET /api/auth/get-session` returns the raw user row, so it shows the stored tier, not the effective one. No client calls it (the contract is `GET /auth/session`), it grants nothing, and it is the caller's own row

**Test results (2026-11-12)**

- `npm test` 1356 passed (88 files); lint, build and `npx tsc --noEmit` clean
- `npm run test:e2e` on `dev`: 481 passed (36 files), `test/auth/tier.e2e-spec.ts` (10) included
- The built server on `dev`, `PRO_ENABLED=true`: `GET /config` is `{ success: true, data: { proEnabled: true } }` with `Cache-Control: public, max-age=300` and no cookie. `/docs/openapi.json` has `AppConfig`, `ForbiddenReason`, `ApiError.reason` (a `$ref` to it) and the documented `Cache-Control` on `/config`
- `npm run user:tier` on `dev`, a throwaway guest:
  - its handle uppercased, `pro`: printed `guest-…: free -> pro`, exit 0; `GET /auth/session` and `GET /profile` then read `pro` on the same cookie
  - an unknown handle, the tier `gold`, a missing tier: each refused with exit 1
  - `NODE_ENV=production`: refused with exit 1, by the env check (the dev `.env` fails production's rules) before the script's own guard
  - set back to `free`, then deleted from `dev` with your OK (one row, by its guest handle); no orphaned sessions

## History
