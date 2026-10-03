# Phase B11a — Guest & Upgrade

## Status

Complete

## Goals

- `prisma/schema.prisma` and one migration:
  - `User.isAnonymous` → `users.is_anonymous`, `boolean NOT NULL DEFAULT false`. This is the field Better Auth's anonymous plugin adds.
  - No change to `handle`: it stays `NOT NULL` and keeps both B10a constraints. Guests get a generated handle instead (next bullet).
- `src/auth/auth.factory.ts`:
  - the `anonymous` plugin from `better-auth/plugins`, with:
    - `disableDeleteAnonymousUser: true` (Open Questions 2)
    - `emailDomainName: 'guest.lineup.invalid'`. The `.invalid` TLD can never receive mail, which B11b relies on.
    - `generateName` returning the same value as the generated handle
  - `databaseHooks.user.create.before`: when `isAnonymous` is true, fills `handle` with `guest-` plus 8 random lowercase base-36 characters. That fits `handleSchema` and `users_handle_check`.
  - `/sign-in/anonymous` and `/delete-anonymous-user` added to `disabledPaths`. Clients use `/auth/guest`, and deleting a guest is never a client action.
  - `session.expiresIn` per Open Questions 4
- `src/auth/auth-flow.service.ts`:
  - `toContractUser` reads `isGuest` from `isAnonymous`, never from the request
  - `continueAsGuest(headers)`, per the table below
  - `upgradeGuest(request, headers)`: upgrades in place, so the user id stays the same (Open Questions 1). Steps:
    1. reads the session. No session → `unauthorized`; a registered user → `forbidden`.
    2. checks that the handle and the email are free
    3. in one transaction:
       - locks the `users` row and checks again that it's still a guest
       - sets `email` (lowercased), `handle`, `name` (= handle), `is_anonymous = false` and `email_verified = false`
       - inserts the `credential` row in `auth_accounts`, with the password hashed by Better Auth's own hasher (`auth.$context` → `password.hash`)
    4. after commit, issues a fresh session through `auth.api.signInEmail` and deletes the guest's old sessions, so the guest token can't be reused after the upgrade
- `src/auth/auth.controller.ts`: contract calls 4 and 5 (`api-contract.md` §4):

  | Route | Request | Response | Errors |
  | --- | --- | --- | --- |
  | `POST /auth/guest` | — | `Session` (`isGuest: true`) | `forbidden`: signed in with an account (Open Questions 3) |
  | `POST /auth/upgrade` | `UpgradeGuestRequest` | `Session`: same `id`, `isGuest: false` | `invalid_input`: bad form, handle taken, email in use; `unauthorized`: no session; `forbidden`: already registered |

  - `POST /auth/guest` called by someone who already has a guest session returns that session. It doesn't create a second guest.
- Tests:
  - `src/auth/auth-flow.service.spec.ts` (unit):
    - `isGuest` mapping
    - the guest handle generator matches `handleSchema`
    - each upgrade refusal, in the order above
    - the second guest check inside the transaction
  - `test/auth/guest.e2e-spec.ts`, over HTTP:
    - `POST /auth/guest` sets the cookie, and `GET /auth/session` returns `isGuest: true` with a `guest-…` handle
    - a second `POST /auth/guest` with that cookie returns the same user
    - upgrade returns the same id with `isGuest: false`, and sign-in with the new email and password then works
    - **history survives:** a `game_participants` row and a `user_stats` row for the guest are still attached to the same user after the upgrade
    - after the upgrade the old guest cookie reads as `null`
    - upgrade refusals: no cookie, a registered user, a taken handle in any case, a used email, a bad body
    - `POST /auth/guest` while signed in with an account gives `forbidden`
    - a guest signing in to an existing account gets that account's session, and the guest row is still there
    - the native `/api/auth/sign-in/anonymous` and `/api/auth/delete-anonymous-user` return 404
    - `/docs/openapi.json` lists both new routes

## Open Questions

All four settled at `/feature load`, each as recommended.

1. **Upgrade in place, or use the plugin's linking?** The plugin "links" by creating a new user on sign-up, calling `onLinkAccount`, then deleting the guest. The contract says the upgraded session keeps the **same user id**, and the web mock does exactly that. **Recommended: in place.**
   - Same id, as the contract says
   - No rows to move, so B10a's `ON DELETE RESTRICT` safety net is never tested by a normal upgrade
   - One account system and one migration path (`project-overview.md` § F)

   That means `/auth/upgrade` must not call `signUpEmail`: with a guest cookie on the request, the plugin would create a new user. It writes the rows itself, then signs in as normal.
2. **A guest signs in to, or signs up for, a different account.** The plugin's after-hook runs on every `/sign-in*` and `/sign-up*` call, including `auth.api.*`, and tries to delete the guest. A guest with history fails on `RESTRICT`, which Better Auth logs at ERROR and swallows. **Recommended:**
   - `disableDeleteAnonymousUser: true`. The guest row is left as it is, never merged and never deleted.
   - No history exists before B33, so nothing is lost today. B34 decides whether to merge a guest's history into an account the player signs in to.
   - A sweep of guests with no history belongs with B44's housekeeping.
3. **`POST /auth/guest` while signed in.** The contract lists no errors for it. **Recommended:**
   - Already a guest: return the current session (idempotent). A double tap shouldn't create a second identity.
   - Signed in with an account: `forbidden`, "Sign out first." Quietly replacing an account session with a guest one would look like a sign-out.
4. **Session lifetime.** A guest exists only through its cookie. Better Auth's default is 7 days, extended on use. A guest who doesn't play for a week loses the identity and its history for good. **Recommended: `session.expiresIn` of 30 days for everyone,** with `updateAge` left at 1 day. Mobile's bearer token (B13) inherits the same lifetime.

## Out of Scope

- Email verification and any mail sending: B11b.
- Merging a guest's history into a different, existing account: B34 (Open Questions 2).
- Guards and `@CurrentUser`: B12. These routes read the session directly, as in B10b.
- Credentialed CORS, the origin check on POSTs, the cookie domain and bearer tokens: B13.
- Rate limiting `/auth/guest` and `/auth/upgrade`: B35. Better Auth's limiter doesn't cover `auth.api.*` calls (B10b).
- `GET /profile` and its stats: B14.

## Notes

- Scope: continue as guest and guest → account upgrade, both behind the contract routes. No email.
- Depends on: B10a (Better Auth core), B10b (the controller, the error mapping and the handle pre-check).
- **From B10a/B10b:**
  - `users.handle` is `NOT NULL`. The plugin's `createUser` call bypasses Better Auth's input checks and sends no handle, so only the database hook keeps a guest insert from failing.
  - Reuse `assertHandleFree` and `fromBetterAuth`. Messages stay fixed: "That handle is taken.", "That email is already registered.". Add "Sign in or continue as a guest first." and "This account is already registered.", which are the mock's own wording.
  - `disabledPaths` only blocks the HTTP routes. Check that `auth.api.signInAnonymous` still works with it.
  - Better Auth lowercases emails on sign-up. The upgrade writes the email itself, so it must lowercase too.
- **A handle collision on guest creation** is a unique violation (36⁸ combinations). Retry once with a new handle before failing with `server_error`.
- **Placeholder emails** (`temp-…@guest.lineup.invalid`) never leave the server: the contract `User` has no email field.
- Constraints:
  - Hard Constraint 12: guest play needs no signup, and an upgrade never destroys history
  - `isGuest` and `tier` are resolved on the server (Hard Constraint 16). `tier` stays `'free'`.
  - Passwords are hashed by Better Auth, never stored or logged in plain text
  - controllers stay thin; no `any`; `@/` imports; comments single-line, at most 50 characters
  - never edit an applied migration
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`, `npm run db:status`
  - By hand with an HTTP client on `npm run start:dev`: continue as guest, read the session, upgrade, read the session again (same id), sign out, sign in with the new credentials
  - The e2e file owns its prefixes (`test-guest-` emails, `test-g-` handles). It deletes its own users, guests included.

**Deviations recorded during implementation**

- **One generated value, copied rather than generated twice.** `generateName` makes the handle, and `databaseHooks.user.create.before` copies the guest's `name` into `handle`. Name and handle can't drift, and the hook needs no generator of its own.
- **The generator lives in `src/auth/guest-handle.ts`,** not inside the factory, so the e2e suite can mock it to force a real collision.
- **Collision retry:** a handle collision reaches `continueAsGuest` as the raw database error, not a Better Auth `APIError`, because the plugin calls `createUser` with no `try/catch`. Nothing is logged. The service therefore retries once on any non-Better Auth error; a Better Auth refusal is mapped straight away, with no retry. A second failure goes to the envelope filter as `server_error`.
- **`asAuthUser`:** the plugin types its returned user as a loose record with no `handle`. The service checks `handle` and `isAnonymous` at runtime instead of casting. A missing handle throws, which becomes `server_error`.
- **Upgrade details:**
  - The session is read with `disableRefresh: true`, since a fresh session is issued anyway.
  - A failed transaction rechecks the handle and email only when the error isn't already an `ApiException`. That way "already registered" from the in-transaction check isn't reported as "handle taken".
  - All of the user's sessions except the new one are deleted. A guest only has its own device's.
  - Refusal order is session → guest → handle → email, as the spec says. The web mock checks the handle before the session; only the order in which two errors appear differs.
  - Confirmed: `signInEmail` with the old guest cookie doesn't trigger the plugin's linking, because the user is no longer anonymous by then.
- **B10b's renewal e2e test** now uses 25 of 30 days left and expects `Max-Age=2592000`, following Open Questions 4.
- **Tests:** 238 unit (24 new) and 222 e2e (17 new).
  - `guest-handle.spec.ts`, 3 cases: the contract rule, the shape, and variety
  - `auth.factory.spec.ts`, 4 new cases plus 1 updated: `disabledPaths`, the plugin settings, `generateName`, the hook (guests only), the 30-day lifetime
  - `auth-flow.service.spec.ts`, 17 new cases: the `isGuest` mapping, `asAuthUser`, every `continueAsGuest` path including the retry, and every upgrade path including the in-transaction check and the race
  - `test/auth/guest.e2e-spec.ts`, 17 cases over HTTP:
    - a guest with a generated handle, a placeholder email and no account row
    - the same guest on a second call
    - a real handle collision, retried
    - `forbidden` for someone signed in with an account
    - upgrade keeps the id, the `game_participants` row and the `user_stats` row, then sign-in works
    - the old guest cookie stops working
    - the email is stored lowercase
    - each refusal, with the guest still a guest afterwards
    - a guest signing in to an account leaves the guest row
    - both native routes return 404
    - OpenAPI documents both routes
  - The history test commits its own competition, season and match (`test-guest-history`) and deletes them afterwards, so it doesn't depend on seed data.
- **Checked by hand** with curl on `npm run start:dev`: guest → session → upgrade → session (same id) → sign-out → sign-in (same id), and a second upgrade refused with `forbidden`. The dev log showed no errors. The test user was deleted afterwards; the only remaining user is the account from `auth-setup.md` Step 3.
- **Review fixes:**
  - **A parallel-test race with the seed suite.** The guest history test commits a `test-guest-history` competition, season and match. `test/seed/seed.e2e-spec.ts` compared two unfiltered snapshots, and a before/after `match.count()`, inside one READ COMMITTED transaction, so a commit from the guest suite between the two reads could fail it now and then. Its snapshot and count now skip `test-` slugs, the same way it already filtered players. No seed slug starts with `test-`.
  - **Database hook:** returns only `{ handle }`. Better Auth merges a hook's `data` into the row, so spreading the user was redundant.
- **Observations left for later phases:**
  - **A registered player can pick a `guest-…` handle,** since `handleSchema` doesn't reserve the prefix. It's cosmetic (`isGuest` comes from the stored flag), and a collision with a generated handle is retried. Reserving the prefix would be a contract change for W28.
  - **A failure after the upgrade commits** (the fresh sign-in or the session sweep) returns `server_error`, but the account is already registered. The old cookie still reads the session, now as a registered user, and a retried upgrade gets `forbidden`. Nothing is lost.
  - **A guest whose session can't be created** after its user row is inserted is left as an orphan when the retry makes a second guest. Rare; B44's guest sweep covers it.
  - **A guest who signs up or signs in elsewhere** keeps a valid guest session row until it expires (OQ 2). The cookie is replaced, so nothing can reach it.

## History
