# R2 — Image URLs

## Status

Complete

## Goals

- **`ASSET_BASE_URL`** in `src/config/env.schema.ts`: optional, `https` only, trailing slash dropped (`z.url({ protocol: /^https$/ }).transform(...)`, `.optional()`), with a one-line comment ("Unset: every crest and photo URL stays null"). Cases in `parse-env.spec.ts`: unset gives `undefined`, a trailing slash is dropped, `http://` and a non-URL are refused
- **`assetUrl(base, key)`**, new pure helper `src/matches/asset-url.ts`: returns `` `${base}/${key}` `` when both are set, else `null`. Spec beside it: no base, no key, both
- **Crests** in `src/matches/match-refs.ts`:
  - `crestKey: true` in `CLUB_REF_SELECT`; `'crestKey'` in `ClubRow`'s `Pick`
  - `toClubRef(club, assetBase)` sets `crestUrl: assetUrl(assetBase, club.crestKey)`
  - `toMatchIdentity(match, assetBase)` passes it to both sides
  - the comment "crest_key is a bucket key; URLs arrive with B23" goes
- **Photos** in `src/matches/squad-loader.service.ts`:
  - `imageKey: true` in the player `select` of `SQUAD_SELECT`
  - `toLoadedSquad(..., assetBase)` sets `imageUrl: assetUrl(assetBase, player.imageKey)`
  - `SquadLoaderService` gets `@Inject(ENV) env: Env` and passes `env.ASSET_BASE_URL`
  - the comment "image_key becomes a URL with B23" goes
- **Every caller** passes `this.env.ASSET_BASE_URL`, injected with `@Inject(ENV)`. `ConfigModule` is `@Global`, so no module changes:
  - `src/catalog/catalog.service.ts` (add `crestKey: true` to its club `select`)
  - `src/users/users.service.ts` (`favouriteClub`)
  - `src/solo/solo.service.ts`, `src/users/history.service.ts`, `src/duel/duel-start.service.ts` (`toMatchIdentity`)
- **Tests:**
  - `match-refs.spec.ts`: "never sends a bucket key as a URL" becomes two cases: no base gives `null`, a base gives `<base>/crests/…`. The raw key is never sent alone
  - the same pair in `squad-loader.service.spec.ts` for `imageUrl`
  - every spec that builds these services by hand gets the env argument
  - this also fixes the old `tsc --noEmit` error on `crestKey` in `match-refs.spec.ts`, recorded in B25 and R1
- **`.env.example`:** `ASSET_BASE_URL=`, empty, with a comment: unset keeps images `null`; for real data on `ingest`, `https://br-steep-paper-b1z0rlqq.storage.c-5.eu-central-1.aws.neon.tech/images`
- **Docs:**
  - `context/docs/scraper-data-contract.md` § 2.12: `crest_key` and `image_key` now have a reader (R2), sent as `<ASSET_BASE_URL>/<key>`; § 11's S17/S18 row likewise
  - `context/api-contract.md` § `imageUrl` rule: the backend sends absolute `https` URLs, or `null`
  - `context/mock-to-backend-map.md`: images done by R2; W27 (tighten the web's `imageUrlSchema`) stays a later web task

## Your part

1. **At `/feature load`:** confirm the decisions below, or change them
2. **At `/feature test`**, for the manual check against real data: approve pointing `.env` at the scraper's `ingest` branch. Claude makes the change for you:
   - `DATABASE_URL`: `ingest`'s connection string, from the Neon MCP, written straight into `.env` and never printed
   - `ASSET_BASE_URL`: as above
   - the `dev` line is kept, commented, so it can be put back
3. **At `/feature complete`:** approve the commit, the merge into `main` and the push
4. **At the end:** choose whether `.env` stays on `ingest` for the scraper's S20 play test, or goes back to `dev` now

## Decisions

Approved at `/feature load` (2026-10-29), both as proposed:

- **D1. One env var, the base URL** (`<endpoint>/<bucket>`). The backend joins it to the key and never calls the bucket: no SDK, no credential, no proxy. Clients load the URL straight from the bucket (spec § Data Architecture).
  - Alternative: a storage module with a bucket client (B23 as first written). Not needed: the scraper uploads, and the bucket is `public_read`
- **D2. Optional, `https` only.** Unset keeps today's behaviour (every image `null`), so `dev`, the mock seed and every e2e suite are unchanged.
  - Alternative: required in production. Left for B45, when production gets its own bucket

## Notes

- **Why:** the scraper (S17, S18) uploads crests and photos to Neon Object Storage and loads their keys into `clubs.crest_key` and `players.image_key`. The backend sends `null` for both today, so no image shows. Asked in `lineup-scraper/context/docs/backend-requests.md` § R2 (2026-10-28), needed by the scraper's S20 pilot play test
- **Scope:** the key-to-URL half of B23, the half the backend kept (`context/docs/scraper-repo-setup.md` § 1, row 3). Not a `todo.md` phase, like R1. Don't edit `todo.md`; at the end, ask whether B23 and B24 should be ticked, re-specced or dropped
- **Storage, as the scraper built it:**
  - bucket `images`, `public_read`, on the `ingest` branch only
  - path-style URLs: `<endpoint>/images/<key>`
  - keys `crests/<club-slug>/<sha256-12>.webp` and `players/<player-slug>/<sha256-12>.webp`; a key's bytes never change; objects carry `Cache-Control: public, max-age=31536000, immutable`
  - on `ingest`, the scraper's pilot is loaded (2026-10-29): 3 matches, 6 clubs with a `crest_key`, 65 players with an `image_key`
- **No contract change:** `crestUrl` and `imageUrl` are already nullable `imageUrl`s (absolute `http(s)` or root-relative). No OpenAPI change, no `PROTOCOL_VERSION` bump, no migration
- **Web and mobile:** nothing required. The web draws both with `next/image` `unoptimized`, so any host works and nothing is proxied
- **The raw key is never sent alone:** only `<base>/<key>` or `null`
- **The squad is still never sent** (Hard Constraint 2): `imageUrl` rides on `RevealedPlayer` as before, only at reveal time
- **`users.service.ts`** loads the whole club row (`include: { favouriteClub: true }`). It already has `crestKey`; `toClubRef` still copies only what `ClubRef` needs
- Constraints:
  - comments single-line, at most 50 characters
  - `@/` imports
  - Zod for env; types from `z.infer`
  - never touch `production`
  - **never run the e2e suites while `.env` points at `ingest`**: they expect `dev`'s mock seed and treat `test-` rows as leftovers
- Verification:
  - `npm test`, `npm run lint`, `npm run build` and `npx tsc --noEmit`, now clean
  - `npm run test:e2e` on `dev`, with `ASSET_BASE_URL` unset: nothing changes
  - **Manual check on `ingest`**, `.env` switched (Your part 2):
    1. `GET /catalog/filter-options` lists the 6 clubs, each with a `crestUrl`
    2. one `crestUrl` fetched over HTTPS answers `200`, `image/webp`
    3. a solo game started on the pilot, with one correct guess, returns a revealed player with an `imageUrl` that answers `200`
  - Report counts and statuses only: never print an XI, an alias or a connection string
- Afterwards, in the scraper: mark R2 done in `backend-requests.md`, copy the regenerated `scraper-data-contract.md` as its `data-contract.md`, then the S20 play test

**Deviations recorded during implementation**

- `.env.example`: `ASSET_BASE_URL` is a commented line, not `ASSET_BASE_URL=`: an empty value fails the `https` check at boot, as `COOKIE_DOMAIN` does. `parse-env.spec.ts` gains an "empty string refused" case
- Added: `scraper-data-contract.md` § 2.3/2.5 say a key has no leading `/`, since the backend joins `<base>/<key>`
- Added: crest-URL cases in `catalog.service.spec.ts` and `toMatchIdentity`, beyond the spec's pair

**Test results (2026-10-29)**

- `npm test` 1132 passed (+14), `npm run test:e2e` on `dev` 447 passed, unchanged; lint, build and `tsc --noEmit` clean
- Manual check on `ingest` (`.env` switched, approved):
  1. `GET /catalog/filter-options`: 3 competitions, 6 clubs, 6 with an `https` `crestUrl` under the base
  2. one crest fetched: `200`, `image/webp`
  3. solo run: both in-play crests set; one guess `correct_new`, its `imageUrl` under the base answers `200`, `image/webp`; run quit
- The check left one guest user and one quit solo session on `ingest`
- `.env`'s ingest URL uses `sslmode=verify-full`, as dev does: `require` makes `pg` warn

## History
