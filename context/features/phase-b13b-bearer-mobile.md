# Phase B13b — Bearer Tokens for Mobile

## Status

Complete

## Goals

- `src/auth/auth.factory.ts`: Better Auth's `bearer` plugin, with `requireSignature: true`. Only the signed session token is accepted, never a bare session id.
- **Handing the token to mobile** (Open Questions 1). The plugin puts the session token in a `set-auth-token` response header on any call that sets the session cookie. Our routes forward only `Set-Cookie` today, so:
  - `src/auth/auth-flow.service.ts`: `WithCookies` gains `authToken: string | null`, read from Better Auth's `set-auth-token` header
  - `src/auth/auth.controller.ts`: sign-up, sign-in, guest and upgrade send it as `set-auth-token` whenever it's present
  - the session cookie is still set, so the web is unaffected
- **Reading the token:** every session read takes `Authorization: Bearer <token>` as well as the cookie, with no change to `SessionGuard` or `AuthFlowService.getSession`. The plugin turns the header into the session cookie before Better Auth reads it. Confirm that it reaches `auth.api.*` calls too.
- **OpenAPI:**
  - a `bearer` security scheme next to B12b's `session` cookie
  - `@DocumentsSession()` lists both, so a guarded route accepts either
  - the four routes document the `set-auth-token` response header
- `context/docs/auth-setup.md`: a **Bearer (mobile)** step. Sign in with curl, read `set-auth-token` from the response headers, and call `GET /auth/session` and `GET /auth/token` with `Authorization: Bearer`.
- Tests:
  - `src/auth/auth-flow.service.spec.ts`: `authToken` read from the headers, `null` when absent
  - `src/auth/auth.factory.spec.ts`: the plugin and `requireSignature`
  - `test/auth/bearer.e2e-spec.ts`, over HTTP with **no cookies at all**:
    - sign-up, sign-in and guest each return `set-auth-token`
    - `GET /auth/session` with `Authorization: Bearer` returns that user
    - `GET /auth/token` with the bearer token gets a gateway token for the same user, so mobile reaches the gateway
    - upgrading a guest by bearer keeps its id and returns a fresh `set-auth-token`; the old token stops working
    - sign-out by bearer ends the session, and the same token then reads as signed out
    - an unsigned token, a tampered token and a token for a deleted session all read as signed out; a guarded route gives 401
    - a bearer POST with no `Origin`, as mobile sends it, passes B13a's origin check; with an untrusted `Origin` it's refused like any other write
    - a request with both a cookie and a bearer token resolves to one user (Open Questions 2)

## Open Questions

Both settled at `/feature load`, each as recommended.

1. **How does mobile get its token: a header, or a field in the contract?** **Recommended: the `set-auth-token` header.**
   - It's Better Auth's own mechanism, and the one its Expo client reads.
   - The contract `Session` stays the same for every client: the backend doesn't branch on platform (`coding-standards.md` § Repository Boundaries).
   - The web never touches it, and since CORS doesn't expose it (B13a), browser scripts can't read it either.

   The alternative, a `token` field in `Session`, would put a bearer credential in every web response body, where page scripts can read it.
2. **A request carrying both a cookie and a bearer token.** **Recommended: the bearer token wins,** which is what the plugin does: it overwrites the cookie in the headers it hands on. Pin it with a test, so a change in a later Better Auth release shows up.

## Out of Scope

- The Expo plugin (`@better-auth/expo`) and the mobile app's secure storage: the mobile project.
- Refreshing a bearer token: a session's token stays the same when its expiry is extended (30 days, B11a), so mobile keeps using it until a 401.
- Rate limiting: B35.

## Notes

- Scope: mobile authenticates with `Authorization: Bearer`, gets its token from a response header, and reaches every guarded route and the gateway token the same way the web does with its cookie.
- Depends on: B13a. The origin check must already let requests with no `Origin` through (mobile sends none), and CORS must already list `Authorization`.
- **The token is the session token,** signed with `BETTER_AUTH_SECRET`, the same value as the cookie. Signing out deletes the session, so the token stops working immediately. That's unlike B12b's gateway JWT, which lives out its 5 minutes.
- **What the plugin does:** a before-hook copies the bearer token into the session-cookie slot of the request headers, and an after-hook sets `set-auth-token` whenever a session cookie is set. With `requireSignature: true`, a token without its signature is ignored.
- **Never log the token,** like the cookie. It sits in a response header and a request header, so check that nothing (B44's logging included) prints headers whole.
- Constraints:
  - no platform branching: one route, one contract, either credential
  - no `any`; `@/` imports; comments single-line, at most 50 characters
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`
  - By hand: the curl steps in the new docs section, using no cookie file at all
  - The e2e file owns its prefixes (`test-bearer-` emails, `test-b-` handles) and deletes its own users

**Deviations recorded during implementation**

- **The token is forwarded the same way on every `/auth` route.** `issued(headers)` in `auth-flow.service.ts` reads both `Set-Cookie` and `set-auth-token`, and the controller's `sendCookies` sets `set-auth-token` whenever one is present. In practice:
  - sign-up, sign-in, guest and upgrade always issue one
  - sign-out never does, since the cookie is being cleared (pinned)
  - `GET /auth/session` passes on the unchanged token when Better Auth refreshes the session

  The spec named only the four routes; one rule is simpler than four exceptions.
- **`ContractResponse` gained an optional `{ headers }`.** A second `@ApiOkResponse` would replace the first for the same status rather than merge, so the 200's `set-auth-token` header is documented through it.
- **OpenAPI:** a `bearer` scheme (`http`, `bearer`) sits next to `session`. `@DocumentsSession()` lists both, so `GET /auth/token`'s security is `[{ session: [] }, { bearer: [] }]`, meaning either one. B12b's OpenAPI e2e expectation was updated to match.
- **The token never reaches browser scripts.** Better Auth's after-hook also sets `Access-Control-Expose-Headers: set-auth-token` on its own response, but our routes copy only `set-auth-token`, and B13a's CORS exposes nothing. An e2e case pins a web-origin sign-in carrying the token with no expose header.
- **Prettier rewrapped `test/auth/session-guard.e2e-spec.ts` again** (B12a's file); reverted, as in B12b.
- **Docs:** `auth-setup.md` § Bearer (mobile), Step 12, captures the token with `awk`, since macOS `sed` has no case-insensitive flag. It also adds two troubleshooting rows (a token cut short or missing its `Bearer ` prefix; a mobile client that sends an `Origin`) and updates "At a glance" and "Later stages".
- **Tests:** 353 unit (4 new) and 275 e2e (14 new).
  - `auth-flow.service.spec.ts`: `issued` with and without a token; a sign-in forwarding its token; existing expectations gain `authToken: null`
  - `auth.factory.spec.ts`: the bearer plugin with `requireSignature: true`
  - `test/auth/bearer.e2e-spec.ts`, 14 cases with no cookies:
    - sign-up, sign-in and guest each issue a token, and the web cookie is still set
    - the token is never exposed to scripts
    - the session and a gateway token are read by bearer alone
    - an upgrade by bearer keeps the id with a fresh token, and kills the old one
    - sign-out kills the token and issues none
    - unsigned, tampered and deleted-session tokens read as signed out, and a guarded route gives 401
    - no `Origin` passes the origin check; an untrusted one is refused and the session survives
    - the bearer token wins over a cookie
    - OpenAPI documents the scheme and the header on all four routes
- **Checked by hand** on the built server, following Step 12 with no cookie file: the token was captured; the session read as the guest; `/auth/token` returned a gateway token; the unsigned half read as signed out; after sign-out the token read as signed out. The test guest was deleted.
- **Review:** no changes needed. Every goal is met.
  - `requireSignature` is real: without it the plugin would sign a bare session id itself and accept it, which the "unsigned" e2e case rules out.
  - A bearer token that fails its signature check leaves the request's cookie in place, so "the bearer token wins" applies only to a valid token. That's the safe direction.
  - The upgrade by bearer deletes the guest's sessions, so the old token dies (pinned).
- **`/feature test`:** no new tests needed. **Coverage from unit tests:**
  - `auth-flow.service.ts`: 100% branches and functions, 97% lines, with `issued()` and the token forwarding covered. The 3 uncovered lines are the B10b and B11a catch blocks noted before, all routed through the already-tested `fromBetterAuth`.
  - `auth.factory.ts`: 100%.
  - `session-docs.decorator.ts` and `contract-response.ts` are OpenAPI metadata, covered by the e2e suites: the bearer suite's OpenAPI case checks the security list and the header on all four routes, and B03b's contract suite covers `ContractResponse`.
- **Observations left for later:**
  - **Mobile project:** React Native's native networking keeps cookies by default (iOS's shared cookie storage, for example). The app may end up holding the session cookie alongside its bearer token. The bearer token wins, so nothing breaks, but the app should either switch cookie storage off for API calls or let the Expo plugin manage it.
  - **The web receives `set-auth-token` too.** Browser scripts can't read it (not exposed by CORS), but it's visible in devtools, like the cookie itself. That's acceptable: same session, same holder.

## History
