# Phase B25b — Catalog Endpoint

## Status

Complete

## Goals

- `src/matches/pool-rules.ts`: `poolCoverage(candidates)`, pure.
  - Returns `{ competitionIds, clubIds, era }` for the pool.
  - Ids are unique.
  - `era` is the lowest and highest `seasonStart`. An empty pool gives the full contract range, `FIRST_SEASON_START`–`LAST_SEASON_START`.
- `src/catalog/catalog.service.ts`: `CatalogService.filterOptions()`.
  - Reads `MatchSelectorService.candidates()` (B25), then loads the competitions and clubs by id: two `findMany` queries, no N+1.
  - Maps them with `toCompetitionRef` and `toClubRef` from `src/matches/match-refs.ts`.
  - Sorts both lists by `name`, as the web mock's `filterOptionsFrom` does. Uses `localeCompare` with a fixed locale, so the order doesn't depend on the server.
  - An empty pool gives empty lists and the full era range (Open Questions 2).
- `src/catalog/catalog.controller.ts`: `GET /catalog/filter-options`.
  - `@Public()` (Open Questions 1)
  - `@ContractResponse(filterOptionsSchema)`, with the schema already in `src/contract/catalog.ts`
  - `@ApiTags('catalog')`
- `src/catalog/catalog.module.ts`: imports `MatchesModule`, declares the controller and service. Imported in `AppModule`.
- **Tests:**
  - `src/matches/pool-rules.spec.ts`:
    - `poolCoverage` dedupes ids
    - takes both clubs of every match
    - gives the min and max season start
    - falls back to the full range for an empty pool
  - `src/catalog/catalog.service.spec.ts`, with a mocked selector and `PrismaService`:
    - queries competitions and clubs by the pool's ids only
    - sorts by name
    - maps refs with `crestUrl: null`
    - an empty pool gives empty lists and the full range, with no competition or club query
  - `test/catalog/catalog.e2e-spec.ts`:
    - answers with no session, `200`, passing `filterOptionsSchema`
    - with `MATCH_POOL_INCLUDE_UNSCORED` on, the seeded competitions and clubs appear, and the era spans the seeded seasons
    - every listed competition and club belongs to a pool match
    - a competition with no pool match is left out (rolled-back fixture)

## Open Questions

Both settled at `/feature load`, each as recommended: the route is public, and an empty pool gives empty lists with the full era range.

1. **Public, or session required?** The session guard denies by default. **Recommended: `@Public()`.**
   - The web's `/play` page fetches the options without a session gate. A visitor who opens `/play` before choosing "continue as guest" would get a 401 on the first screen of the game.
   - The data is harmless: competition and club names already shown in every match.
   - Starting a run (`POST /solo/sessions`, B33) still needs a session.
2. **An empty pool: an error, or empty lists?** **Recommended: empty lists and the full era range,** as the web mock's `filterOptionsFrom` does. `empty_pool` belongs to a match request, where it carries `emptyBecause`. The filter screen should still render.

## Out of Scope

- Caching the options: B26 measures first. The pool changes only when ingestion runs.
- Crest URLs: B23 and B24. Every `crestUrl` is `null` until then, as in B14.
- Narrowing clubs by the chosen competition. The contract returns one flat list, and the web filters nothing.
- Rate limiting a public route: B35.

## Notes

- Scope: one pure helper, one service, one public route and their tests. No migration, and no contract change.
- Depends on: B25 (`MatchSelectorService.candidates()`), B14 (`match-refs.ts`), B03a (`filterOptionsSchema`).
- **The options come from the pool, not from every table row.** Offering a competition with no playable match would only lead to an `empty_pool`. So the dev flag from B25 applies here too: with it off, the dev branch lists nothing.
- Hard Constraints:
  - **20:** no memorability score is read or returned. The selector keeps it in the where.
  - **2:** no player or lineup is read.
- Constraints:
  - no `any`; `@/` imports; comments single-line, at most 50 characters
  - every route keeps `@ContractResponse` (fail-closed)
  - a public route never touches `@CurrentUser()`
- The web already calls `GET /catalog/filter-options` (`lineup-web/src/lib/api/http/api-client.ts`), so the path is fixed.
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`
  - By hand: `curl http://localhost:8080/catalog/filter-options` with no cookie, against the dev branch with the flag on. It lists the 6 seeded competitions and all 11 seeded clubs, with the era at 2002–2023, as counted on the dev branch. With the flag off, the lists are empty and the era is 2000–2025.

**Deviations recorded during implementation**

- **The e2e suite checks the exact pool coverage, not only membership.** It compares the response with `poolCoverage(candidates())` from the same app, so a missing competition or club fails too, not just an extra one.
- **The seeded-data case fails loudly when the dev flag is off,** rather than skipping. A silent skip would hide a `.env` without `MATCH_POOL_INCLUDE_UNSCORED=true`.
- **The "no pool match" case runs `CatalogService` over a rolled-back transaction,** with a selector built on the same client. An HTTP call can't see uncommitted rows. Its `out` competition has a scored match with no XI.
- **`toCompetitionRef` is reused unchanged:** a `{ id, kind, name }` select already fits its parameter type.
- **Tests:** 436 unit and 301 e2e, all green. New: 4 `poolCoverage` cases, 4 in `catalog.service.spec.ts`, and 4 e2e cases.
- **Review fixes:**
  - `byName` breaks a name tie by id. Neither query has an `orderBy` and club names aren't unique, so two clubs with the same name would keep Postgres's arbitrary order. A unit case pins it.
- **Observation left for later (B35):** the route is public and re-reads the whole pool on every call. Fine at 1,500–3,000 matches, but it's the first unauthenticated route that queries the match tables. B35's throttler, or B26's caching, should cover it.
- **`/feature test`:** no new tests needed. **Coverage from unit tests:**
  - `pool-rules.ts`: 100%, including `poolCoverage`.
  - `catalog.service.ts`: 100% of lines, statements and functions; 83% of branches. The uncovered branch (line 14, `@Injectable()`) is the constructor-parameter metadata TypeScript emits for Nest DI, as in B14.
  - `catalog.controller.ts` and `catalog.module.ts` are wiring, covered by the 4 e2e cases over HTTP.
- **Checked by hand** on the built server (port 8081, dev branch), with no cookie:
  - **Flag on:** `200`, 6 competitions and 11 clubs sorted by name, every `crestUrl` null, era 2002–2023.
  - **Flag off:** `200`, empty lists, era 2000–2025.
- The `crestKey` type error in `src/matches/match-refs.spec.ts`, noted in B25, is still there and still out of scope.

## History
