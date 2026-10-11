# Phase B25 — Match Selector

## Status

Complete

## Goals

- `src/config/env.schema.ts`: `MATCH_POOL_INCLUDE_UNSCORED`, a boolean, default `false` (Open Questions 1).
  - A refine rejects `true` when `NODE_ENV=production`.
  - `.env.example` documents it. The dev `.env` sets it to `true`, so the seeded mock matches are playable.
- `src/matches/pool-rules.ts`: pure, no NestJS, no Prisma.
  - **Constants:**
    - `ERA_BUCKETS`: 2000–07, 2008–15, 2016–26, by season start year
    - `TOURNAMENT_KINDS` (Open Questions 2)
    - `POOL_THRESHOLD` for league and tournament matches (Open Questions 3)
  - **`PoolCandidate` type:** `matchId`, `competitionId`, `seasonStart`, `clubIds` (home and away). Nothing else; no score and no player.
  - **`matchesFilters(candidate, filters)`:**
    - competition: empty means all
    - club: home **or** away is in `clubIds`
    - era: `from ≤ seasonStart ≤ to`, inclusive
  - **`emptyReason(candidates, filters)`:** `null` when something matches. Otherwise it blames the first filter, in the order `competition`, `club`, `era`, whose removal refills the pool, and `combination` if none does. The same rule as the web mock's `pool.ts`.
  - **`sampleStratified(candidates, random)`:** picks a competition, then an era bucket, then a club, then a match (Open Questions 4).
    - A match belongs to both its clubs' strata.
    - `random` is injected, `() => number` in `[0, 1)`.
- `src/matches/match-selector.service.ts`: `MatchSelectorService`.
  - **`candidates()`:** one Prisma query for the whole pool, mapped to `PoolCandidate[]`.
  - **`select(filters, random = Math.random)`:** returns `{ matchId }` or `{ emptyBecause }`. A structured result, not a throw, so the B33 route and the B38 gateway each turn it into their own error.
  - **`check(filters)`:** returns the empty-pool reason or `null`. Used by B38 to refuse filters before the coin flip.
- **The pool is the set of matches where all of these hold:**
  - both `match_teams` rows have a `formation` and exactly 11 `lineups` rows (counted, never selected)
  - the match has a `memorability_scores.score` at or above its threshold, **or** it has no score row and `MATCH_POOL_INCLUDE_UNSCORED` is on
  - B21 will add its gate result to this condition later
- `src/matches/matches.module.ts`: provides and exports `MatchSelectorService`. Imported in `AppModule`. No controller; B25b adds the catalog route.
- **Tests:**
  - `src/matches/pool-rules.spec.ts`:
    - each filter on its own, and the empty-means-all rule
    - era bounds are inclusive
    - a club filter matches the home side and the away side
    - blame order, and the `combination` case
    - an empty pool returns a reason
    - **stratification:** with a fixed random, a pool of 90 matches from one club and 10 from another in the same competition and era picks the smaller club far above its 10% share
    - every era bucket edge (2007/2008, 2015/2016)
  - `src/matches/match-selector.service.spec.ts`, with a mocked `PrismaService`:
    - the query's where uses the threshold by competition kind
    - the bypass flag changes only the unscored branch
    - an incomplete XI or a null formation is dropped
    - the select reads no lineup column and no score into the result
  - `src/config/parse-env.spec.ts`: the flag parses, defaults to `false`, and `true` is refused in production
  - `test/matches/selector.e2e-spec.ts`. It commits its own competitions, clubs, players and matches with `test-selector-` slugs:
    - a scored match above its threshold is selectable
    - a scored match below it never is
    - an unscored match is selectable only with the flag on
    - a match with 10 starters on one side, or a null formation, never is
    - each filter narrows the result
    - each `emptyBecause` value is reached

## Open Questions

All four settled at `/feature load`:

- **1:** the dev-only flag, as recommended.
- **2:** `world_cup`, `euro` **and `ucl`**, not as recommended. `uel` keeps the league threshold.
- **3:** 60 for leagues and 45 for tournaments, provisional, as recommended.
- **4:** square-root weighting, as recommended.

1. **The seeded mock matches have no memorability score, so the pool is empty.** **Recommended: a dev-only flag, `MATCH_POOL_INCLUDE_UNSCORED`, refused in production.**
   - It's explicit, it fails closed, and B19 makes it unnecessary.
   - A match with a score below its threshold stays out even with the flag on.
   - The alternative is to build B19 and B21 now. But B19 needs events and cultural signals the mock doesn't have, so it would score the mock low anyway.
2. **Which competitions get the lower "tournament" threshold?** The spec says tournament matches get a lower threshold. **Recommended: `world_cup` and `euro` only.** The spec frames those as the "major international tournaments", and UCL and UEL are club competitions that run all season. The alternative is to add `ucl` and `uel`.
3. **Threshold values.** No real scores exist yet, so any number is a placeholder. **Recommended: 60 for leagues, 45 for tournaments, on the 0–100 scale,** recorded as provisional. B19 and B22 retune them on real data (see `context/docs/build-order.md`).
4. **How strata are weighted.** Picking each level uniformly lets a club with 2 matches come up as often as one with 200, so its 2 matches repeat. Weighting by size brings back the "ten Manchester City matches" problem. **Recommended: weight each level by the square root of its size.** It damps big strata without over-serving tiny ones. The alternative is uniform at each level.

## Out of Scope

- The catalog endpoint: B25b.
- Choosing a side: B32 for duels. In solo the player picks.
- `MatchInPlay` and `SoloMatchOffer` payloads: B33. The selector returns an id only.
- Not repeating a match a user played recently. The spec doesn't ask for it; revisit if real data feels repetitive.
- Caching the pool in memory, and indexes for the pool query: B26 measures first.
- The guessability gate itself: B21. This phase only checks the XI is structurally complete.

## Notes

- Scope: a pure pool module, one service, one env flag and their tests. No route, and no migration.
- Depends on: B07 (matches, teams, lineups), B08 (`memorability_scores`), B09 (seeded mock data for manual checks).
- **Not game logic.** Choosing what to play is pool curation, so it lives in `src/matches/`, not `src/game/`. `pool-rules.ts` is still pure, so it's tested without mocks.
- **One query, then filter in memory.** The pool is expected to be 1,500–3,000 matches. Fetching four small columns per match and filtering in memory keeps `select`, `check` and the empty-pool blame on the same list, with no count queries. B26 measures it on real data.
- Hard Constraints:
  - **13:** the pool needs both the memorability threshold and the gate. Until B21, a complete XI stands in for the gate; the bypass covers only the missing score, and only outside production.
  - **20:** `memorability_score` never leaves the service. It's used in the where only, never mapped into a result, logged or put in an error.
  - **2:** the squad never moves. Lineups are counted with `_count`, never selected.
  - **19:** the selector takes one filter set. B38 does the coin flip and passes the winner's set whole.
- Constraints:
  - no `any`; `@/` imports; comments single-line, at most 50 characters
  - structured results from the service; callers map `emptyBecause` to `ApiException('empty_pool', …)`
- **Revisit once real data is loaded** (`context/docs/build-order.md`): turn the flag off, retune the thresholds, and check the stratification on a real-sized pool.
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`
  - By hand, against the dev branch with the flag on: call `select` many times with empty filters and confirm all 10 seeded matches come up. Then check one filter of each kind and one empty-pool reason. With the flag off, every call is empty.

**Deviations recorded during implementation**

- **The e2e suite rolls back instead of committing.** Each case builds its `test-selector-` fixtures inside a rolled-back transaction (`useRolledBackDb`) and runs the service over that transaction client. No cleanup, and no clash with suites running in parallel.
- **`selectFrom(candidates, filters, random)` lives in `pool-rules.ts`.** The filter, sample and blame steps are one pure function, so `MatchSelectorService.select` is a single line over `candidates()`.
- **`poolWhere(includeUnscored)` is exported** from the service file, so the unit spec pins the exact where clause.
- **The flag uses `z.stringbool()`.** It accepts `true`/`false`, `1`/`0`, `yes`/`no` and `on`/`off`, and rejects anything else, including an empty string. `z.coerce.boolean` would read `"false"` as `true`. The refine runs with `when: () => true`, so in production it's reported alongside other bad keys.
- **Candidates are ordered by match id,** so a seeded `random` gives the same pick every time.
- **The club level ignores the club filter.** With a club filter, a match still sits in both its clubs' strata, so a single club's matches spread across its opponents.
- **Two `Env` test fixtures gained the new key:** `auth.factory.spec.ts` and `prisma.service.spec.ts`.
- **Already broken on `main`, not fixed here:** `npx tsc --noEmit` reports `crestKey` in `src/matches/match-refs.spec.ts`. The test passes under Vitest and `nest build` excludes specs, so nothing fails. It's out of this phase's scope.
- **Tests:** 428 unit and 297 e2e, all green. New: 32 in `pool-rules.spec.ts`, 13 in `match-selector.service.spec.ts`, 8 for the flag in `parse-env.spec.ts`, and 4 e2e cases.
- **Review fixes:**
  - `teams` are read in `side` order (home first). Without an order, Postgres decides which club comes first in `clubIds`, and that would make a seeded pick unrepeatable. A unit case pins the order.
  - One comment was shortened to the 50-character limit.
- **`/feature test`:** one new case: `sampleStratified` stays in range when `random()` returns exactly 1. That's outside its `[0, 1)` contract, but rounding can approach it, and it covers `pickIndex`'s fallback and the match-level clamp. **Coverage from unit tests:** `pool-rules.ts`, `match-selector.service.ts` and `env.schema.ts` are at 100% of statements, branches, functions and lines. `matches.module.ts` is wiring, loaded through `AppModule` by every e2e suite.
- **Checked by hand on the dev branch:**
  - **Flag on:** 1,000 picks with empty filters reached all 10 seeded matches, each between 81 and 139 times. A filter of each kind only returned matching matches, and an unknown club gave `club`.
  - **Flag off:** 0 candidates, and `select` gave `combination`.

## History
