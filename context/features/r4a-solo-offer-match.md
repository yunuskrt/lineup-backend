# R4a — Solo Offer Match

## Status

Complete

## Goals

- **Contract**, `src/contract/solo.ts`:
  - `soloMatchOfferSchema` gains `match: matchIdentitySchema`
  - `home` and `away` stay, marked deprecated in OpenAPI: "Use `match.home` / `match.away`" (D1)
  - the deprecation must show in `/docs/openapi.json`. If the generator (`z.toJSONSchema(contractRegistry)` in `src/contract/openapi.ts`) drops property metadata, record a deviation and say it in the property's `description` instead
- **`SoloService.start()`**, `src/solo/solo.service.ts`:
  - returns `{ sessionId, match, home: match.home, away: match.away }`
  - `match` is the `OfferedRun`'s `match`, the identity that `SoloSession.match` and `SoloSummary.match` already carry (D2)
- **Tests:**
  - `solo.service.spec.ts`:
    - the offer's `match` equals the run's identity
    - `match.home` and `match.away` equal `home` and `away`
    - the offer passes `soloMatchOfferSchema`
    - it carries no `side` and no `formation`
  - `test/solo/solo.e2e-spec.ts`:
    - `POST /solo/sessions` answers with a `match`
    - after `POST …/side`, `SoloSession.match` equals that `match` plus `side` and `formation`
- **Docs:** `context/api-contract.md` § `SoloMatchOffer`: the `match` row, and `home` and `away` noted as deprecated

## Your part

1. **At `/feature load`:** confirm the proposed decision below, or change it
2. **At `/feature test`:** point `.env` at `dev` for the e2e run, then back to `ingest` afterwards. You edit `.env` yourself (as for R3a)
3. **At `/feature complete`:** approve the commit, the merge into `main` and the push

## Decisions

Decided 2026-11-06, before load:

- **D1. `home` and `away` are kept and marked deprecated** in OpenAPI, in favour of `match.home` and `match.away`. They are still sent, so a web build from before R4 keeps working
  - Rejected: leaving them unmarked

Approved at `/feature load` (2026-11-06), as proposed:

- **D2. `match` is the run's own `MatchIdentity`**, built once by `identityOf` at `start()`. That is the same object `SoloSession.match` (with `side` and `formation`) and `SoloSummary.match` already use. No second query
  - Alternative: rebuild it from the database for the offer. That would be a second read of the same row

## Notes

- **Why:** the web's "Pick your side" card becomes a match card: both crests and names, the score, the competition logo and name, the date. Today the offer has only the clubs. Asked in `lineup-web/context/docs/backend-requests.md` § R4, Part 1 (2026-11-06); web spec `context/fixes/gameplay-visuals-b-side-pick-card.md`
- **Numbering:** web request R4. Part 1 is R4a; Part 2 is R4b (`r4b-named-order.md`). The two are independent and can ship in either order
- **Scope:** not a `todo.md` phase. Don't edit `todo.md`
- **Safe to send** (HC 2): `MatchIdentity` holds no player of either XI. `MATCH_IDENTITY_SELECT` never selects a lineup, and the duel already shows the same identity in `matchReady`
- **Additive contract change:**
  - nothing removed or renamed
  - a web build from before R4 drops `match` (plain `z.object`)
  - REST only, so no `PROTOCOL_VERSION` bump
  - no migration
- **Cleanup later:** drop `home` and `away` once every released client reads `match`. That would be a breaking change, so it's a separate request
- Constraints:
  - comments single-line, at most 50 characters
  - `@/` imports
  - types from `z.infer`
  - never touch `production`
  - **never run the e2e suites while `.env` points at `ingest`**
- Verification:
  - `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`
  - `npm run test:e2e` on `dev`
  - `/docs/openapi.json`: `SoloMatchOffer` has `match` (a `$ref` to `MatchIdentity`), and `home` and `away` are deprecated
  - on `dev`: one `POST /solo/sessions` as a guest; report that `match` is present, its `home.id` and `away.id` equal the deprecated fields, and it has no `side`. Statuses and booleans only
- Afterwards, in the web: mark R4 Part 1 done in `backend-requests.md`; Gameplay Visuals B transcribes `SoloMatchOffer.match`

**Deviations recorded during implementation**

- None. The deprecation works through Zod's `.meta({ deprecated, description })` on `ClubRef`: OpenAPI emits `deprecated: true` and the note around an `allOf` `$ref` to `ClubRef`, so no `description`-only fallback was needed

**Test results (2026-11-06)**

- `npm test` 1144 passed (+1); lint, build and `npx tsc --noEmit` clean
- `npm run test:e2e` on `dev` (`ASSET_BASE_URL` unset): 449 passed (448 + the new offer case)
- `/docs/openapi.json`: `SoloMatchOffer.match` is a `$ref` to `MatchIdentity`; `home` and `away` are `deprecated: true`
- Live on `dev`, as a guest:
  - `POST /solo/sessions`: `200`, `success: true`, `match` present
  - `match.home.id` and `match.away.id` equal the deprecated fields
  - `match` has no `side` or `formation`; `match.competition` carries `logoUrl` (R3b)
- The live check left one guest user on `dev`; its offered run was in memory only, gone when the server stopped
- No further unit tests: `start()` returning the run's identity is the only new logic, covered

## History
