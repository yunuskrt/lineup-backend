# R3b — Competition Logos

## Status

Complete

## Goals

- **Schema**, `prisma/schema.prisma`, model `Competition`: `logoKey String? @map("logo_key")`, commented like `crestKey` ("Bucket object key, never a URL")
- **Migration** `prisma/migrations/<ts>_competition_logo_key/migration.sql`:
  - exactly `ALTER TABLE "competitions" ADD COLUMN "logo_key" TEXT`
  - no CHECK, as for `crest_key` (D1)
  - made with `prisma migrate dev --create-only`; if that asks to confirm, use `migrate diff` as in R1
- **Applied** to `dev` and to `ingest` (`br-steep-paper-b1z0rlqq`) with `npm run db:deploy`, over each branch's direct host. Never `production`
- **Contract**, `src/contract/match.ts`: `competitionRefSchema` gains `logoUrl: imageUrlSchema.nullable()`. `CompetitionOption` (R3a) inherits it
- **Logos** in `src/matches/match-refs.ts`:
  - `logoKey: true` in `MATCH_IDENTITY_SELECT`'s competition select
  - `toCompetitionRef(competition, assetBase)` sets `logoUrl: assetUrl(assetBase, competition.logoKey)`
  - `toMatchIdentity` passes its `assetBase` on
  - This covers every payload with a `CompetitionRef`: the catalog, solo and duel matches, the solo summary, the duel result and history
- **Catalog**, `src/catalog/catalog.service.ts`: `logoKey: true` in the competition select; `toCompetitionRef(…, this.env.ASSET_BASE_URL)`
- **Tests:**
  - `match-refs.spec.ts`: `toCompetitionRef` with no base gives `null`; with a base it gives `<base>/competitions/…`; `toMatchIdentity` passes it on
  - `catalog.service.spec.ts`: a competition logo under the base; `null` without
  - every spec fixture with a competition row gets `logoKey: null`
- **Seed:** unchanged; it doesn't write `logo_key`. `npm run db:seed` on `dev` prints `0 changed`
- **Docs:**
  - `context/docs/scraper-data-contract.md`, regenerated:
    - the "Generated from" header and the latest migration
    - § 2.1: the `logo_key` row and the key scheme `competitions/<competition-slug>/<sha256-12>.<ext>`, where `ext` is `webp`, `png` or `svg`
    - § 2.12: `logo_key` is read since R3b
    - § 11's S17/S18 row
  - `context/api-contract.md` § `CompetitionRef`: `logoUrl`, an `imageUrl` or `null`
  - `context/mock-to-backend-map.md`: competition logos

## Your part

1. **At `/feature load`:** confirm the decisions below, or change them
2. **At `/feature test`:** approve deploying the migration to `ingest`. The connection string comes from the Neon MCP and is never printed
3. **At `/feature complete`:** approve the commit, the merge into `main` and the push

## Decisions

Decided 2026-11-04, before load:

- **D1. No CHECK on `logo_key`, like `crest_key`.** A nullable `TEXT` column. The data contract keeps the rules: never a URL, no leading `/`
  - Rejected: a CHECK on `logo_key` only, or on all three key columns
- **D2. `.env` goes to `dev` for the migration and the e2e run at `/feature test`, then back to the `ingest` line** (S20 uses it). `ingest` gets the migration through its own URL. The e2e suites never run on `ingest`

Approved at `/feature load` (2026-11-05), both as proposed:

- **D3. `logoUrl` is always present, `null` when unset**, as `crestUrl` and `imageUrl` are (R2). Not optional
- **D4. Depends on R3a** (`r3a-competition-filter-options.md`), merged first: `CompetitionOption` extends `CompetitionRef`. Satisfied: R3a is on `main` at `b9ef744`

## Notes

- **Why:** the web wants a logo on each competition chip. Asked in `lineup-web/context/docs/backend-requests.md` § R3, Part 2 (2026-11-04)
- **Scope:** not a `todo.md` phase. Don't edit `todo.md`
- **Additive contract change:**
  - nothing removed or renamed
  - a web build from before R3 drops `logoUrl`
  - the duel payloads only gain `competition.logoUrl`, so no `PROTOCOL_VERSION` bump (web request § Contract and versions)
- **No logo until the scraper fills one:** on `ingest` every `logoUrl` is `null` until S18 is extended. The web shows a kind icon meanwhile (web Match Filters B)
- **Images:** the bucket and `ASSET_BASE_URL` are R2's. The backend never calls the bucket and never sends a bare key
- **Licensing** (spec § Data Architecture): competition logos are trademarks, like crests. Choosing and attributing them is the scraper's job
- **Neon:**
  - `production` (`br-square-feather-b17d6fhc`) has no schema until B45; not touched
  - migrations go over the direct host, not the pooled one the MCP returns (R1)
- Constraints:
  - migrations only through `prisma migrate`; never edit an applied migration
  - comments single-line, at most 50 characters
  - `@/` imports
  - types from `z.infer`
- Verification:
  - `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`
  - `npm run test:e2e` and `npm run db:seed` (`0 changed`) on `dev`
  - Neon, `dev` and `ingest`: `competitions.logo_key` is nullable `text`, and the migration is finished in `_prisma_migrations`; `migrate status` is up to date
  - `GET /catalog/filter-options` on `dev`: every competition has `logoUrl: null`. Counts only
- Afterwards:
  - **scraper:** copy `schema.prisma` and `data-contract.md`, run `npm run db:check`, then spec extending S18 to competition logos
  - **web:** mark R3 Part 2 done; Match Filters B draws the logos

**Deviations recorded during implementation**

- None of substance. `migrate dev --create-only` worked (no unique index to warn about), so `migrate diff` wasn't needed; the migration is not applied until `/feature test` (D2)
- Added: `api-contract.md`'s `imageUrl` rule heading names `logoUrl`; `history.e2e-spec.ts`'s exact match expectation gains `logoUrl: null`

**Test results (2026-11-05)**

- `npm test` 1143 passed (+4); lint, build and `npx tsc --noEmit` clean
- `dev`: `npm run db:deploy` applied `20261105075429_competition_logo_key`; `migrate status` 11 migrations, up to date; `migrate diff --exit-code` no drift
- `npm run db:seed` on `dev`: 0 changed on all 8 tables
- `npm run test:e2e` on `dev` (`ASSET_BASE_URL` unset): 448 passed
- `GET /catalog/filter-options` on `dev`: 6 competitions, all with `logoUrl: null`; `/docs/openapi.json`: `logoUrl` required on `CompetitionRef`, inherited by `CompetitionOption`
- `ingest` (approved): `migrate deploy` over the direct host `ep-fancy-fog-b1t4k7j7`, with the URL inline and `.env` untouched; 11 migrations, up to date, no drift
- Neon, `dev` and `ingest`: `competitions.logo_key` is nullable `text`, the migration is finished; `ingest` has 11 competitions, 0 with a `logo_key`
- `production` untouched
- No new tests beyond the goals: `toCompetitionRef` is the only new logic, covered with and without a base or key

## History
