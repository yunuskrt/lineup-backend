# R12 — Match Archive

## Status

Complete

## Goals

- **`GET /catalog/matches`**, `CatalogController`, `catalog` rate limit:
  - **access:** with `PRO_ENABLED=true` a session whose effective tier is `pro`; Free gets `forbidden`, `reason: 'pro_required'`, "Browsing the match archive needs Pro."; no session gets `unauthorized`. With the switch off it is public
  - the access rule is a decorator, `@ProGated(message)` in `src/auth/pro-gated.decorator.ts`, read by `SessionGuard` (which gains `ENV`): public while the switch is off, else a session and then the tier, from the session's `User` (read fresh on every request, R9)
- **Query** `ArchiveQuery` in `src/contract/catalog.ts`, all optional, query-string text coerced:
  - `q`: trimmed, 1–64 characters
  - `competitionId`, `clubId` (either side): one id each
  - `from`, `to`: season starts inside the covered era (2000–2025), `from ≤ to` when both are given
  - `cursor`: opaque, from the previous page; a malformed one is `invalid_input`
  - `limit`: 1–50, default 20
- **Response `ArchivePage`** = `{ entries: MatchIdentity[], nextCursor: string | null, total: number }`, registered as a contract type. `total` counts every match the query matches, across all pages
- **The pool only:** the selector's own candidates (`poolWhere`, so the showcase is excluded, and both XIs whole), so every entry is a match R13 accepts
- **Order:** newest first by date, then by id descending. Never by `memorability_score` (HC 20)
- **Cursor:** keyset on `(date, id)`, encoded base64url; the next page starts strictly after it, so no repeats or gaps even if the index is rebuilt between pages
- **Search, in memory** (`src/catalog/archive.ts`, pure; `ArchiveService` in `src/catalog/`):
  - each match's words: both clubs' names, short names and club aliases, the competition name, the nickname, the season label, the season's years (`2004-05` gives `2004` and `2005`) and the match date's year, all through `normalizeName`
  - `q` is normalized the same way and split into words; **every query word must be the start of one of the match's words** (decided before load: "barc" finds Barcelona, "ter" doesn't find Inter). So "milan 2005" and "istanbul" both work
  - a `q` that normalizes to nothing (only punctuation) filters nothing
- **The index:** built from the pool and kept 5 minutes, single-flight, on the injected `CLOCK`, as R7's overview is. New data shows within 5 minutes
- **Never in the response:** lineups, players, sides, formations (HC 2) or memorability scores (HC 20). Entries are `MatchIdentity`, built by `toMatchIdentity`
- **Unit tests:**
  - `archive.ts`: words from every source; diacritics ("atletico" finds Atlético), Turkish letters, several words, a nickname, a season year and a date year; word-start matching; each filter alone and combined; `from`/`to` bounds; the order; cursor paging with no repeats or gaps; `total`; a malformed cursor
  - `ArchiveService`: the index is built from the selector's candidates only, kept 5 minutes, and built once for concurrent calls
  - `SessionGuard` with `@ProGated`: switch off is public; switch on needs a session, then Pro, with the reason and message
  - `ArchiveQuery`: bounds, `from > to`, coercion; `ArchivePage` in the registry
- **E2E**, on `dev` (`test/catalog/archive.e2e-spec.ts`):
  - access: Free `forbidden` + `pro_required`, Pro `200`, no session `401`, the switch off public
  - each filter, `q` and paging over the seeded pool; `total`; entries parse as `MatchIdentity` and carry nothing else
  - the showcase match and a match outside the pool never appear
- **Measured on `ingest`** (read-only, in process): the index build and a search's response time
- **Docs:** `context/api-contract.md`: `ArchiveQuery`, `ArchivePage`, `GET /catalog/matches` (row 20), its errors. OpenAPI: `ArchivePage` and the query parameters

## Your part

1. **At `/feature load`:** nothing new to decide unless you want to change something below
2. **At `/feature test`:** `.env` points at `dev` for the e2e run. You edit `.env` yourself. The `ingest` measurement passes its connection string to an in-process script, read-only, so `.env` stays on `dev`
3. **At `/feature complete`:** approve the commit, the merge into `main` and the push

## Decisions

Decided 2026-11-12, before load:

- **Each query word must start one of the match's words**, not appear anywhere: "barc" finds Barcelona, "ter" doesn't find Inter, so short fragments don't flood the results
  - rejected: matching anywhere in the text
- **Search in memory**, not SQL: `normalizeName` (diacritics, Turkish letters) exists only in TypeScript and club aliases aren't stored normalized, so SQL would need a second normalization that could drift. About 1,900 matches fit easily; the 5-minute index follows R7's overview cache

## Notes

- **Why:** Pro browses and searches every match; it's also the way into exact match selection (R13). Asked in `lineup-web/context/docs/backend-requests.md` § R12 (2026-11-10); web spec `context/features/pro-d-archive.md`. Needs R9 (`fcf2079`)
- **Numbering:** web request R12. Not a `todo.md` phase. Don't edit `todo.md`
- **No migration.** Additive contract change: one call, two types. No `PROTOCOL_VERSION` bump
- **R13 reuses** the pool and the index: a `matchId` it accepts is one this list can show
- Constraints:
  - comments single-line, at most 50 characters
  - `@/` imports
  - types from `z.infer`
  - never touch `production`
  - **never run the e2e suites while `.env` points at `ingest`**
  - on `ingest`, SELECTs only; never print a lineup
- Verification:
  - `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`
  - `npm run test:e2e` on `dev`
  - `/docs/openapi.json`: `ArchivePage` and `/catalog/matches`
- Afterwards, in the web: mark R12 done in `backend-requests.md` with the commit, the search method and the timing; Pro D (`pro-d-archive.md`) reads `GET /catalog/matches`

**Deviations recorded during implementation**

- **`@ProGated` also documents** the session and the `403` in OpenAPI, so the route reads as Pro-gated in `/docs`. `SessionGuard` checks it right after `@Public`: the switch off returns early with no session read; on, a session is read and then the tier
- **The bad-cursor message** is "That page link is no longer valid." (`invalid_input`). The schema also limits `cursor` to 1–200 base64url characters, so anything else is refused before the index is read
- **The pool in the e2e:** `dev`'s seeded matches are unscored, so the HTTP suite walks whatever the dev pool holds (filters, search, paging, `total`). The showcase and the out-of-pool cases run over a rolled-back pool with scoring on, as R7's catalog suites do: one pool match, one with no XI, one named as the showcase
- **Review (2026-11-12):** the query's words are normalized once per page, not once per match (`matchesText` takes the words). Checked, not changed: a refused request (no session, Free) never reaches the rate limiter, as on every guarded route since B35; the cursor compares ids as text, the same order the sort uses

**Test results (2026-11-12)**

- `npm test` 1431 passed (92 files); lint, build, `npx tsc --noEmit` clean; Prettier clean but for `test/auth/session-guard.e2e-spec.ts`, already unformatted on `main`
- `npm run test:e2e` on `dev`: 500 passed (39 files), including `test/catalog/archive.e2e-spec.ts` (9)
- After the review fix, `/feature test`: `npm test` 1431 and `npm run test:e2e` on `dev` 500 again; lint, build and `npx tsc --noEmit` clean. No new unit tests: search and paging (29 cases), the service (6), the guard (5) and the contract were already covered
- The built server on `dev`: `/docs/openapi.json` has `ArchivePage` (`entries` as `MatchIdentity`, at most 50; `nextCursor`; `total`), the seven query parameters, and `200`, `401`, `403` on `/catalog/matches`; with no session it is `401`
- **On `ingest`** (in process, SELECTs only; `.env` stayed on `dev`): the index build and first page took **2,600 ms** for **1,924** pool matches. After that, each search's median was **0.04–0.14 ms** (max 1.13 ms over 25 runs): no query 1,924; "milan 2005" 22; "atletico" 123; "fenerbahce galatasaray" 52; "barc" with 2008–2012, 42; one club's matches 126. Paging all 1,924 at 50 a page gave 1,924 unique ids, and the showcase match was never listed
- **"istanbul" finds nothing on `ingest`:** no `ingest` match has a nickname yet (0 of 1,925; the scraper doesn't fill them), and there are 14 club aliases. Nickname search works where the data has one: the rolled-back e2e finds a match by its nickname

## History
