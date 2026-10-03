# Phase B10b — Auth Endpoints

## Status

Not Started

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

Settle these at `/feature load`.

1. **Wrap Better Auth in contract endpoints, or let clients call its native routes?** **Recommended: wrap.**
   - The web's `ApiClient` already expects the envelope and the contract `User` (`handle`, `isGuest`, `tier`), which Better Auth's raw responses don't have.
   - The backend owns the contract and documents it in OpenAPI. Native routes appear in neither.
   - Mobile later calls the same four routes with a bearer token (B13).

   No client calls a native route, since social sign-in isn't supported. Switching off the native email routes leaves one sign-in surface: it can't skip the handle rules, and it's the one place B35 has to rate limit.
2. **Should sign-up reveal that an email is already registered?** That allows checking whether an address has an account. **Recommended: yes,** as `invalid_input` "That email is already registered." The contract's sign-up errors leave no other way to tell the player, and B35's limits make bulk probing slow. The alternative needs email verification (B11), to answer "check your inbox" either way.

## Out of Scope

- `POST /auth/guest` and `POST /auth/upgrade`: B11.
- Guards and `@CurrentUser`: B12. These routes read the session directly.
- Credentialed CORS and cookie domain: B13. Until then, test with an HTTP client, not the browser app.
- Social sign-in (Google, Apple). It isn't supported (`project-overview.md` § F).
- Password reset: needs email sending (B11).

## Notes

- Scope: the four contract auth calls over the B10a instance. No schema change.
- Depends on: B10a.
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

## History
