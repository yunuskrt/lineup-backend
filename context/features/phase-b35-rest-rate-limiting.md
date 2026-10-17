# Phase B35 — REST Rate Limiting

## Status

Complete

## Goals

- **`@nestjs/throttler`** (6.7.x, which supports NestJS 12), with in-memory storage. B46 swaps in Redis through the throttler's storage interface.
- **`src/common/rate-limits.ts`:** every limit in one table (**Limits**). Each named throttler has a `limit`, a `ttl` and a key.
- **`src/common/rate-limit.guard.ts`:** `RateLimitGuard extends ThrottlerGuard`. It is registered as an `APP_GUARD` after `SessionGuard`, so the user is already known.
  - `getTracker`: picks the key for each limit (**Keys**)
  - `throwThrottlingException`: throws `ApiException('rate_limited', message, { retryAfterMs })` (**Lockout**)
- **Per-route limits** with `@Throttle` / `@SkipThrottle` on:
  - `AuthController` (sign-in, sign-up, guest, upgrade)
  - `GatewayTokenController`
  - `SoloController` (start and guesses)
  - `CatalogController`
- **`src/config/env.schema.ts`:** `TRUST_PROXY_HOPS` (an integer, default `0`). `src/main.ts` sets Express `trust proxy` from it, so `req.ip` is the client's address and not the proxy's (**Keys**).
- **Better Auth's built-in limiter stays on** for the native routes still open over HTTP (B10a left this to B35): `get-session`, `sign-out`, and the verify-email link.
- **Tests:**
  - `rate-limit.guard.spec.ts`:
    - the tracker for each limit: user id, IP, and email plus IP
    - the exception: `rate_limited`, `retryAfterMs` in milliseconds and never negative, and a message naming the wait
    - an unknown limit name throws
  - `rate-limits.spec.ts`: every limit is positive, every named route exists, and the guess limit matches the web mock (12 per 3 s)
  - `test/http/rate-limit.e2e-spec.ts` (**E2E**)

## Limits

Provisional values, tuned once real traffic exists.

| Name | Applies to | Limit | Key |
| --- | --- | --- | --- |
| `default` | every route without its own limit | 120 / 60 s | user, else IP |
| `guess` | `POST /solo/sessions/:id/guesses` | 12 / 3 s | user |
| `start` | `POST /solo/sessions` | 20 / 60 s | user |
| `signIn` | `POST /auth/sign-in` | 10 / 15 min | IP |
| `signInAccount` | `POST /auth/sign-in` | 5 / 15 min | email (**Decisions**) |
| `signUp` | `POST /auth/sign-up` | 5 / 60 min | IP |
| `guest` | `POST /auth/guest` | 10 / 60 min | IP |
| `upgrade` | `POST /auth/upgrade` | 5 / 60 min | user |
| `token` | `GET /auth/token` | 30 / 60 s | user |
| `catalog` | `GET /catalog/filter-options` | 60 / 60 s | IP |

- **Guesses match the web mock: 12 per 3 s.** The web's `rateLimited` scenario shows the lockout at a lower setting, and W29 already handles `rate_limited` with its cooldown.
- **The guess limit also bounds a run's log** (the B33a and B34 notes). At most about 12 judged guesses fit in 3 s, and a run lasts at most about 215 s, so it can't grow without bound. No separate per-run cap is needed.
- **`GET /auth/session` and `POST /auth/sign-out` keep only `default`.** The web calls `getSession` on every page load.

## Keys

- **A signed-in route keys on the user id** from the session, never on anything the client sends. A guest is a user, so one guest can't dodge the guess limit by starting new runs.
- **Before sign-in there is no user, so the key is the client's IP.** It's read from `req.ip`, which is only right behind a proxy if `trust proxy` counts the hops. `TRUST_PROXY_HOPS=0` locally, and B45 sets it for Railway or Fly. Left at 0 behind a proxy, every player would share the proxy's address, and so one limit.
- **`signInAccount` keys on the normalised email** (trimmed and lowercased) from the parsed body. A bad body falls back to the IP, and the validation pipe then rejects it as usual.
- **Keys are hashed by the throttler** before storage. A guess text or a password is never part of a key.

## Lockout

The error goes through the existing envelope:

```json
{ "success": false, "error": { "code": "rate_limited", "message": "Too many attempts. Try again in 42 seconds.", "retryAfterMs": 41800 } }
```

- **Status 429,** with a `Retry-After` header in whole seconds. The envelope filter already passes an `ApiException`'s status through; B03b left 429 for B35.
- **`retryAfterMs`** is the window's remaining time, in milliseconds, never below 0. The web's cooldown reads it directly (`cooldownUntil`).
- **The message names the wait,** rounded up to whole seconds or minutes ("Try again in 2 minutes."). That is the "explained lockout" in `todo.md`. It never says which limit tripped, or whether an email exists.
- **A refused request does no work.** A blocked guess isn't judged, takes no time off the clock, and leaves no log entry. The clock still runs, so the next allowed call catches up as usual.

## E2E

`test/http/rate-limit.e2e-spec.ts` boots `AppModule` with the limits table overridden to short windows, so the test can wait out a lockout:

- **Guesses:**
  - the 13th guess inside the window gets 429 `rate_limited`, a positive `retryAfterMs` and a `Retry-After` header
  - a second guest's guess at the same moment is accepted
  - after the window, guessing works again
  - the refused guess left the run's lives and round unchanged
- **Sign-in:** the 11th attempt from one IP is refused, even with a different email each time. With `signInAccount`, the 6th attempt for one email is refused from a fresh IP (`X-Forwarded-For`, with `TRUST_PROXY_HOPS=1` in the test).
- **Guest:** the 11th `POST /auth/guest` from one IP is refused.
- **Default:** a route with no limit of its own refuses after its quota.
- **Envelope:** every 429 body parses with `apiErrorSchema`, and no message contains an email, a guess or a limit name.
- **Cleanup:** the guests and their sessions are deleted, as in B34.

## Decisions

Settled at `/feature load`:

- **`@nestjs/throttler`.** It is the standard NestJS limiter, and 6.7.1 supports NestJS 12. One guard subclass gives named limits per route, a custom key and the envelope error. Storage is in memory now, with a storage interface for B46's Redis swap. Rejected: a hand-rolled limiter, which would rebuild windows, headers and storage, and need its own Redis adapter in B46.
- **Sign-in is limited per IP and per account:** 10 per 15 min per IP, plus 5 per 15 min per normalised email. Per-IP limits alone don't stop a password guess spread across many addresses. The accepted cost: anyone who knows an email can block that account's sign-in for at most 15 minutes. Its existing sessions are untouched, and the message is the same whether or not the email exists. Rejected: per IP only.
- **A default limit on every route:** 120 per minute, per user or per IP. It is deny-by-default, like `SessionGuard`, so a new route is never unlimited by accident, and the public catalog route is covered (the B25b note). Rejected: limiting only the listed routes.

## Out of Scope

- Socket guess throttling (B42); the duel guess never touches HTTP
- Redis-backed limits shared across instances (B46). Until then each instance counts on its own, which is fine for a single instance.
- Setting `TRUST_PROXY_HOPS` in production (B45)
- CAPTCHA, an account lockout that needs email recovery, and IP reputation lists
- Alerting on lockout spikes (B44)

## Notes

- Scope: a single spec. It covers the limiter, its keys and error, the per-route limits, the proxy setting, and the tests.
- Depends on: B03b (envelope and `ApiException`); B10b, B11a and B12b (the auth routes, and Better Auth's limiter skipping `auth.api.*`); B12a (`SessionGuard` sets the user first); B25b (the public catalog route); B33 (the guess route).
- Constraints:
  - **Overview § G:** "Server-side rate limiting on guesses to blunt dictionary-spam bots, on the HTTP path and the socket path alike." This phase covers HTTP; B42 covers sockets.
  - **"Never trust a client-supplied user id":** keys come from the session or the connection's IP. A forwarded header counts only within the configured proxy hops.
  - **CLAUDE.md:** a refused guess is never logged or echoed, and no limit's key contains the guess.
  - **HC 15:** limits are the same for every tier. Nothing purchasable raises them.
  - **Error handling:** "Never fail silently on a game action." A refused guess returns a clear `rate_limited` error that the web already shows as a cooldown.
  - Limits use wall-clock time, not `CLOCK`. They are about request rate, not game time.
- Verification: `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`. By hand: send 13 guesses quickly with curl, and see the 429 envelope, the `Retry-After` header and the message.

**Deviations recorded during implementation**

- **Each route's limit overrides the throttler's `default` entry.** `@RateLimit(name)` is `Throttle({ default: RATE_LIMITS[name] })`. The throttler keys on class, handler and tracker, so every route keeps its own count. The default of 120 per minute is therefore per route, per user or IP, not one budget across all routes.
- **One tracker covers every `default` limit:** the session's user if there is one, else the IP, prefixed `user:` or `ip:`. The table's key column still holds: the user-keyed limits sit on guarded routes, and the IP-keyed ones on public routes. The per-email limit is a second throttler, named `account`, which runs only on handlers marked `@LimitPerAccount()`.
- **Added `RATE_LIMITS_ENABLED`** (default `true`; boot refuses `false` in production). Every database suite shares 127.0.0.1, so `test/vitest.e2e.setup.ts` switches limits off, and the rate-limit suite switches them back on through an `ENV` override. This key wasn't in the spec.
- **`applyTrustProxy`** lives in `src/config/proxy.ts`. `main.ts` and the rate-limit suite both use it.
- **`setHeaders: false`:** the guard sends only `Retry-After`. The throttler's `X-RateLimit-*` headers are off, because their suffix would name the internal `account` limit.
- **Once over a limit, a client is blocked for a full window.** The throttler's block duration defaults to the window. `retryAfterMs` is the rest of that block, in whole seconds, which is the store's precision.
- **`RateLimitGuard` is registered in `AuthModule`, straight after `SessionGuard`.** Global guards run in the order they're registered. The database test proves the order: a second player on the same IP isn't limited, and that test fails if the rate guard is registered first.
- **Dropped the spec's "unknown limit name throws" test.** `RateLimit` takes a typed name, so an unknown one doesn't compile. `rate-limits.spec.ts` instead checks each route's limit metadata, and the routes left on the default.
- **The database test uses the real limits, not a short-window override.** Only the 3 s guess window is waited out; the other cases check the refusal. Each case uses its own `X-Forwarded-For` address, with `TRUST_PROXY_HOPS=1`.
- **Better Auth's built-in limiter keeps B10a's defaults.** It runs in production, in memory, on the native routes. No code changed.
- The full `Env` fixtures in `auth.factory.spec.ts` and `prisma.service.spec.ts` gained the two keys. `.env.example` documents both.
- **Added in review:** the guard skips anything that isn't an HTTP request, as `SessionGuard` does. Global guards also run on socket gateway handlers, so without this every socket event would have crashed once B36's gateway exists. Socket limits are B42's job. A unit test covers it.
- **Added in testing:** `src/config/proxy.spec.ts` checks that the hop count reaches Express. The only line the unit tests didn't cover was the one-line trust-proxy helper.
- By hand: 12 guesses returned 200 and the 13th returned 429, with "Try again in 3 seconds.", `retryAfterMs` 3000 and `Retry-After: 3`. The guess text was absent from the server log.

## History
