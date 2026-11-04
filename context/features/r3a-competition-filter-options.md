# R3a — Competition Filter Options

## Status

Complete

## Goals

- **Contract**, `src/contract/catalog.ts`:
  - new `competitionOptionSchema = competitionRefSchema.extend({ clubIds, seasonStarts })`, registered as `CompetitionOption`; type from `z.infer`
  - `clubIds`: `z.array(idSchema)`
  - `seasonStarts`: `z.array(<int, FIRST_SEASON_START–LAST_SEASON_START>).min(1)`
  - `filterOptionsSchema.competitions` becomes `z.array(competitionOptionSchema)`; `clubs` and `era` unchanged
  - `src/contract/registry.spec.ts`: the id list gains `CompetitionOption`
- **`competitionCoverage(candidates)`**, a pure helper next to `poolCoverage` in `src/matches/pool-rules.ts`:
  - one pass over the candidates, returning per competition id its club ids and its season starts
  - season starts ascending, no repeats; club ids without repeats (the catalog orders them)
  - unit tests in `pool-rules.spec.ts`: a club in two competitions, a competition with one match, a competition whose matches are all one season, order and no repeats, no candidates
- **`CatalogService.filterOptions()`**, `src/catalog/catalog.service.ts`:
  - reads `selector.candidates()` once, as today, for both `poolCoverage` and `competitionCoverage`
  - each competition becomes a `CompetitionOption`
  - its `clubIds` follow the order of `FilterOptions.clubs` (the existing `byName`)
  - an empty pool still gives `competitions: []`
- **Tests:**
  - `catalog.service.spec.ts`: `clubIds` and `seasonStarts` per competition; `clubIds` in `clubs` order; the response passes `filterOptionsSchema`
  - `test/catalog/catalog.e2e-spec.ts`, on `dev`'s seed: every competition has at least one season; every `clubIds` entry is in `clubs`; every season start is inside `era`
- **Docs:**
  - `context/api-contract.md` § `FilterOptions`: `competitions` is `CompetitionOption[]`, with a field table
  - the OpenAPI document gains `CompetitionOption` through the registry; check `/docs/openapi.json` lists it

## Your part

1. **At `/feature load`:** confirm the decisions below, or change them
2. **At `/feature complete`:** approve the commit, the merge into `main` and the push

## Decisions

Approved at `/feature load` (2026-11-04), both as proposed:

- **D1. R3 ships as two features, R3a then R3b.** R3a has no migration and unblocks web Match Filters A on its own. R3b's migration also waits on the scraper. Shipping them together would hold the web back for a schema change it doesn't yet need.
  - Alternative: one feature with both parts
- **D2. The schema checks shape only.** `seasonStarts` is non-empty, and each entry is an integer in the season range. Order, no repeats, `clubIds ⊆ clubs` and `seasonStarts ⊆ era` are guaranteed by `competitionCoverage` and its tests, not by a Zod refine.
  - Alternative: a `superRefine` on `FilterOptions` cross-checking them. Responses fail closed, so a bug there would turn the whole catalog into `server_error`

Decided 2026-11-04, before load:

- **D3. `.env` goes to `dev` for the e2e run at `/feature test`, then back to the `ingest` line** (S20 uses it). The e2e suites never run on `ingest`

## Notes

- **Why:** on `/play`, the web's Club filter lists every pool club (about 100), whatever competition is picked. The web wants clubs and era dropdowns that depend on the picked competition. It can't work this out today: `FilterOptions` sends competitions and clubs as two unlinked lists. Asked in `lineup-web/context/docs/backend-requests.md` § R3, Part 1 (2026-11-04); web spec `context/fixes/match-filters-a-dependent-clubs.md`
- **Numbering:** the scraper used R1 and R2, so R3 is free. Part 1 is R3a, Part 2 is R3b (`r3b-competition-logos.md`)
- **Scope:** not a `todo.md` phase, like R1 and R2. Don't edit `todo.md`
- **The link is already there:** every `PoolCandidate` carries `competitionId`, `clubIds` and `seasonStart`
- **Filters request unchanged:** `competitionIds` stays an array. The web will send at most one id, but that's a UI choice, not a game rule, so the backend doesn't enforce it. The duel coin flip still applies one player's set whole (HC 19)
- **Additive contract change:**
  - nothing removed or renamed
  - a web build from before R3 drops the unknown keys (plain `z.object`)
  - REST only, so no `PROTOCOL_VERSION` bump
  - no migration
- **`memorability_score` stays hidden** (HC 20): the season list says which seasons have pool matches, never how memorable they are
- **The squad is untouched** (HC 2): candidates count lineups and never select them
- Constraints:
  - comments single-line, at most 50 characters
  - `@/` imports
  - types from `z.infer`
  - never touch `production`
  - **never run the e2e suites while `.env` points at `ingest`**
- Verification:
  - `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`
  - `npm run test:e2e` on `dev`
  - `GET /catalog/filter-options` on `dev`: report the number of competitions, plus clubs and seasons per competition. Counts only
- Afterwards, in the web: mark R3 Part 1 done in `backend-requests.md`, then Match Filters A transcribes `CompetitionOption`

**Deviations recorded during implementation**

- `src/contract/match.ts` now exports `seasonStartSchema`, so `CompetitionOption.seasonStarts` reuses the `era` bounds instead of a second copy

**Test results (2026-11-04)**

- `npm test` 1139 passed (+7); lint, build and `npx tsc --noEmit` clean
- `npm run test:e2e` on `dev` (`ASSET_BASE_URL` unset): 448 passed (447 + the new catalog case)
  - first full run: 1 failure in `email-verification.e2e-spec.ts`, which R3a doesn't touch; that suite then passed alone twice, and a second full run passed
- `/docs/openapi.json`: `CompetitionOption` listed (`id`, `kind`, `name`, `clubIds`, `seasonStarts`); `FilterOptions.competitions` refs it
- `GET /catalog/filter-options` on `dev`: 6 competitions, 11 clubs, era 2002–2023; per competition 2–3 clubs and 1–2 seasons; every `clubIds` in `clubs`, seasons ascending, unique, inside `era`
- `.env` switched to `dev` for the run by the user; the user switches it back to `ingest` afterwards (D3)
- No new tests needed beyond the goals: `competitionCoverage` and `filterOptions` are the only new logic, both covered

## History
