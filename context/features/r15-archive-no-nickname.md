# R15 — Archive Search Without Nicknames

## Status

Complete

## Goals

- **`GET /catalog/matches`:** `q` no longer matches the match's `nickname`. `archiveWords` (`src/catalog/archive.ts`) stops reading `identity.nickname`
- **Every other search word stays as R12 built it:**
  - both clubs' names, short names and aliases
  - the competition name
  - the season label, and the season's years (`2004-05` also reads as `2004` and `2005`)
  - the match date's year
  - normalization (`normalizeName`) and the word-start rule are unchanged
- **The response is unchanged:** `MatchIdentity.nickname` is still sent on every entry
- **Nothing else changes:** filters, order, paging, `total`, access (`@ProGated`) and the 5-minute index
- **Unit tests,** `src/catalog/archive.spec.ts`:
  - `archiveWords` no longer holds the nickname's words ("miracle", "istanbul")
  - the "Miracle of Istanbul" match is not found by "istanbul" or "miracle"
  - the same match is still found by its clubs, an alias, its competition and its season
  - the other R12 search cases still pass; the nickname case is replaced
- **E2E,** `test/catalog/archive.e2e-spec.ts`: the rolled-back pool match with the nickname "The Archive Night" is not found by "archive night". It is still found by its clubs, alias, competition and years
- **Docs:** in `context/api-contract.md`, drop the nickname from the `ArchivePage` `q` rule, and make "istanbul" an example of what doesn't match

## Your part

1. **At `/feature load`:** nothing to decide
2. **At `/feature test`:** point `.env` at `dev` for the e2e run. You edit `.env` yourself
3. **At `/feature complete`:** approve the commit, the merge into `main` and the push

## Notes

- **Why:** no ingest match has a nickname, so nickname search promised what the data can't deliver (Pro browser review, 2026-11-12, item 7). The user turned it off on 2026-11-13. Asked in `lineup-web/context/docs/backend-requests.md` § R15; the web side is fix Pro Polish D. Needs R12 (`6a1431e`)
- **No other place searches the match nickname:**
  - the overview, filter options and history only send it
  - the player directory's `terms` and the guess matcher read player aliases, not match nicknames
- **Numbering:** web request R15. Not a `todo.md` phase. Don't edit `todo.md`
- **No migration, no `PROTOCOL_VERSION` bump:** a behaviour change only, with no field change
- Constraints:
  - comments single-line, at most 50 characters
  - `@/` imports
  - never touch `production`
  - **never run the e2e suites while `.env` points at `ingest`**
- Verification:
  - `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`
  - `npm run test:e2e` on `dev`
- Afterwards, in the web: mark R15 done in `backend-requests.md` with the commit; `context/docs/contract.md` drops the nickname from the search rule

**Review (2026-11-13)**

- No change. No OpenAPI description mentions nickname search, so `/docs/openapi.json` is unchanged
- The e2e `missing` query (the off-pool match's nickname) now finds nothing either way. It was kept: `all` and `years` already prove the off-pool match is never listed

**Test results (2026-11-13)**

- `npm test` 1489 passed (92 files); lint, build, `npx tsc --noEmit` clean
- `npm run test:e2e` on `dev`: 512 passed (41 files)
- The built server on `dev` (`PRO_ENABLED=false`, so the archive is public):
  - nickname-only words find nothing: "mudbath", "rain final", "night six" and "comeback" each give `total` 0
  - "northgate" still finds 4 matches through a club name, each with its nickname still sent
  - "crown 2003" and "2003" find The Mudbath Derby match
- No new unit tests at `/feature test`: the `archiveWords` and search cases were written at `/feature start`

## History
