# Phase B12b — Gateway JWT

## Status

Not Started

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
    - `/docs/openapi.json` documents `GET /auth/token` and the `GatewayToken` component

## Open Questions

Settle these at `/feature load`.

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

## History
