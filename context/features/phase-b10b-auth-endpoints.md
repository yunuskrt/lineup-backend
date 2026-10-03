# Phase B10b — Auth Endpoints

## Status

Complete

## Goals

- `src/auth/auth.controller.ts`: the contract's auth calls 1, 2, 3 and 6 (`api-contract.md` §4). Each route:
  - validates with the `src/contract/auth.ts` schemas
  - calls Better Auth's server API (`auth.api.*`) with the request headers
  - copies Better Auth's `Set-Cookie` headers onto the response
  - returns the enveloped contract shape via `@ContractResponse`

  | Route | Request | Response | Errors |
  | --- | --- | --- | --- |
  | `GET /auth/session` | — | `Session` or `null` | — |
  | `POST /auth/sign-up` | `SignUpRequest` | `Session` | `invalid_input`: bad form, handle taken, email in use |
  | `POST /auth/sign-in` | `SignInRequest` | `Session` | `invalid_input`: bad form; `unauthorized`: wrong credentials |
  | `POST /auth/sign-out` | — | empty | none; signing out with no session still succeeds |

- `src/auth/auth.service.ts`:
  - checks a handle is free before sign-up
  - maps Better Auth's errors to `ApiException`, each with a fixed, player-safe message. Better Auth's own text, codes and stack never reach a client.
  - turns Better Auth's user into the contract `User`: `id`, `handle`, `isGuest: false` (B11 makes it real), `tier: 'free'` (server-resolved, no monetization yet)
- `src/contract/auth.ts`: a registered `SessionOrNull` schema, so `@ContractResponse` can document `GET /auth/session`
- Native `/api/auth/sign-up/email` and `/api/auth/sign-in/email` switched off via Better Auth's `disabledPaths` (Open Questions 1). The server API (`auth.api.*`) still reaches them.
- Tests:
  - `src/auth/auth.service.spec.ts` (unit): error mapping, `toContractUser`, the handle pre-check
  - `test/auth/auth.e2e-spec.ts`, over HTTP:
    - sign-up returns a `Session` and sets the cookie, and `GET /auth/session` with that cookie returns the same user
    - sign-out clears it, after which `GET /auth/session` returns `null`
    - sign-in with the right password succeeds; a wrong password gives `unauthorized`
    - a taken handle (any case) and a used email both give `invalid_input`
    - a bad body gives `invalid_input`, which proves JSON parsing works on a Nest route
    - the native `/api/auth/sign-up/email` route is refused
    - `/docs/openapi.json` lists all four routes

## Open Questions

Both settled at `/feature load`, as recommended.

1. **Wrap Better Auth in contract endpoints, or let clients call its native routes?** **Decided: wrap, with the native email routes off.**
   - The web's `ApiClient` already expects the envelope and the contract `User` (`handle`, `isGuest`, `tier`), which Better Auth's raw responses don't have.
   - The backend owns the contract and documents it in OpenAPI. Native routes appear in neither.
   - Mobile later calls the same four routes with a bearer token (B13).

   No client calls a native route, since social sign-in isn't supported. Switching off the native email routes leaves one sign-in surface: it can't skip the handle rules, and it's the one place B35 has to rate limit.
2. **Should sign-up reveal that an email is already registered?** That allows checking whether an address has an account. **Decided: yes,** as `invalid_input` "That email is already registered." The contract's sign-up errors leave no other way to tell the player, and B35's limits make bulk probing slow. The alternative needs email verification (B11), to answer "check your inbox" either way.

## Out of Scope

- `POST /auth/guest` and `POST /auth/upgrade`: B11.
- Guards and `@CurrentUser`: B12. These routes read the session directly.
- Credentialed CORS and cookie domain: B13. Until then, test with an HTTP client, not the browser app.
- Social sign-in (Google, Apple). It isn't supported (`project-overview.md` § F).
- Password reset: needs email sending (B11).

## Notes

- Scope: the four contract auth calls over the B10a instance. No schema change.
- Depends on: B10a.
- **From B10a:**
  - `handleSchema` is exported from `src/contract/auth.ts` and already carries the character rule. Better Auth validates the handle with the same schema.
  - Sign-up must pass `name` (Better Auth requires it); set it to the handle.
  - A case-only duplicate handle reaches Better Auth as a database unique violation, so the pre-check is what turns it into `invalid_input`.
  - `auth.api.*` is reached through `AuthService` from `@thallesp/nestjs-better-auth` (`.api`, `.instance`).
  - Check that `disabledPaths` only blocks the HTTP routes, so the server API can still call sign-up and sign-in.
- **Password policy.** The contract checks only length (8–128). The backend keeps that as its policy, enforced both in the Zod schemas and in Better Auth's config. A stronger policy would be a contract change for the web.
- **Messages are fixed strings:**
  - "Email or password is incorrect." covers both an unknown email and a wrong password.
  - "That handle is taken." and "That email is already registered."

  No echo of the email or handle.
- **Cookies:** the response carries exactly the `Set-Cookie` headers Better Auth issued. Their name, `HttpOnly`, `SameSite` and `Secure` come from its defaults until B13 sets the cross-site scope.
- **`isGuest` and `tier` are always server-resolved**, never read from the request (Hard Constraint 16).
- Constraints:
  - controllers stay thin: validate, call one service method, return
  - no `any`; `@/` imports; comments single-line, at most 50 characters
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`
  - By hand with an HTTP client on `npm run start:dev`: sign up, read the session, sign out, sign in
  - The e2e users use `test-…@lineup.test` emails and are deleted afterwards

**Deviations recorded during implementation**

- **The service is `src/auth/auth-flow.service.ts` (`AuthFlowService`),** not `auth.service.ts`. The wrapper already exports an `AuthService`, which this class injects, and two classes with the same name in one module would be confusing. Its unit spec follows the name.
- **Error mapping (`fromBetterAuth`)** returns an `ApiException`, and passes any non-Better Auth error through to the envelope filter (`server_error`):

  | Better Auth | Contract |
  | --- | --- |
  | `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, `USER_ALREADY_EXISTS` | `invalid_input`, "That email is already registered." |
  | `INVALID_EMAIL_OR_PASSWORD` | `unauthorized`, "Email or password is incorrect." |
  | any other 400 | `invalid_input`, "The request was not valid." |
  | anything else | `server_error`; only the code is logged |
- **Handle check:** raw SQL `lower(handle) = lower($1)`, which uses B10a's index. Prisma's `mode: 'insensitive'` compiles to `ILIKE`, where `_` is a wildcard, so it was avoided.
  - If sign-up fails, the handle is checked again, so one lost to a parallel sign-up still reports "That handle is taken."
- **`disabledPaths` applies only in Better Auth's HTTP router,** so `auth.api.*` still reaches sign-up and sign-in. Two other router-only protections don't apply to calls made through `auth.api.*` either, so `/auth/*` gets neither:
  - **Rate limiting:** Better Auth's built-in limiter. **B35 must throttle `/auth/sign-in` and `/auth/sign-up` itself.**
  - **Origin (CSRF) check.** **B13 must add an origin check for credentialed POSTs**, including sign-out.
- **urlencoded parsing is switched off again** (B10a had turned it on). No route takes form bodies, and a form post from another site could otherwise sign someone in. A form-encoded sign-in now gets `invalid_input`, and a test pins it.
- **Better Auth's logger is pinned to `warn`.** It's already the default, but Better Auth's info logs include emails, such as "Sign-up attempt for existing email". A wrong password logs `WARN … Invalid password`, without the email.
- **Emails are unique regardless of case:** Better Auth lowercases them. A test signs up `TEST-HTTP-dup@…` against an existing lowercase address.
- **OpenAPI:**
  - the routes sit under the `auth` tag
  - `@ApiBody` references `SignUpRequest` and `SignInRequest`
  - `SessionOrNull` is a new component
  - a test checks all four routes and the component
- **Sign-out** forwards Better Auth's cookie-clearing `Set-Cookie`. After that, the old cookie reads back as `null`.
- **The e2e files run in parallel, so each one owns its prefixes.** `better-auth.e2e-spec.ts` uses `test-core-` emails and `test-c-` handles; `auth.e2e-spec.ts` uses `test-http-` and `test-h-`. Each file deletes only its own users.
  - B10a's cookie test now gets its headers from `auth.api.signUpEmail({ returnHeaders: true })`, since the native route is off.
- **Tests:** 209 unit (15 new) and 203 e2e (17 new).
  - `auth-flow.service.spec.ts`, 14 cases:
    - `toContractUser`
    - every row of the error mapping, with no Better Auth text in the result and only the code logged
    - the handle checked before Better Auth is called, and the race case
    - session, sign-in and sign-out
  - `auth.factory.spec.ts`, 1 case: `disabledPaths` and the log level
  - `auth.e2e-spec.ts`, 17 cases over HTTP:
    - the full sign-up → session → sign-out → sign-in flow, with the HttpOnly cookie
    - `null` when there's no cookie, and sign-out with no session
    - one message for a wrong password and for an unknown email
    - a taken handle, including in another case, and a used email
    - 4 bad forms
    - no echo of the email or handle in an error
    - a form-encoded sign-in refused
    - both native email routes return 404
    - OpenAPI documents all four routes
- **Checked by hand** with curl against the built server, on `test-manual@lineup.test`: sign-up, session, sign-out (then `null`), a wrong password (`unauthorized`), sign-in and session all answered as the contract says, and the native `/api/auth/sign-in/email` returned 404. The test user was deleted afterwards, leaving 0 users in the dev branch.
- **Review fixes:**
  - **`GET /auth/session` now forwards Better Auth's cookies.** Once a session is more than a day old (`updateAge`), `getSession` extends it to another 7 days and issues a fresh `Set-Cookie`. Before the fix the call ran without `returnHeaders`, so the cookie was dropped. The database row was extended, but the browser cookie still expired on its original date, signing active players out. The route now forwards it, as it also does for the cookie-clearing header on an expired session.
  - **A session deleted mid-refresh reads as signed out.** `getSession` throws `UNAUTHORIZED` in that case; it's now returned as `null` instead of `server_error`.
  - `isHandleTaken` is private.
  - **New tests:** 2 unit cases (the refreshed cookie, a session deleted mid-refresh) and 2 e2e cases:
    - a session with 5 of 7 days left gets a `Max-Age=604800` cookie, and its row is extended
    - an expired session reads as `null`, the cookie is cleared, and the row is deleted
  - **Totals:** 210 unit and 205 e2e.
- **Added at `/feature test`:** 4 unit cases in `auth-flow.service.spec.ts`, for paths where a mistake would change what the player sees:
  - a sign-up refused for its email while the handle is still free still reports "That email is already registered.", so the second handle check doesn't hide it
  - a successful sign-in returns the issued cookie and passes the body through unchanged
  - a `getSession` failure other than 401 becomes `server_error`. It's never read as signed out, which would quietly log a player out.
  - an error with no Better Auth code logs the HTTP status instead

  **Coverage from unit tests:**
  - `auth-flow.service.ts`: 97.9% of lines, 95% of branches, 100% of functions. The one line left is sign-out's `catch`, which runs the same mapping the other cases already cover.
  - `contract/auth.ts`: 100%.

  The controller is thin and covered only by the e2e suite, per the standards. **Totals:** 214 unit and 205 e2e.
- **Observation left for later:** sign-out deletes a session row, and sign-in always inserts a new one. An expired row is deleted only when its cookie comes back. Rows whose cookie never returns, for example after a cleared browser, stay in `auth_sessions` unusable. A periodic sweep belongs with B44's housekeeping.

## History
