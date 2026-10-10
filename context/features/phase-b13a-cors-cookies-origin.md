# Phase B13a — CORS, Cookies & Origin Check

## Status

Complete

## Goals

- **Explicit CORS** (Open Questions 1). Since B11b the Nest wrapper has been enabling credentialed CORS by itself, from Better Auth's `trustedOrigins`: methods GET/POST/PUT/DELETE, and any request header reflected back. It was never chosen and is untested.
  - `src/auth/auth.module.ts`: `disableTrustedOriginsCors: true` on the wrapper
  - `src/config/cors.ts`: `corsOptions(env)` with:
    - `origin`: exactly `[WEB_APP_URL]`
    - `credentials: true`
    - `methods`: GET and POST, the only ones the routes use
    - `allowedHeaders`: `Content-Type` and `Authorization` (B13b's bearer)
    - `maxAge`: 600 s
    - no exposed headers
  - `src/main.ts` applies it with `app.enableCors(...)` before `listen`, so it runs before Better Auth's `/api/auth/*` handler as well as the Nest routes
- **Origin check on credentialed writes** (Open Questions 2), the CSRF guard B10b asked for. `src/common/origin-check.middleware.ts`, applied to every Nest route:
  - for any method other than GET, HEAD or OPTIONS that **carries a cookie**: if the request has an `Origin` header (or else a `Referer`) that isn't `WEB_APP_URL` or the API's own origin (`BETTER_AUTH_URL`, for Swagger's "Try it out"), refuse with `403 forbidden`, "Request refused."
  - a request with no cookie passes: no ambient credential, so no CSRF. This includes B13b's bearer requests.
  - a request with a cookie and **no** `Origin` or `Referer` passes. Browsers always send `Origin` on POST, so only non-browser clients (curl, server-to-server) arrive without one, and those can't be tricked into sending a victim's cookie.
- **Cookie scope** (Open Questions 3). `src/config/env.schema.ts` and `.env.example`:
  - `COOKIE_DOMAIN`: optional. When set (for example `lineup.gg`), Better Auth's `advanced.crossSubDomainCookies` scopes the session cookie to it.
  - boot fails if `COOKIE_DOMAIN` isn't the host of both `BETTER_AUTH_URL` and `WEB_APP_URL`, or a parent domain of both
  - left unset in dev, so the cookie stays host-only on `localhost`
- **HTTPS in production.** The env schema refuses `NODE_ENV=production` unless both `BETTER_AUTH_URL` and `WEB_APP_URL` are `https`. Better Auth then sets `Secure` on its cookies and prefixes them with `__Secure-` (see Notes).
- `src/auth/session-docs.decorator.ts` and `setupDocs`: the OpenAPI cookie scheme names the cookie as it's actually set. That's `lineup.session_token` over HTTP and `__Secure-lineup.session_token` over HTTPS.
- `context/docs/auth-setup.md`: a **CORS & Cookies** section replacing the "B13" line in *Later stages*. It covers what `COOKIE_DOMAIN` does and when to set it, and a curl preflight to see CORS from the trusted origin and from an untrusted one.
- Tests:
  - `src/config/cors.spec.ts`: the options built from an `Env`
  - `src/config/parse-env.spec.ts`: `COOKIE_DOMAIN` accepted as host or parent, refused otherwise; HTTPS required in production
  - `src/common/origin-check.middleware.spec.ts`: every row of the rule above
  - `src/auth/auth.factory.spec.ts`: `crossSubDomainCookies` on only when `COOKIE_DOMAIN` is set
  - `test/http/cors.e2e-spec.ts`, booting through the same setup as `main.ts`:
    - a preflight from `WEB_APP_URL` gets `Access-Control-Allow-Origin`, credentials, GET/POST and the two headers
    - a preflight from any other origin gets no `Access-Control-Allow-Origin`
    - a preflight asking for a header outside the list doesn't get it echoed back
    - the same holds for `/api/auth/ok`, Better Auth's own route
    - a cookie POST to `/auth/sign-out` from an untrusted `Origin` gets a 403 envelope, and the session survives
    - from `WEB_APP_URL` or with no `Origin`, the same request succeeds
    - a POST with an untrusted `Origin` and no cookie (`/auth/guest`) passes the origin check

## Open Questions

All three settled at `/feature load`, each as recommended.

1. **Our CORS, or the wrapper's?** **Recommended: ours,** wrapper CORS off.
   - The wrapper ties CORS to `trustedOrigins`, which exists for something else: the redirect allow-list. When the Expo plugin adds the app's deep-link scheme to `trustedOrigins`, that scheme would silently become a CORS origin too.
   - It allows PUT and DELETE, which no route uses, and echoes any requested header.
   - Owning it means one place to read and one test pinning it.
2. **What does the origin check do with a cookie request that has no `Origin`?** **Recommended: let it through.** Browsers send `Origin` on every POST, so a missing one means curl or a server, which can't carry out CSRF. Refusing would break every curl step in the docs for no gain. Better Auth's own check is stricter, refusing a missing origin, but that only covers its native routes.
3. **Does production scope the cookie to the parent domain?** `project-overview.md` § G says to host `api.lineup.gg` and `app.lineup.gg` on one parent and scope the cookie to it.
   - Same-site hosting alone already gets a host-only `api.lineup.gg` cookie sent on the web app's credentialed fetches, since `SameSite=Lax` allows same-site requests.
   - Scoping to `lineup.gg` additionally lets the Next.js server on `app.lineup.gg` read the session, for server-side redirects, but sends the cookie to every other subdomain too.

   **Recommended: build `COOKIE_DOMAIN` now, as the spec says, and decide its production value at B45.** The validation stops a typo from setting a cookie no browser will send.

## Out of Scope

- Bearer tokens for mobile: B13b.
- Rate limiting: B35.
- Production domains and their DNS: B45. This phase only makes the backend ready for them.
- The Expo plugin and its deep-link scheme: when the mobile project starts.

## Notes

- Scope: the browser-facing HTTP boundary (which origins may call the API, which writes need a trusted origin, and where the cookie is sent). No contract change.
- Depends on: B10b (cookies), B11b (`WEB_APP_URL`, `trustedOrigins`), B12b (`GET /auth/token`, the reason CORS now matters).
- **From earlier reviews:**
  - B10b: calls through `auth.api.*` skip Better Auth's own origin check, so **`/auth/*` needs its own** (the middleware above). It covers sign-out too.
  - B12b: a credentialed CORS policy that allowed any origin would let any site read a player's gateway token from `GET /auth/token`. Allowing **only** `WEB_APP_URL` is what prevents that, and the e2e suite pins it.
- **What the cookie looks like today:** `lineup.session_token`, `HttpOnly; SameSite=Lax; Path=/`, host-only, and not `Secure` over plain-HTTP dev. `SameSite=Lax` stays: `localhost:3000` and `localhost:8080` are the same site, and so are `app.lineup.gg` and `api.lineup.gg`.
- **The `__Secure-` prefix:** over HTTPS, Better Auth names the cookie `__Secure-lineup.session_token`. Check what it actually sets, and make the OpenAPI scheme and docs match.
- **Staging warning for B45:** a web app on `*.vercel.app` and an API on `*.up.railway.app` are different sites, so `SameSite=Lax` cookies won't be sent and nothing will stay signed in. Staging needs the same parent-domain setup as production.
- **Middleware order:** CORS must answer a preflight before the origin check, the session guard or Better Auth sees it. The e2e suite checks a preflight on both a Nest route and `/api/auth/*`.
- Constraints:
  - the backend has no knowledge of its clients: no per-platform branch. Bearer and cookie requests differ only in their credential.
  - no `any`; `@/` imports; comments single-line, at most 50 characters
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`
  - By hand: the curl preflights in the new docs section; a cookie POST from an untrusted `Origin` refused, and from the web origin accepted
  - The e2e file owns its prefixes (`test-cors-` emails, `test-co-` handles) and deletes its own users

**Deviations recorded during implementation**

- **CORS is applied by `applyCors(app, env)`** in `src/config/cors.ts`, called from `main.ts` before `listen` and from the CORS e2e suite before `init`. Both get the same setup, and it's registered before the wrapper mounts Better Auth, so preflights to `/api/auth/*` are answered too (pinned by a test).
- **`disableTrustedOriginsCors: true` goes in the options the wrapper's factory returns,** not on `forRootAsync` itself, whose type doesn't accept it.
- **The env checks are defensive.** Zod runs object-level refinements even after a field fails a non-aborting check, such as a regex or URL format. So:
  - the coverage check skips a malformed `COOKIE_DOMAIN`, which already has its own issue
  - it treats an unparseable URL as reported elsewhere
  - the HTTPS check skips a missing value

  Without that, a bad `COOKIE_DOMAIN` got two issues on one key, and a bad URL could have made the check throw instead of reporting. Tests pin both.
- **`COOKIE_DOMAIN` is normalised:** trimmed, lowercased, a leading dot dropped. It must contain a dot, so `gg` is refused. Multi-part public suffixes such as `co.uk` aren't detected; that's a known limit, and the host-coverage check still applies.
- **Origin check details:** the middleware is registered in `AppModule` for `*path`. An `Origin` of `null` and an unparseable `Referer` both count as untrusted. A thrown `ApiException` reaches the envelope filter as a normal 403 (pinned end to end).
- **OpenAPI takes the cookie name from Better Auth,** using `getCookies(instance.options)` in `setupDocs`, so the `__Secure-` prefix over HTTPS can't drift. The `SESSION_COOKIE` constant from B12b is gone. A unit test pins both names (`lineup.session_token` over HTTP, `__Secure-lineup.session_token` over HTTPS).
- **An untrusted preflight still gets 204** with credentials, methods and headers; the `cors` package always sends those. Only `Access-Control-Allow-Origin` is missing, and that's what makes the browser block it.
- **Docs:** `auth-setup.md` § CORS & Cookies continues the guide's step numbering: Step 10 is the curl checks, Step 11 is the `COOKIE_DOMAIN` decision and the staging warning. It also has five new troubleshooting rows and updated "At a glance" and "Later stages" entries. `.env.example` gains a commented `COOKIE_DOMAIN`.
- **Tests:** 350 unit (44 new) and 260 e2e (10 new).
  - `parse-env.spec.ts`:
    - `COOKIE_DOMAIN` accepted as host or parent, normalised; refused when it doesn't cover a host or isn't a domain
    - a bad URL reported once, without throwing
    - HTTPS required on both URLs in production only
  - `cors.spec.ts`: the exact options, and no exposed headers
  - `origin-check.middleware.spec.ts`:
    - safe methods pass
    - an untrusted origin, `null`, an unparseable `Referer`, a lookalike host, another scheme and another port are all refused
    - no cookie passes, and no `Origin` passes
    - the `Referer` is the fallback, and `Origin` wins over it
    - PUT, PATCH and DELETE are checked too
    - the middleware throws the 403 envelope and trusts the API's own origin
  - `auth.factory.spec.ts`: the cookie names over HTTP and HTTPS, and `crossSubDomainCookies` only when `COOKIE_DOMAIN` is set
  - `test/http/cors.e2e-spec.ts`, 10 cases:
    - the preflight from the web app gets the exact headers; from another site, no allow header
    - an extra header isn't echoed
    - the same holds for `/api/auth/ok`
    - a credentialed read is marked, with `Vary: Origin` and no exposed headers
    - a cookie sign-out from an untrusted `Origin` or `Referer` gets 403 and keeps the session
    - from the web app or with no `Origin`, it signs out
    - a cookie-less write from an untrusted origin passes
- **Checked by hand** on the built server, following the new Step 10: the trusted preflight got the exact headers and didn't echo `x-anything`; the untrusted one got no allow-origin; a cookie sign-out from `evil.example` gave 403 and the session survived; from the web app it signed out; OpenAPI named the cookie `lineup.session_token`. No errors in the log, and the test guest was deleted.
- **Review fixes:**
  - **The origin check now covers every write, cookie or not** (settled with the developer at `/feature review`; Open Questions 2's "no `Origin` passes" still stands). The agreed rule only checked writes that carried a cookie. But the session cookie is `SameSite=Lax`, so browsers never attach it to a cross-site POST, and a cross-site attack always passed. JSON-only parsing and CORS preflights stop most writes, but `POST /auth/guest` has no body: a hidden form on any site could submit it. The victim's browser would send no cookie, so a new guest was created, and its `Set-Cookie` overwrote the signed-in player's session cookie, signing them out into a junk guest.
    - `isRefused` now refuses any non-GET request whose `Origin` (or `Referer`) is present and untrusted. `WriteRequest` lost its `cookie` field.
    - A write with **no** `Origin` still passes: curl, servers, and the mobile app, which sends none. An untrusted-origin bearer POST is now refused, which costs nothing: an attacker can't hold a victim's bearer token.
    - The e2e case "a cookie-less write from an untrusted origin passes" became "is refused, with no `Set-Cookie`", plus a new case that a cookie-less write with no `Origin` passes.
    - `auth-setup.md` describes the new rule, and Step 10 adds the cookie-less refusal. `phase-b13b-bearer-mobile.md`'s test line and dependency note now match.
  - **Checked by hand** on the built server: `POST /auth/guest` from `evil.example` gave 403 and set no cookie; from the web app, and with no `Origin`, it gave 200.
  - **Totals:** 349 unit and 261 e2e.
- **`/feature test`:** no new tests needed. **Coverage from unit tests:**
  - 100% lines, branches and functions: `origin-check.middleware.ts`, `env.schema.ts`, `auth.factory.ts`, and `corsOptions` in `cors.ts`
  - wiring, covered by the e2e suites: `applyCors`, the one line passing `corsOptions` to `app.enableCors`, which the CORS e2e suite boots through; and `setupDocs`, whose cookie scheme the B12b OpenAPI case checks. The cookie names it reads from Better Auth are pinned by a unit test.
- **Observations left for later phases:**
  - **Origin-less browser writes don't happen in practice,** but they're the one gap left by design (Open Questions 2). If B44's logs ever show an origin-less write carrying a session cookie from a browser user agent, reconsider.
  - **B13b:** mobile must not send an `Origin` header. React Native's `fetch` doesn't by default; check any HTTP client the mobile app adopts.

## History
