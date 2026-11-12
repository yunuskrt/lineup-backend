# R13 — Exact Match Selection

## Status

Complete

## Goals

- **The body**, `SoloStartRequest` in `src/contract/solo.ts`: `Filters` extended with an optional `matchId` (an id), registered as a contract type. `POST /solo/sessions` parses it; its OpenAPI body is `SoloStartRequest`. A body without `matchId` is exactly today's
- **With `matchId`** (`SoloService.start`), in this order:
  1. **Pro only:** a user whose effective tier isn't `pro` gets `forbidden`, `reason: 'pro_required'`, "Picking a match needs Pro." Checked before the daily cap, so a Free player with `matchId` hears this whatever their count. With `PRO_ENABLED=false` everyone is Pro
  2. the daily cap (R11) as today; Pro is never capped, so it only applies with the switch on to Free, who never reaches it here
  3. **the match must be playable:** `MatchSelectorService.isPlayable(matchId)` reads that one match under `poolWhere` (so the showcase is excluded) and the whole-XI check the candidates use. Unknown, not playable, the showcase, or an id that isn't a uuid → `not_found`, "That match isn't in the game."
  4. the filters are ignored; no stratified pick
- **Nothing else changes:** the same `SoloMatchOffer`, the side pick, the round loop, the summary, history and stats. The open run ends as it does today, but only once the match is accepted, so a refused pick keeps a run in play
- **Replays are allowed:** no check against the user's history
- **Duels never take a `matchId`:** `filters:submit` and `room:create` parse plain `Filters`, which strips an unknown key. No socket change
- **Unit tests:**
  - `SoloService`: Pro with a playable `matchId` is offered that match whatever the filters say, with no pick; Free with `matchId` is refused with the reason and message before the cap, keeping the open run; Free without it is unchanged; an unplayable `matchId` is `not_found` and keeps the open run; the same match twice in a row is offered twice
  - `isPlayable`: a pool match is playable; the showcase, a match short of an XI, and an unscored match with the dev flag off are not; a non-uuid id is not, with no query
  - `soloStartRequestSchema`: with and without `matchId`; `filtersSchema` strips a `matchId`; `SoloStartRequest` in the registry
- **E2E**, on `dev`:
  - `test/solo/exact-match.e2e-spec.ts`: Pro picks a pool match with filters that would exclude it, gets it, picks a side, quits, and the run is in `/profile/history` with that match and in the stats; the same match again; Free with `matchId` is `403` + `pro_required`; Free without it plays; an unknown uuid and a non-uuid are `404`; with the switch off a stored-Free user picks a match
  - over a rolled-back pool (as R7 and R12): `isPlayable` is true for a pool match and false for the showcase and a match with no XI
  - the harness: `filters:submit` with a `matchId` is accepted and ignored
- **Docs:** `context/api-contract.md`: `SoloStartRequest`, row 8's request, the `findMatch` errors (`forbidden` + `pro_required`, `not_found`). OpenAPI: `SoloStartRequest`

## Your part

1. **At `/feature load`:** nothing to decide unless you want to change something below
2. **At `/feature test`:** `.env` points at `dev` for the e2e run. You edit `.env` yourself
3. **At `/feature complete`:** approve the commit, the merge into `main` and the push

## Notes

- **Why:** Pro picks the exact match to play: "I want to play Istanbul 2005 right now" (`monetization.md`). The match comes from the archive (R12). Asked in `lineup-web/context/docs/backend-requests.md` § R13 (2026-11-10); web spec `context/features/pro-e-exact-match.md`. Needs R9 (`fcf2079`) and R12 (`6a1431e`)
- **Numbering:** web request R13. Not a `todo.md` phase. Don't edit `todo.md`
- **The same pool as the archive:** `isPlayable` applies the selector's own rules, so every match R12 lists is accepted here, and nothing it hides is
- **HC 15 holds:** solo only. No `matchId` on the queue or rooms; the duel pool is never Pro-only
- **The refusal message for Free** isn't given in § R13, so it's "Picking a match needs Pro."
- **No migration.** Additive contract change: an optional field on the start body. No `PROTOCOL_VERSION` bump
- **R14** adds `practice` to the same body; the two combine
- Constraints:
  - comments single-line, at most 50 characters
  - `@/` imports
  - types from `z.infer`
  - never touch `production`
  - **never run the e2e suites while `.env` points at `ingest`**
- Verification:
  - `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`
  - `npm run test:e2e` on `dev`
  - `/docs/openapi.json`: `SoloStartRequest` as the body of `POST /solo/sessions`
- Afterwards, in the web: mark R13 done in `backend-requests.md` with the commit and the body shape; Pro E (`pro-e-exact-match.md`) sends `matchId`

**Deviations recorded during implementation**

- **The Pro check comes before the daily cap**, as planned, and before any query: a Free `matchId` never reads the database. The pick itself moved into two private helpers, `pick` (the stratified pick, unchanged) and `picked` (the `isPlayable` check)
- **`isPlayable` refuses a non-uuid id with no query**, since the `matches.id` column is a uuid and Prisma would throw on anything else; it then reads as `not_found`, like an unknown id
- **The duel test** checks the flip's applied `filters` carry no `matchId` (`coinFlip.filters` equals `NO_PREFERENCE`), which is where a kept key would show
- **Review (2026-11-12):** the `SoloStartRequest` import sorted with its neighbours. Checked, not changed: "an unscored match with the dev flag off" isn't its own `isPlayable` case; the test asserts the query is `poolWhere(false, …)`, and `poolWhere`'s own tests cover the flag. A uuid in upper case is accepted, as Postgres reads it the same

**Test results (2026-11-12)**

- `npm test` 1449 passed (92 files); lint, build, `npx tsc --noEmit` clean
- `npm run test:e2e` on `dev`: 507 passed (40 files), including `test/solo/exact-match.e2e-spec.ts` (7)
- After the review fix, `/feature test`: `npm test` 1449 and `npm run test:e2e` on `dev` 507 again; lint, build and `npx tsc --noEmit` clean. The built server on `dev`: `/docs/openapi.json` has `SoloStartRequest` (`competitionIds`, `clubIds`, `era` required; `matchId` optional) as the body of `POST /solo/sessions`. No new unit tests: `isPlayable` (8 cases), the exact-match block in `SoloService` (6) and the schema (4) were already covered

## History
