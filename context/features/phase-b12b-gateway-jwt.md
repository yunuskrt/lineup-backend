# Phase B12b — Gateway JWT

## Status

Complete

## Goals

- `prisma/schema.prisma` and one migration: the JWT plugin's key table, hand-written to the house conventions like B10a's:
  - `Jwks` → `auth_jwks`, `@db.Uuid @default(uuid(7))` id, snake_case columns (`public_key`, `private_key`, `created_at`, `expires_at`, `alg`, `crv`)
  - checked against the plugin's `schema.mjs`, so no required field is missing
- `src/auth/auth.factory.ts`: the `jwt` plugin from `better-auth/plugins`, with:
  - `jwt.definePayload` returning nothing beyond the claims the plugin adds itself: `sub` (the user id), `iat`, `exp`, `iss`, `aud` (Open Questions 3)
  - `jwt.expirationTime` per Open Questions 2
  - issuer and audience left at their default, `BETTER_AUTH_URL`
  - `disableSettingJwtHeader: true`. Otherwise every session read signs a JWT and sets a `set-auth-jwt` header no client uses.
  - private keys stay encrypted with `BETTER_AUTH_SECRET` (the plugin's default)
  - `/token` and the JWKS path added to `disabledPaths` (Open Questions 1 and 4)
- `src/contract/auth.ts`: `gatewayTokenSchema`, registered as `GatewayToken`: `token` (non-empty string) and `expiresAt` (epoch ms, server clock). An additive contract change: one new REST call.
- `src/auth/gateway-token.service.ts`: `GatewayTokenService`
  - `issue(headers)`: calls `auth.api.getToken` with the caller's headers, reads `exp` from the signed token, returns `GatewayToken`
  - `verify(token)`: calls the server-only `auth.api.verifyJWT`, returns `{ userId }` or `null`. Any failure is `null`, never a throw: B36 turns `null` into `unauthorized` on the handshake.
- `src/auth/auth.controller.ts`: contract call 16

  | Route | Request | Response | Errors |
  | --- | --- | --- | --- |
  | `GET /auth/token` | — | `GatewayToken` | `unauthorized`: no session (from B12a's guard) |

  - the first route **not** marked `@Public()`. It takes no user id from the request; the token is for whoever the session says.
  - guests get a token too: duels are open to guests (`project-overview.md` § F)
  - OpenAPI marks it as needing the session cookie (`@ApiCookieAuth`, with a cookie security scheme for `lineup.session_token` in `src/docs/setup-docs.ts`) and documents the 401 `unauthorized` envelope. Carried over from B12a's review: it's the first guarded route.
- Tests:
  - `src/auth/gateway-token.service.spec.ts` (unit, `auth.api` mocked): `issue` maps `exp` to `expiresAt` in ms; `verify` returns the subject, and `null` for a refused, malformed or throwing verification
  - `src/auth/auth.factory.spec.ts`: the plugin settings, the payload carrying no email or handle, the closed paths
  - `test/auth/gateway-token.e2e-spec.ts`, over HTTP:
    - a guest and a registered user each get a `GatewayToken`; `expiresAt` is about `expirationTime` from now
    - `verify` on that token returns the same user id `GET /auth/session` shows
    - the decoded payload holds `sub`, `iat`, `exp`, `iss`, `aud` and nothing else: no email, no handle
    - a tampered token, a token signed for another audience, and an expired token (signed with `auth.api.signJWT` and a past `exp`) all verify to `null`
    - no cookie → 401 `unauthorized`
    - the native `/api/auth/token` and JWKS routes return 404
    - after the first token, `auth_jwks` holds one key whose `private_key` isn't plain JWK JSON
    - `/docs/openapi.json` documents `GET /auth/token`, the `GatewayToken` component, the cookie security requirement and the 401

## Open Questions

All four settled at `/feature load`, each as recommended.

1. **A contract route, or Better Auth's native `/api/auth/token`?** **Recommended: a contract route, `GET /auth/token`, with the native one closed.** Same reasons as B10b: the envelope, the OpenAPI document, one surface to rate limit (B35), and `expiresAt` from the server clock so the client knows when to fetch another. The native route answers `{ token }` in Better Auth's own shape.
2. **How long does a token live?** It's used once, on the socket handshake; after that the connection is authenticated, and a reconnect fetches a fresh token. **Recommended: 5 minutes.** Short enough that a leaked token is nearly useless, long enough for a slow mobile handshake. The plugin's default is 15 minutes.
3. **What goes in the payload?** By default the plugin puts the whole user row in it, email included. A JWT is readable by anyone holding it. **Recommended: `sub` only** (plus the standard claims). The gateway loads the user from the database on connect, so `isGuest` and `tier` are always fresh and never trusted from the token (Hard Constraint 16).
4. **Is the JWKS route exposed?** The gateway verifies in-process with `auth.api.verifyJWT`, which reads keys straight from `auth_jwks`. **Recommended: closed.** Nothing outside the backend verifies these tokens. Reopen it if a separate service ever needs to (Hard Constraint 14 says there won't be one).

## Out of Scope

- The socket gateway and its handshake: B36. This phase only issues and verifies tokens.
- Key rotation (`jwks.rotationInterval`). One key, made on first use, is enough at MVP; revisit with B45.
- Bearer tokens for REST and the mobile flow: B13.
- Rate limiting `GET /auth/token`: B35.

## Notes

- Scope: issuing a short-lived JWT for the gateway and verifying it in-process. One new table and one new REST call.
- Depends on: B12a. `GET /auth/token` is the first route that relies on the global guard.
- **Better Auth's exported `verifyJWT` only works inside an auth endpoint** (it reads the endpoint context). Use the server-only `auth.api.verifyJWT` instead, which wraps it.
- **`disabledPaths` only blocks HTTP routes** (B10b), so `auth.api.getToken` still works with `/token` closed. Check it, as B10b did for sign-up.
- **`auth.api.getToken` needs the session headers** (`requireHeaders: true`). Pass the request headers through, as the other auth calls do.
- **Write the table by hand,** as B10a did; Better Auth's CLI ignores the house conventions. With `generateId: false`, Prisma fills the id.
- Constraints:
  - no token, key or payload in any log
  - the gateway never takes a user id from the client: only from a verified token's `sub` (CLAUDE.md)
  - never edit an applied migration
  - no `any`; `@/` imports; comments single-line, at most 50 characters
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`, `npm run db:status`
  - By hand with curl on `npm run start:dev`: continue as guest, `GET /auth/token` with the cookie, decode the token's payload (base64) and see only the standard claims; `GET /auth/token` with no cookie gives 401
  - The e2e file owns its prefixes (`test-jwt-` emails, `test-j-` handles) and deletes its own users

**Deviations recorded during implementation**

- **`GET /auth/token` lives on its own `GatewayTokenController`** (`src/auth/gateway-token.controller.ts`), with the same `auth` prefix. `AuthController` is `@Public()` at class level, so a route added there would have been public; a separate controller keeps deny by default with no per-method override.
- **No `jose` dependency.** `jose` is only a transitive dependency of Better Auth, so `issue` reads `exp` with `expiryOf(token)`, a base64url decode of the token's middle segment using Node's `Buffer`. It only reads a token Better Auth has just signed; the signature is checked by `verify`, through `auth.api.verifyJWT`.
- **OpenAPI pieces** (the B12a carry-over):
  - `failureDoc()` in `src/common/contract-response.ts` describes the failure envelope
  - `@DocumentsSession()` in `src/auth/session-docs.decorator.ts` adds `@ApiCookieAuth('session')` and the 401
  - `setupDocs` registers the `session` cookie scheme for `lineup.session_token`

  Docs only: the guard does the checking.
- **`auth_jwks` has `updated_at`,** beyond the plugin's own fields, as every table here does. Prisma fills it.
- **How the private key is stored:** as `JSON.stringify` of the ciphertext, a quoted string encrypted with `BETTER_AUTH_SECRET`, never a JWK object. The e2e case asserts exactly that. The algorithm is the plugin's default, EdDSA (Ed25519).
- **`AuthModule` exports `GatewayTokenService`,** so B36's gateway can verify handshake tokens.
- **`issue` maps failures through `fromBetterAuth`.** The guard already refuses a request with no session, so a refusal reaching `issue` is unexpected and becomes `server_error`.
- **Tests:** 305 unit (14 new) and 250 e2e (12 new).
  - `gateway-token.service.spec.ts`, 13 cases:
    - `expiryOf` on good, missing, wrongly typed and malformed claims
    - `issue` returns the token and its expiry, and maps a refusal
    - `verify` returns the subject, and `null` for a refused payload, a missing, empty or non-string subject, or a throw
  - `auth.factory.spec.ts`: the closed `/token` and `/jwks` paths, a 5-minute expiry, an empty extra payload, and the header switched off
  - `test/auth/gateway-token.e2e-spec.ts`, 12 cases:
    - a guest's 5-minute token verifies to its own id
    - the claims are exactly `aud`, `exp`, `iat`, `iss`, `sub`, with no email or handle
    - a registered user's token verifies to the session's id
    - tampered, wrong-audience, expired and non-JWT tokens all verify to `null`
    - no cookie gives the 401 envelope
    - the native `/api/auth/token` and `/api/auth/jwks` return 404
    - the signing key is stored encrypted
    - OpenAPI shows the route, the `session` cookie requirement, the 200 `GatewayToken` and the 401 `ApiError`
- **Checked by hand** on the built server: a guest got a token valid for 299 s; its claims were only the five standard ones, with `sub` the guest's id and `iss`/`aud` `http://localhost:8080`; no cookie gave 401; both native routes returned 404; `GET /auth/session` sent no `set-auth-jwt` header. No errors in the log, and the test guest was deleted.
  - It ran on port 8081, because the developer's server held 8080.
- A Prettier run reformatted `test/auth/session-guard.e2e-spec.ts` (line wrapping only), a file from B12a. It was reverted to keep this change focused.
- **Review fixes:**
  - **`GET /auth/token` now sends `Cache-Control: no-store`.** It returns a bearer credential in a plain GET with no caching instruction, so a browser or shared proxy could have kept it. Token responses should never be stored (OAuth 2.0 requires it for the same reason). The guest e2e case asserts the header.
  - **Totals:** 305 unit and 250 e2e, unchanged in count.
- **Added at `/feature test`:** 1 unit case. `expiryOf` on a token whose claims are JSON `null` throws the clean "no expiry" error, not a TypeError.

  **Coverage from unit tests:**
  - `gateway-token.service.ts`: 100% lines, statements and functions; 92.85% branches. The one missed branch is TypeScript's emitted constructor metadata on the `@Injectable()` line, as in B12a.
  - `auth.factory.ts` and `contract/auth.ts`: 100%.
  - `gateway-token.controller.ts`, `session-docs.decorator.ts` and `failureDoc()` are wiring and documentation, covered by the e2e suite: the token route cases, and the OpenAPI case that checks the 401's failure envelope.

  **Totals:** 306 unit and 250 e2e.
- **Observations left for later phases:**
  - **B36: a token outlives sign-out by up to 5 minutes.** The payload carries no session id, so verifying can't tell that the session behind it has ended, or that the user was deleted. On connect, B36 must load the user from the database and refuse a missing one. Accept the 5-minute window, or add a session claim and check it, if that window proves too long.
  - **B13: CORS is now load-bearing for this route.** A credentialed CORS policy that allowed any origin would let any site `fetch('/auth/token', { credentials: 'include' })` and read a player's gateway token. B13 must allow only the web origin.
  - **Key rotation** stays out of scope (B45). `verify` finds keys by `kid`, so rotation needs no code change here.

## History
