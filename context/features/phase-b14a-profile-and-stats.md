# Phase B14a — Profile & Stats

## Status

Complete

## Goals

- `src/users/users.module.ts`: a new module, imported by `AppModule`.
- `src/matches/match-refs.ts`: `toClubRef(club)`, a pure mapper from a Prisma `Club` to the contract `ClubRef`.
  - `crestUrl` is always `null` for now. `crest_key` is a bucket key, never a URL, and there's no CDN base until B23 (Open Questions 3).
  - B14b's `MatchIdentity` mapper and B25b's catalog build on the same file.
- `src/users/users.service.ts`: `statsOf(userId)` reads one `user_stats` row, with its favourite club, and maps it to the contract `UserStats`:
  - `played`, `wins`, `losses`, `draws`, `bestStreak` and `perfectClears` are copied as stored
  - `accuracy` is `correct_guesses / total_guesses`, or `0` when `total_guesses` is 0
  - `favouriteClub` is `toClubRef(...)` or `null`
  - no row means zeros everywhere, and nothing is written on read (Open Questions 1)
- `src/users/profile.controller.ts`: `GET /profile`, guarded by B12a's global `SessionGuard`.
  - returns `{ user, stats }`, with `user` from `@CurrentUser()`, so it's the same `User` that `GET /auth/session` returns
  - `@DocumentsSession()` and `@ContractResponse(profileSchema)`
  - guests get a profile too (Open Questions 2)
- Tests:
  - `src/matches/match-refs.spec.ts`: `toClubRef`, with `crestUrl` null even when `crest_key` is set
  - `src/users/users.service.spec.ts`, with a mocked `PrismaService`:
    - a stored row maps field by field
    - accuracy is a ratio, and `0` with no guesses
    - a missing row gives zeros and `favouriteClub: null`
    - a favourite club comes out as a `ClubRef`
  - `test/users/profile.e2e-spec.ts`:
    - no session gives a 401 `unauthorized` envelope
    - a new account gets zero stats
    - a seeded `user_stats` row, with a favourite club, comes back mapped and passes `profileSchema`
    - a guest gets a profile with `isGuest: true`
    - a bearer token (B13b) works the same as the cookie
    - OpenAPI documents `GET /profile` with both security schemes and the `Profile` schema

## Open Questions

All three settled at `/feature load`, each as recommended.

1. **A user with no `user_stats` row.** Nothing writes the row until B34 and B41. **Recommended: read it as all zeros, and write nothing on a read.** A `GET` that inserts rows turns a read into a write, and races two tabs opening the profile at once. B34 and B41 upsert the row when a game ends.
2. **Do guests get a profile?** **Recommended: yes.** A guest has real, persisted history (Hard Constraint 12), and the web's profile screen is where a guest is offered the upgrade. The contract lists only `unauthorized` for `getProfile`, so there's no "guests can't" error to send.
3. **`crestUrl` before B23.** **Recommended: always `null`.** The seed leaves `crest_key` null anyway (B09), and the contract allows a null crest. Building a URL needs B23's CDN base, so B23 changes `toClubRef` in one place.

## Out of Scope

- **Guest upgrade:** the todo line lists it, but `POST /auth/upgrade` was built in B11a. Nothing to add here.
- **History:** B14b.
- **Writing stats:** B34 (solo) and B41 (duel) upsert `user_stats` when a game ends.
- **Pro breakdowns:** per-club, per-era and most-missed stats. Monetization is Deferred.
- Changing the handle, email or password: not in the spec or the contract.

## Notes

- Scope: the users module and `GET /profile`. B14b adds `GET /profile/history` to the same controller.
- Depends on: B12a (`SessionGuard`, `@CurrentUser()`), B08 (`user_stats`), B13b (bearer).
- The contract is already defined in `src/contract/profile.ts` (B03a): `profileSchema` and `userStatsSchema`. B14a adds no schema.
- **The user id comes from the session only,** never from a path, query or body. There is no `GET /users/:id`.
- `user_stats` CHECKs (B08) already bound the counters and keep `best_streak` at most 11, so the mapper copies values without re-checking them.
- Constraints:
  - no game logic: stats are read, never derived from games here
  - no `any`; `@/` imports; comments single-line, at most 50 characters
  - every route keeps `@ContractResponse` (B03b, fail-closed)
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`
  - By hand: `curl` `GET /profile` with a cookie, with a bearer token, and with neither
  - The e2e file owns its prefixes (`test-profile-` emails, `test-pr-` handles, `test-profile-` club slugs) and deletes what it creates

**Deviations recorded during implementation**

- **`toClubRef` takes only `id`, `name` and `shortName`** (a `Pick` of the Prisma `Club`), so later callers can select those three columns instead of whole rows. `crest_key` isn't read at all until B23.
- **The 401 message is the guard's `NO_SESSION`** ("Sign in or continue as a guest first."), not the web mock's "Sign in to see your profile.". The global `SessionGuard` refuses before the controller runs, as for every guarded route.
- **OpenAPI tag `profile`** for the new controller, which B14b's history route joins.
- **Tests:** 360 unit (7 new) and 281 e2e (6 new).
  - `match-refs.spec.ts`: the mapping passes `clubRefSchema`; a set `crest_key` still gives `crestUrl: null`
  - `users.service.spec.ts`: the query, field-by-field mapping, accuracy 0 with no guesses, a missing row as zeros (the mock has no write methods, so any write would throw), a favourite club as a `ClubRef`
  - `test/users/profile.e2e-spec.ts`: 401 envelope; a new account has zero stats and still no `user_stats` row afterwards; a stored row with a favourite club (with a `crest_key`) maps and passes `profileSchema`; a guest; bearer and cookie give identical bodies; OpenAPI security and `Profile` ref
- **Checked by hand** on the built server (port 8081): no credential gave the 401 envelope; a new account read zero stats by cookie and identically by bearer. The test user was deleted.
- **Review:** no changes needed. Every goal is met.
  - The only user id is `@CurrentUser().id`; there is no path, query or body input to trust.
  - The read can never write: `statsOf` makes one `findUnique`, and the e2e case confirms no `user_stats` row appears.
  - Accuracy stays within 0–1 because B08 CHECKs keep `correct_guesses <= total_guesses`.
  - The e2e club (`test-profile-club`) is invisible to the seed suite, which already skips `test-` slugs.
- **Observation left for later (B45):** `GET /profile` sends no `Cache-Control`. Browsers revalidate through Express ETag; a shared CDN in front of the API must not cache cookie-authenticated responses. Decide a default `private, no-store` for guarded routes at deployment.
- **`/feature test`:** no new tests needed. **Coverage from unit tests:**
  - `users.service.ts`: 100% lines and functions. The one uncovered branch (line 18) is the constructor-parameter metadata TypeScript emits for Nest DI, not service logic.
  - `match-refs.ts`: 100%, confirmed by a direct coverage run.
  - `profile.controller.ts` and `users.module.ts` are wiring, covered by the six e2e cases.

## History
