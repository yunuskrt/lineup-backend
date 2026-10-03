# Phase B10a — Better Auth Core

## Status

Complete

## Goals

- Dependencies, pinned exactly (Open Questions 3):
  - `better-auth`
  - `@thallesp/nestjs-better-auth`, whose peer range covers NestJS 12 and TypeScript 6
- `src/config/env.schema.ts`, each new key also added to `.env.example`:
  - `BETTER_AUTH_SECRET`: required, at least 32 characters
  - `BETTER_AUTH_URL`: required, the backend's own base URL (`http://localhost:8080` in dev)
  - Setup steps: `context/docs/auth-setup.md`
- `prisma/schema.prisma`: Better Auth's four models, hand-written to the house conventions:
  - `User` → `users`, `Session` → `auth_sessions`, `Account` → `auth_accounts`, `Verification` → `auth_verifications`
  - snake_case columns via `@map`, `created_at` and `updated_at` like every other table
  - `users.handle`: a required column with a case-insensitive unique index on `lower(handle)` (Open Questions 2)
  - `auth_sessions` and `auth_accounts` cascade on user delete, as in Better Auth's own schema. Email/password credentials live in `auth_accounts` too.
  - id type per Open Questions 1
- One migration that:
  - creates the four tables
  - adds the foreign keys B08 left open:
    - `game_participants.user_id` → `users.id`, `ON DELETE RESTRICT`
    - `user_stats.user_id` → `users.id`, `ON DELETE CASCADE`
  - changes both `user_id` columns' type to match `users.id` (both tables are empty)
- `src/auth/auth.factory.ts`: `createAuth(prisma, env)` returns the Better Auth instance, with:
  - `prismaAdapter` over the injected `PrismaService`
  - `emailAndPassword` enabled, password length 8–128 taken from `src/contract/constants.ts`, no email verification yet (B11)
  - no social providers
  - `user.additionalFields.handle`, required on sign-up
  - `advanced.cookiePrefix: 'lineup'`
- `src/auth/auth.module.ts`: wraps `AuthModule.forRootAsync` from `@thallesp/nestjs-better-auth`. It:
  - injects `PrismaService` and `ENV`
  - turns the package's global `AuthGuard` off, since B12 owns guards
  - turns JSON and urlencoded parsing back on for non-auth routes, with a small JSON limit
- `src/app.module.ts` imports it. `bodyParser: false` stays in `main.ts`; the B01 comment is updated.
- Tests:
  - `src/config/parse-env.spec.ts`: both keys are required, and the secret must be at least 32 characters
  - `test/auth/better-auth.e2e-spec.ts`:
    - `auth.api.signUpEmail` writes a `users` row with a uuid id and a handle, plus a credential row in `auth_accounts`
    - a sign-up without a handle is refused
    - two users can't share a handle differing only in case
    - a `game_participants` row with an unknown `user_id` is rejected by the new foreign key
    - `POST /api/auth/sign-in/social` refuses any provider, since none is configured
    - a native `/api/auth/*` route answers normally, rather than being turned into `server_error` by the fail-closed interceptor

## Open Questions

All three settled at `/feature load`, each as recommended.

1. **What type is `users.id`?** By default Better Auth makes its own 32-character string ids. Every other table here uses `uuid(7)`. **Decided:**
   - `@db.Uuid @default(uuid(7))` on all four auth tables
   - Better Auth's `advanced.database.generateId: false`, so Prisma fills the id
   - `game_participants.user_id` and `user_stats.user_id` move from `text` to `uuid`

   The fallback, if the adapter insists on sending an id, is `generateId: 'uuid'` (v4) with the same column type.
2. **Where does `handle` live, and what may it contain?** The contract's `User` needs a unique `handle`. **Decided:**
   - Keep Better Auth's `name` as the display name, unconstrained. Sign-up fills it with the handle.
   - Add `handle` as a separate column with a case-insensitive unique index.
   - Allowed characters: letters, digits, `_`, `.` and `-`. That blocks look-alike and whitespace tricks. The web only checks length, so a refused handle reaches it as `invalid_input`.
3. **Exact pins?** Better Auth minor releases have changed its schema before, and the Nest wrapper's peer range is tied to Better Auth's major version. **Decided: exact pins,** as with Prisma, and upgrade on purpose.

## Out of Scope

- **Social sign-in (Google, Apple).** It isn't supported (`project-overview.md` § F): no provider env keys, no `socialProviders`. Sign-in methods are email + password and continue as guest.
- The contract endpoints `/auth/session`, `/auth/sign-in`, `/auth/sign-up` and `/auth/sign-out`: B10b.
- Continue as guest (the anonymous plugin), guest-to-account linking and email verification: B11.
- Route guards and JWT: B12.
- CORS, the parent-domain cookie, bearer tokens and the web's origin in `trustedOrigins`: B13.
- The Expo plugin: added when the mobile project starts.
- Rate limiting: Better Auth's built-in limiter stays at its defaults, and B35 decides on it.

## Notes

- Scope: Better Auth mounted under its native `/api/auth/*` routes, its tables, and the open foreign keys. No contract endpoint yet.
- Depends on: B02 (env), B03b (envelope and interceptor), B04 (`PrismaService`), B08 (the `user_id` columns).
- **Write the auth tables by hand.** Better Auth's CLI generator doesn't follow these conventions (snake_case, uuid ids, `@@map`). Run it once into a scratch file, to check that no required field is missing.
- **Fail-closed interceptor (from B03b):** check how the package mounts its routes. If Nest controllers handle them, they'll fail with `server_error` and need an explicit exemption. Record the mechanism found.
- **For B11:** `users.handle` is `NOT NULL`, and guests (the anonymous plugin) sign up without one. B11 must give each guest a generated handle that fits the handle rules.
- **`ON DELETE RESTRICT` on `game_participants`** protects history. Two consequences:
  - Deleting a user with game history fails until a later phase decides on anonymising.
  - B11's anonymous plugin deletes the guest user after linking. **B11 must move the guest's rows to the new user first**, or the link will fail on this key. That failure is the intended safety net for "upgrading never destroys history".
- Constraints:
  - `BETTER_AUTH_SECRET` is never logged.
  - Passwords are hashed by Better Auth (scrypt), never stored or logged in plain text.
  - No `any`; `@/` imports; comments single-line, at most 50 characters.
  - Never edit an applied migration.
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`, `npm run db:status`
  - The e2e auth users have `test-…@lineup.test` emails and are deleted after the suite
  - By hand: `GET /api/auth/ok` returns `{ "ok": true }` on `npm run start:dev`

**Deviations recorded during implementation**

- **How the wrapper mounts (the B03b check):** `@thallesp/nestjs-better-auth` 2.8.0 adds Better Auth with `httpAdapter.use(...)`, as plain Express middleware, not through Nest controllers.
  - The fail-closed interceptor and the envelope filter never see `/api/auth/*`, so no exemption was needed.
  - Every path under `/api/auth` answers in Better Auth's own JSON shape, not the envelope. Other unknown routes are still enveloped, and a test pins both.
- **`disableControllers` must stay unset.** In 2.8.0 it swaps in a module whose `configure()` does nothing, so Better Auth wouldn't be mounted at all.
- **The handle rule lives in the contract.** `handleSchema` in `src/contract/auth.ts`:
  - is now exported
  - gains the character pattern `^[A-Za-z0-9_.-]+$` on top of the trimmed 3–24 length
  - also serves as Better Auth's `validator.input` for the `handle` field, so the two can't drift

  This changes `SignUpRequest` and `UpgradeGuestRequest` in OpenAPI. **W28 must transcribe the pattern.**
- **Case-insensitive uniqueness is enforced in hand-written SQL,** like B06's CHECKs:
  - `users_handle_lower_key`, a unique index on `lower(handle)`
  - `users_handle_check`, with the same pattern and length

  A drift probe came back empty, so Prisma won't try to drop either. It was deleted unapplied.
- **`user_id` type change.** Postgres has no `text` → `uuid` cast Prisma would use, so the migration drops and re-adds both `user_id` columns, including `user_stats`' primary key. Both tables had 0 rows in the dev branch, which was checked first. No CHECK referenced either column.
- **Better Auth's field names stay its own** (`name`, `emailVerified`, `accountId`, `providerId`, …), mapped to snake_case columns. The model names are the defaults (`User`, `Session`, `Account`, `Verification`), so the Prisma adapter needs no `modelName` mapping.
  - Required fields were checked against Better Auth's `getAuthTables()` rather than its CLI, which would have meant downloading another package.
  - Indexes match Better Auth's: `user_id` on sessions and accounts, `identifier` on verifications.
- **Extra settings:**
  - `appName: 'Lineup'`
  - `telemetry: { enabled: false }`, set explicitly
  - body limit `16kb` for JSON and urlencoded on non-auth routes
  - the session cookie is `lineup.session_token`, HttpOnly
- **`.env.example` leaves `BETTER_AUTH_SECRET` empty on purpose.** A copied example then fails boot, instead of running on a placeholder secret.
- **B08's e2e suite now uses real users.** Its made-up `'test-user-a'` ids fail the new foreign key. A `buildUsers(tx, n)` fixture in `test/schema/schema-fixtures.ts` creates users with `test-…@lineup.test` emails inside the rolled-back transaction. The leftover check now counts that fixture's `test-user-` users (see Review fixes).
- **A case-only duplicate handle reaches Better Auth as a database unique violation.**
  - Better Auth logs `Failed to create user` with the constraint name and a stack trace, but no email, handle or password, and the call fails.
  - B10b checks the handle first and maps a taken one to `invalid_input`.
- **Log noise:** Better Auth logs `Provider not found` at ERROR level for any social sign-in attempt. It's harmless; note it for B44's log filtering.
- **Versions:** `better-auth` 1.7.7 and `@thallesp/nestjs-better-auth` 2.8.0, exact. They add no `npm audit` findings: the 4 production highs are still the Prisma CLI's.
- **Tests:** 194 unit (17 new: env keys, handle rules, the factory's settings) and 186 e2e (18 new in `test/auth/better-auth.e2e-spec.ts`):
  - sign-up writes a uuid v7 user with its handle and a hashed `credential` account
  - a missing handle, 4 malformed handles and a case-only duplicate are refused, with nothing written
  - `/api/auth/ok` and the `lineup.session_token` cookie
  - social sign-in is refused for `google` and `apple`
  - other unknown routes are still enveloped
  - the user foreign keys:
    - an unknown user is rejected
    - a user with history can't be deleted
    - stats, sessions and accounts are deleted with their user
  - both handle constraints, checked straight against the database
- Checked by hand: the built server boots, logs `AuthModule initialized BetterAuth on '/api/auth'`, answers `/api/auth/ok` with `{"ok":true}`, and still serves `/docs/openapi.json`.
- **Review fixes:**
  - **Atomic sign-up:** `prismaAdapter(..., { transaction: true })`. Better Auth wraps sign-up in a transaction, but the Prisma adapter defaults to `transaction: false`, so a failure between the `users` and `auth_accounts` writes could leave a user with no credential. That email couldn't sign up again.
  - **Test race:** Vitest runs e2e files in parallel. B08's "leaves no rows behind" counted every `test-` user, which could catch the auth suite's committed users mid-run. It now counts only the `test-user-` prefix that `buildUsers` uses.
  - **One more e2e case:** a padded handle is stored trimmed (Better Auth stores the validator's output) and the email is stored lowercase. The e2e total is now 186.
- **Added at `/feature test`:** `src/auth/auth.factory.spec.ts`, 5 unit cases with no database. They pin:
  - the 8–128 password policy, which no other test covered
  - no social providers
  - `generateId: false` and the `lineup` cookie prefix
  - the handle validator: it trims, and refuses a space
  - the secret and URL coming from `Env`

  **Coverage from unit tests:** 100% of `auth.factory.ts`, `env.schema.ts` and `contract/auth.ts`. `auth.module.ts` is wiring with no logic of its own; the e2e suite covers it, since every auth e2e case boots through it.
- **Observations left for later phases:**
  - Better Auth's `name` has no length limit. B10b sets it to the handle and switches off the native email routes, so no client sets it directly.
  - Session tokens are stored as-is in `auth_sessions.token`, Better Auth's default. Revisit with B12's JWT work.
  - Better Auth's built-in rate limiter runs only in production, in memory. B35 decides whether to keep it.

## History
