# R7 — Catalog Overview

## Status

Complete

## Goals

- **Showcase constant**, `src/matches/showcase.ts` (D5):
  - `SHOWCASE`: `matchSlug: '2017-04-23-real-madrid-barcelona'`, `side: 'home'`, `reveals: ['gareth-bale', 'cristiano-ronaldo', 'karim-benzema', 'luka-modric', 'toni-kroos']`, `miss: 'lionel-messi'` (player slugs)
  - provided through a DI token in `MatchesModule` (D2), so the selector and the catalog read the same value and the e2e can swap it
- **Pool exclusion**, `src/matches/match-selector.service.ts`:
  - `poolWhere(includeUnscored, excludedSlugs)` returns `{ AND: [{ OR: [...today's branches] }, { slug: { notIn: excludedSlugs } }] }`, so the exclusion holds with `MATCH_POOL_INCLUDE_UNSCORED` on too
  - `MatchSelectorService` takes the showcase token and passes `[SHOWCASE.matchSlug]`
  - that one change covers solo, duel, rooms, `filter-options`, the empty-pool check and the new counts
- **Contract**, `src/contract/catalog.ts`:
  - `showcasePlayerSchema` (`ShowcasePlayer`): `{ name, imageUrl, directoryKey }`, the demo's wrong guess
  - `showcaseDemoSchema` (`ShowcaseDemo`): `reveals` (1–11 distinct slots, 0–10), `miss` (`ShowcasePlayer` or `null`)
  - `showcaseSchema` (`Showcase`): `match` (`MatchInPlay`), `players` (exactly 11 `RevealedPlayer`, distinct slots 0–10), `demo` (`ShowcaseDemo`). Every `reveals` slot is one of `players`' slots
  - `catalogOverviewSchema` (`CatalogOverview`):
    - `counts`: `matches`, `players`, `clubs`, `nationalTeams`, `seasons`, integers ≥ 0
    - `era`: `EraRange`, as `filter-options` returns it
    - `highlights`: `finals`, `shootouts`, `extraTime`, `goals`, integers ≥ 0
    - `competitions`: `CompetitionRef[]`
    - `topClubs`: at most 12 `ClubRef`
    - `showcase`: `Showcase` or `null`
  - `src/contract/registry.spec.ts`: the id list gains the four ids
- **Pure overview**, `src/catalog/overview.ts`:
  - `overviewFigures(rows)` over one row per candidate match (`seasonStart`, both sides' `clubId` and `kind`, both `goals`, `stage`, `extraTime`, `shootoutHome`): `matches`, `clubs` and `nationalTeams` (distinct sides split by `kind`), `seasons`, `finals` (`stage === 'Final'` exactly), `shootouts` (`shootoutHome !== null`), `extraTime`, `goals` (both sides summed)
  - `topClubIds(rows, names)`: `kind = club` only, ordered by the number of candidate matches the club plays in, most first, then by name (the `byName` rule `filter-options` uses), at most 12
- **Showcase check**, `src/catalog/showcase-view.ts`, pure, `toShowcase(constant, row, assetBase, keyOf)`, returning `{ showcase }` or `{ reason }`:
  - one row: the match by slug with `MATCH_IDENTITY_SELECT`, both teams' formation and lineups (`slot`, `position`, the player's `id`, `slug`, `name`, `imageKey` and alias count)
  - the reasons:
    - the match isn't loaded
    - the named side has no formation, or fewer or more than 11 starters
    - a slot breaks the formation (`positionForSlot`), or a starter has no alias, the squad loader's checks
    - a `reveals` slug isn't in the named side's XI, or appears twice
    - `miss` isn't in the **other** side's XI
  - on success: `match` from `toMatchInPlay` with the constant's side; `players` the named XI by slot, each a `RevealedPlayer` with `directoryKey`; `demo.reveals` the reveal slugs' slots, in the constant's order; `demo.miss` the other side's player, `{ name, imageUrl, directoryKey }`
  - never thrown. A reason names the slug or the check, never a player's name
- **Service**, `CatalogService.overview()`:
  - `candidates()`, then in parallel: the overview rows for those ids, one `count(DISTINCT player_id)` over their lineups (D6), the competitions and the top clubs' refs, and the showcase row
  - `competitions`: the candidates' competitions with `logoUrl`, sorted by name as `filter-options` sorts them
  - a showcase reason logs a warning **once per reason** (D4): when it first appears or changes, and one line when the showcase builds again. The rest of the response is unaffected
  - an empty pool answers zeros, empty lists and the `filter-options` era, and still checks the showcase
  - no cache (D3). The time is measured at test and recorded
- **Endpoint**, `GET /catalog/overview` in `CatalogController`:
  - `@Public()`, like `filter-options` (the landing page renders before any session)
  - `@RateLimit('catalog')` (60 a minute)
  - `@ContractResponse(catalogOverviewSchema)`, the usual envelope, so the interceptor still fails closed
- **Unit tests:**
  - `poolWhere`: the slug exclusion with `includeUnscored` false and true
  - `overviewFigures`: clubs and national teams split by `kind`; a club in two matches counts once; seasons distinct; finals, shootouts, extra time and goals add up; no rows gives zeros
  - `topClubIds`: clubs only, at most 12, by match count, ties by name
  - `toShowcase`: the real `SHOWCASE` over a fixture row shaped like the real match gives 11 players and the five reveal slots in order, with the miss; each reason above gives `{ reason }`: a missing match, 10 starters, a `reveals` slug from the other side, a `miss` from the named side, a broken slot
  - `CatalogService.overview()`: a showcase reason still returns every other field; the warning logs once for a repeated reason, again for a new one, and once on recovery
  - the contract: 12 top clubs pass, 13 fail; 10 showcase players fail; a `reveals` slot outside `players` fails
- **E2E** (`test/catalog/`, on `dev`):
  - no session → 200, and the body passes `catalogOverviewSchema`
  - with the real constant, `showcase` is `null` on `dev` (the match isn't seeded), and every other field still returns
  - with the token swapped for a seeded match, its side and slugs (D2): `showcase` is built; `candidates()` no longer returns that match; `filter-options` and the overview's `counts.matches` drop by one; a solo run never gets it
  - the counts equal direct SQL counts over the same candidate ids, including `count(DISTINCT player_id)`
- **Docs:**
  - `context/api-contract.md` § 4: row 17, `GET /catalog/overview`, and the `CatalogOverview`, `Showcase`, `ShowcaseDemo` and `ShowcasePlayer` tables, with the showcase rules
  - OpenAPI: the four components, and the route documented without a session

## Your part

1. **At `/feature load`:** confirm D5 and D6 (done 2026-11-09)
2. **At `/feature test`:**
   - point `.env` at `dev` for the unit and e2e runs and the HTTP checks
   - then at `ingest` for the real numbers: in process with SELECTs only, no HTTP, no e2e
   - you edit `.env` yourself
3. **At `/feature complete`:** approve the commit, the merge into `main` and the push

## Decisions

Decided 2026-11-09, before load:

- **D1. The numbers are reported from both `dev` and `ingest`.** `dev` holds only the 10 seeded fictional fixtures, and the showcase match isn't there, so `showcase` reads `null` on `dev`
  - `dev`: over HTTP, which is what web Landing C sees locally
  - `ingest`: in process with the built `CatalogService`, SELECTs only, as R5 measured. That's the real pool, the real `topClubs` order and a built showcase
  - rejected: `dev` only, as R7 asked; `ingest` only
- **D2. The showcase is a DI token holding the real constant.** The e2e swaps it for a seeded match, so the whole path (built showcase, pool exclusion) runs on `dev`. The real constant is checked on `ingest`, read-only
  - rejected: unit tests only for the built case; inserting the real match and 22 players on `dev` for the test
- **D3. No cache.** Built per request, as `filter-options` is; the time is measured on `ingest` and recorded. A cache comes later only if that number asks for it
  - rejected: a 5-minute in-memory cache
- **D4. A showcase failure logs once per reason**, when it first appears or changes, plus one line when it recovers. The route is public, and on `dev` the showcase is always `null`
  - rejected: a warning on every read, as R7 says

Approved at `/feature load` (2026-11-09), both as proposed:

- **D5. The constant lives in `src/matches/showcase.ts`, not `src/catalog/showcase.ts`** as R7 suggests. `poolWhere` is in `matches`, and `catalog` imports `matches`; the other way round would be a cycle
  - alternative: `src/catalog/showcase.ts`, with `matches` importing `catalog`
- **D6. `counts.players` is one `count(DISTINCT player_id)` query over the candidates' lineups**, not a pure function over player ids. Lineups are counted, never selected (`CANDIDATE_SELECT`'s rule), so no player id list sits in memory for this. R7's "two matches sharing a player count it once" is tested in the e2e against a direct count, not in a unit test
  - alternative: load each candidate's player ids and count them in a pure function

## Notes

- **Why:** the landing page (`/`) feels empty. It will show what the archive holds, the competitions, the most-played clubs, and a scripted demo turn on one real, famous XI. Asked in `lineup-web/context/docs/backend-requests.md` § R7 (2026-11-09); web fixes `context/fixes/landing-a-sections.md`, `landing-b-demo-turn.md` and `landing-c-wiring.md`
- **Numbering:** web request R7. Not a `todo.md` phase. Don't edit `todo.md`
- **Checked on `ingest`** (2026-11-09, read-only, counts and booleans only):
  - the match exists; both sides are `4-3-3` with 11 starters
  - the five `reveals` slugs are in the home XI; `lionel-messi` is in the away XI
  - the match is in the pool today, so the exclusion changes what `ingest` serves
  - `stage` values containing "final" are exactly `Final` (56), `Semi-final` (127) and `Quarter-final` (255), so `stage = 'Final'` is exact
- **Checked on `dev`:** 10 matches, 167 players; none of the six slugs and not the showcase match
- **Hard Constraint 2 holds:** the only XI this endpoint sends is one the selector can never serve. Nothing else in the response names a player
- **Hard Constraint 20 holds:** no memorability score in any field, and none in a log line
- **Why exact slugs:** `slug` is unique on `matches` and `players`; the scraper keeps slugs stable across reruns
- **Additive contract change:**
  - a new public route and four new components
  - no socket change, so no `PROTOCOL_VERSION` bump
  - no migration
- **`filter-options` changes on `ingest`:** with the showcase match gone, its counts drop by one match. A club or season that only that match covered would drop out too; La Liga 2016–17 has other matches, so neither should
- Constraints:
  - comments single-line, at most 50 characters
  - `@/` imports
  - types from `z.infer`
  - the squad is never logged; a showcase reason names a slug or a check, never a player's name
  - never touch `production`
  - **never run the e2e suites while `.env` points at `ingest`**
- Verification:
  - `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`
  - `npm run test:e2e` on `dev`
  - After the cache, `npm run test:e2e` on `dev` again: 471 passed, clean on the first full run
- `/docs/openapi.json`: `CatalogOverview`, `Showcase`, `ShowcaseDemo` and `ShowcasePlayer` listed; `GET /catalog/overview` documented without a session
  - on `dev`, over HTTP with no session: every count and highlight, the `topClubs` order, `showcase: null`
  - on `ingest`, in process, SELECTs only: every count and highlight, the `topClubs` order, the showcase built with 11 players, 5 reveals and the miss, the overview's time, and `candidates()` without the showcase match
- Afterwards, in the web: mark R7 done in `backend-requests.md` with both sets of numbers; Landing C transcribes `CatalogOverview`

**Deviations recorded during implementation**

- `topClubs(rows)` returns the club rows themselves, not `topClubIds(rows, names)`: each overview row carries both sides' club refs, so no separate club query is needed. `poolCompetitions(rows)` takes the competitions from the same rows. `byName` moved from `catalog.service.ts` to `src/catalog/overview.ts`, shared with `filterOptions`
- `TOP_CLUBS_LIMIT = 12` lives in `src/contract/constants.ts`, beside the other contract limits
- `showcaseSchema` keeps 11 players on distinct slots but drops the "every reveal is a player's slot" refine: 11 distinct slots in 0–10 already cover every legal reveal
- `toShowcase` parses its result with `showcaseSchema` and turns a failure into a reason (`it fails the Showcase schema`), so an off-contract showcase never fails the whole overview through the fail-closed interceptor
- The reasons, as built: `match <slug> is not loaded`; `<side> side has no formation or no opponent`; `<side> XI has N starters`; `<side> slot N breaks <formation>`; `<side> slot N has no alias`; `reveal <slug> repeats`; `reveal <slug> is not in the <side> XI`; `miss <slug> is not in the <side> XI`. The log lines are `Showcase off: <reason>` and `Showcase back on`, in the `Catalog` context
- Added `src/catalog/showcase.fixtures.ts`, a row shaped like the real match, shared by `showcase-view.spec.ts` and `catalog.service.spec.ts`
- D2's swapped token is tested over a rolled-back match (`test/catalog/overview.e2e-spec.ts`), with the selector and catalog built on the transaction and given a test spec, not by overriding the app's provider: rows in a rolled-back transaction aren't visible to the app's own connection. The HTTP suite runs with the real constant, so `showcase` is `null` on `dev`
- "A solo run never gets it" is shown through the selector, not a real run: with the match excluded, `check()` reports an empty pool for its competition, and solo, duel and rooms all start from `select()` and `check()` over the same `candidates()`. Inside the transaction the blame reads `combination`, as nothing else is scored there
- Showcase players carry `players.id` as `RevealedPlayer.id`, as every reveal does since R5
- **D3 changed at `/feature test` (2026-11-09), as D3 itself allowed, user's choice:** a 5-minute in-memory cache (`OVERVIEW_TTL_MS`) in `CatalogService`. On `ingest` a warm build took about 6.4 s (`candidates()` 1.8–3.4 s, which `filter-options` already pays, plus 1.4–3.0 s to read the 1,924 matches' rows; the player count 0.1 s, the showcase row 0.5 s), on a public route that runs on every landing visit. One build at a time; built lazily on the first request; a failed build keeps nothing and the next request retries; the showcase check and its log run once per build. `CatalogService` takes `CLOCK` (`SYSTEM_CLOCK` added to `CatalogModule`), so tests move time instead of waiting
  - accepted edge: the request that arrives after the 5 minutes waits for the rebuild (about 6 s on `ingest`); nothing serves the stale copy meanwhile. `filter-options` is uncached and still takes about 3 s there; both are B26's to speed up
- Fixed at `/feature review` (2026-11-09): the e2e's direct count of seasons read season rows (`prisma.season.count`), not distinct start years; two competitions in one year are two rows. It now counts distinct `startYear`, as the endpoint does. `catalog.service.spec.ts` restores its `Logger` spies in `afterAll`

**Test results (2026-11-09)**

- `npm test` 1323 passed (+46, of which 4 for the cache: a hit inside the 5 minutes, a rebuild after, one build for concurrent requests, a failed build kept nowhere, plus a pool change seen after expiry); lint, build and `npx tsc --noEmit` clean
- Coverage of the R7 files: 100% of lines and functions. Uncovered branches: the existing `filterOptions` guard, `playerCount`'s `?? 0` for an empty row, and `toShowcase`'s `miss: null`, which `demoFault` makes unreachable
- No further unit tests: every function R7 adds has its happy path and each failure case covered
- `npm run test:e2e` on `dev`: 471 passed (464 + 7 in `test/catalog/overview.e2e-spec.ts`), clean on the third full run. The first two full runs each failed once in `test/duel/duel-persistence.e2e-spec.ts`, which R7 doesn't touch: two cases in the first run, then its `afterAll` cleanup (`removeGuests`, a `waitFor` past the late duel save) in the second. The suite passes alone, and the third full run was clean: load timing, as R6b saw in the contract suite
- `/docs/openapi.json`: `CatalogOverview`, `Showcase`, `ShowcaseDemo` and `ShowcasePlayer` listed; `GET /catalog/overview` documents `200` with no security
- Live on `dev`, over HTTP with no session (`ASSET_BASE_URL` unset):
  - `counts`: 10 matches, 167 players, 7 clubs, 4 national teams, 10 seasons
  - `highlights`: 3 finals, 0 shootouts, 0 extra time, 40 goals
  - `era`: 2002–2023
  - `competitions` (6): Continental Champions Cup, Continental Nations Championship, Crown League, Federation Trophy, Global Nations Cup, Liga Meridiana
  - `topClubs` (7, every seeded club): Northgate United, Real Solvara, Atlético Castellmar, FC Weerdam, Kingsmere City, Riverton Athletic, Yıldırımspor
  - `showcase: null`; six calls logged one `Showcase off: match 2017-04-23-real-madrid-barcelona is not loaded` (D4)
  - before the cache, a warm call about 0.25 s over HTTP; in process, a warm `overview()` 257 ms median against `filterOptions()` 148 ms, with a 49 ms round trip to Neon
- Measured on `ingest` (2026-11-09), in process with the built `CatalogService`, SELECTs only (no HTTP, no e2e). `ASSET_BASE_URL` set; `MATCH_POOL_INCLUDE_UNSCORED` makes no difference there (every match is scored: 1,924 candidates either way):
  - `counts`: 1,924 matches, 3,786 players, 53 clubs, 47 national teams, 26 seasons
  - `highlights`: 56 finals, 53 shootouts, 84 extra time, 5,343 goals
  - `era`: 2000–2025
  - `competitions` (11): Bundesliga, Champions League, Euro, LaLiga, Liga Portugal, Ligue 1, Premier League, Serie A, Süper Lig, UEFA Cup / Europa League, World Cup
  - `topClubs` (12): Manchester United, Arsenal, Chelsea FC, Liverpool FC, Tottenham Hotspur, Manchester City, Real Madrid, Barcelona, AC Milan, Inter, Paris Saint-Germain, Juventus
  - `showcase` built: 2017-04-23, LaLiga 2016-17, Real Madrid 2–3 Barcelona, Matchday 33; `side: home`, `4-3-3`; 11 players on slots 0–10, all 11 with an image; `demo.reveals` slots `8, 10, 9, 7, 5` (FW, FW, FW, MF, MF: Bale, Cristiano Ronaldo, Benzema, Modrić, Kroos); the miss present, with an image. The whole response passes `CatalogOverview`
  - the exclusion: the showcase match is not among the 1,924 candidates; without it, the pool holds 1,925 and includes it
  - timing, before the cache: a build 6.1–6.8 s; after it, a cached read 0.003 ms median and a rebuild after expiry 6.0 s median (3.3–7.7 s). `filterOptions()` 2.8 s median for comparison; a `SELECT 1` round trip 58 ms

## History
