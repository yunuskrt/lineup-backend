# Phase B12a — Session Guard

## Status

Complete

## Goals

- `src/auth/session.guard.ts`: `SessionGuard`, registered globally as `APP_GUARD` (Open Questions 1). For each HTTP request it:
  - skips routes marked `@Public()`, without touching the database
  - resolves the session through Better Auth's `auth.api.getSession` with the request headers and `returnHeaders: true`
  - forwards any `Set-Cookie` Better Auth issues (a refreshed session, or the clearing cookie for an expired one) onto the response
  - throws `ApiException('unauthorized', NO_SESSION)` when there's no session, so the client gets the usual envelope
  - attaches the resolved user to the request, as the contract `User` built by `toContractUser`
  - returns `true` for any non-HTTP context. The socket gateway (B36) checks its own handshake.
- `src/auth/public.decorator.ts`: `@Public()`, metadata only
- `src/auth/current-user.decorator.ts`: `@CurrentUser()`, a parameter decorator returning the user the guard attached. Using it on a `@Public()` route is a programming error and throws.
- `src/auth/auth.controller.ts`: every existing route marked `@Public()` at class level. They resolve or create sessions themselves (B10b, B11a).
- `src/auth/auth.module.ts` (or `src/app.module.ts`): provides `SessionGuard` as `APP_GUARD`
- Tests:
  - `src/auth/session.guard.spec.ts` (unit, `getSession` mocked):
    - a public route passes without calling `getSession`
    - no session → `unauthorized` with the fixed message
    - a session → passes, attaches the contract user (`isGuest`, `emailVerified`, `tier` resolved on the server)
    - a refreshed cookie is appended to the response
    - a `getSession` failure other than 401 → `server_error`, never read as signed out
    - a non-HTTP context passes
  - `test/auth/session-guard.e2e-spec.ts`, with a test-only controller added to the testing module:
    - a guarded route with no cookie → 401 envelope `unauthorized`
    - with a guest cookie → 200, and `@CurrentUser()` is the guest, `isGuest: true`
    - with a registered cookie → 200, the same user `GET /auth/session` returns
    - a public route with no cookie → 200
    - a session past its update age gets a fresh `Set-Cookie` from a guarded route
    - an expired session → 401, with the clearing cookie
    - the existing auth routes still work with no session (sign-up, sign-in, guest, session, sign-out)

## Open Questions

All three settled at `/feature load`, each as recommended.

1. **Deny by default, or opt in?** **Recommended: deny by default.** A global guard with `@Public()` as the exception means a new route is protected unless someone decides otherwise; the contract's solo and profile calls (`findMatch`, `getProfile`, …) all list `unauthorized`. The alternative, an opt-in `@UseGuards(SessionGuard)` per route, makes forgetting it a silent hole.
2. **Our guard, or the Nest wrapper's `AuthGuard`?** `@thallesp/nestjs-better-auth` ships one (switched off in B10a). **Recommended: our own.**
   - The wrapper's guard calls `getSession` without `returnHeaders`, so a refreshed session cookie is dropped: the exact bug B10b's review fixed in `GET /auth/session`. Active players would be signed out when the original cookie expires.
   - It throws Nest's `UnauthorizedException` with its own text, not the contract's message.
   - It calls `getSession` even on public routes, one database read per request for nothing.
   - It attaches Better Auth's raw user, email included, rather than the contract `User`.
3. **Does a route need a "registered only" variant now?** Guests are first-class (`project-overview.md` § F), and no contract call refuses a guest yet. **Recommended: no.** Add a decorator when a route needs one.

## Out of Scope

- JWT issuance for the gateway: B12b.
- Bearer tokens for mobile and credentialed CORS: B13. Once B13 adds Better Auth's bearer plugin, `getSession` reads `Authorization` too, and this guard needs no change.
- Socket handshake authentication: B36.
- Moving the auth routes onto the guard. They stay `@Public()` and keep their own session handling; `upgradeGuest` needs the raw anonymous flag, not the contract user.
- Rate limiting: B35.

## Notes

- Scope: one global guard, two decorators, and the auth routes marked public. No schema change, no contract change.
- Depends on: B10b (session reads, `fromBetterAuth`), B11a (guests, `toContractUser`).
- **From B10b:**
  - `getSession` with `returnHeaders: true` is how refreshed cookies reach the client; the guard must forward them the same way `GET /auth/session` does.
  - A session deleted mid-refresh makes `getSession` throw 401. On a guarded route that's `unauthorized`, not `server_error`.
  - Reuse `NO_SESSION` ("Sign in or continue as a guest first.") from `auth-flow.service.ts`.
- **Global guards and the envelope:** the guard throws `ApiException`, which the envelope filter already renders. Check that a guard-thrown exception reaches the filter and the fail-closed interceptor doesn't swallow it.
- **Swagger and Better Auth's own routes** aren't Nest controllers, so the guard never sees `/docs` or `/api/auth/*`.
- Constraints:
  - never trust a client-supplied user id (CLAUDE.md): the user comes only from the session
  - `isGuest`, `emailVerified` and `tier` are resolved on the server (Hard Constraint 16)
  - the user object attached to the request is the contract `User`, so no email reaches a handler by accident
  - no `any`; `@/` imports; comments single-line, at most 50 characters
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`
  - No app route needs a session until B12b's `GET /auth/token`, so the guarded path is proven by the e2e suite's test controller. By hand: the existing auth flow still works with curl on `npm run start:dev`.
  - The e2e file owns its prefixes (`test-guard-` emails, `test-gd-` handles) and deletes its own users

**Deviations recorded during implementation**

- **The guard reuses `AuthFlowService.getSession`** instead of calling `auth.api.getSession` itself. There's one session-read path, so B10b's fixes (forwarding the refreshed cookie, a session deleted mid-refresh read as signed out, any other failure as `server_error`) apply to guarded routes for free.
- **The resolved user lives on `request.currentUser`,** typed by `RequestWithUser` in `current-user.decorator.ts`. The guard always overwrites it, so a value set earlier can't survive. The decorator's logic is `currentUserFrom(context)`, exported so it can be unit tested.
- **Deny by default reached an existing test:** B03b's `test/contract.e2e-spec.ts` probe controller was refused with 401 once the guard went global. It tests envelope delivery, not auth, so it's now `@Public()`.
- **Tests:** 291 unit (12 new) and 238 e2e (8 new).
  - `session.guard.spec.ts`, 12 cases:
    - public routes pass without a session read, on the method and on the class
    - no session gives `unauthorized` with the fixed message
    - a session attaches the contract user, built only from the session
    - a refreshed cookie and a clearing cookie are both forwarded
    - a failed lookup stays `server_error`
    - non-HTTP contexts pass
    - `@Public()` metadata, and `currentUserFrom` on a guarded and an unguarded route
  - `test/auth/session-guard.e2e-spec.ts`, 8 cases with a test-only controller:
    - no cookie gives a 401 envelope
    - a guest and a registered user reach the route (the registered one with no email)
    - a public route needs no session
    - an unknown route stays 404, not 401
    - an ageing session gets a 30-day cookie
    - an expired session gives 401 with the clearing cookie
    - every auth route still works with no session
- **Checked by hand** with curl on the built server: sign-up, session, sign-out, sign-in and guest all answer with no prior session, an unknown route is `not_found`, and `/docs/openapi.json` is 200. The dev log showed no errors, and both test users were deleted.
- **Observation:** one full e2e run failed `contract.e2e-spec.ts` › "sends data: null for a route that returns nothing" once. It passed 3 times alone and in 2 further full runs. The route is public and reads nothing, so it's not the guard. Watch for it in later runs.
- **Review:** no changes needed. Every goal is met. Only the guard writes `request.currentUser`, and its refusals go through the same envelope filter as every other `ApiException`.
- **`/feature test`:** no new tests needed. **Coverage from unit tests:**
  - `session.guard.ts`: 100% lines, statements and functions; 90% branches. The one missed branch is TypeScript's emitted constructor metadata on the `@Injectable()` line, not guard logic.
  - `public.decorator.ts`: 100%.
  - `current-user.decorator.ts`: `currentUserFrom` fully covered. The one uncovered line is the `createParamDecorator` wrapper that hands off to it; the e2e suite runs it on every guarded request.
- **Observations left for later phases:**
  - **OpenAPI doesn't mark which routes need a session.** B12b's `GET /auth/token` is the first guarded route; document cookie auth (`@ApiCookieAuth`) and the 401 there, so the client transcription shows it.
  - **One session read per guarded request** (session joined with its user). That's fine at MVP; Better Auth's cookie cache could remove it if B26's measurements call for it.
  - **CORS preflights never reach the guard.** B13's CORS middleware answers `OPTIONS` before routing, so guarded routes need no `@Public()` exception for them.

## History
