# R8 — Showcase Reveals

## Status

Complete

## Goals

- **The showcase constant**, `LANDING_SHOWCASE` in `src/matches/showcase.ts` (R7): `reveals` gains `sergio-ramos`, `keylor-navas` and `marcelo`, after `toni-kroos`, in that order. The miss (`lionel-messi`) is unchanged
- On `ingest`, `demo.reveals` becomes `[8, 10, 9, 7, 5, 2, 0, 4]`
- **Unit tests**, `src/catalog/showcase-view.spec.ts` and `src/catalog/showcase.fixtures.ts`: the real constant over the fixture row builds 8 reveals in that order, with the miss; the existing `null` cases still hold

## Notes

- **Why:** the landing demo should find eight Real Madrid players, not five. Asked in `lineup-web/context/docs/backend-requests.md` § R8 (2026-11-10); web fix `context/fixes/landing-d-fold-demo.md`
- **Numbering:** web request R8. Not a `todo.md` phase. Don't edit `todo.md`
- **Checked on `ingest`** (2026-11-10, read-only): `sergio-ramos` slot 2 (DF), `keylor-navas` slot 0 (GK), `marcelo` slot 4 (DF), all in the home XI of `2017-04-23-real-madrid-barcelona`
- **No contract change:** `ShowcaseDemo.reveals` already allows 1–11 distinct slots, and R7's checks (each reveal in the named XI, none repeated) cover the new three. No migration, no `PROTOCOL_VERSION` bump
- **The overview cache** (R7, 5 minutes): the new reveals show within 5 minutes of a deploy
- Verification:
  - `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`
  - `npm run test:e2e` for `test/catalog/` on `dev`
  - on `ingest`, in process, SELECTs only: the built showcase's `demo.reveals` and miss
- Afterwards, in the web: mark R8 done in `backend-requests.md` with the commit and the `demo.reveals`; Landing D checks the eight on real data

**Deviations recorded during implementation**

- `src/catalog/showcase.fixtures.ts` puts the fixture's slugs on the real slots (Navas 0, Ramos 2, Marcelo 4, Kroos 5, Modrić 7, Bale 8, Benzema 9, Ronaldo 10; R7's fixture had Modrić on 6), so the unit test expects the same `[8, 10, 9, 7, 5, 2, 0, 4]` as `ingest`. Added: a case where an R8 reveal (`marcelo`) leaves the XI and the showcase is `null`
- **Incident (2026-11-10):** the catalog e2e (`test/catalog/`, 19 cases) ran once while `.env` pointed at `ingest`. The branch check and the run shared one command. Two cases failed there: the `showcase: null` case, as the showcase match exists on `ingest`, and the rolled-back showcase case, not investigated, since it was the wrong branch to run it on. Checked on `ingest` afterwards, read-only: in the 30 minutes before, nothing was written to `users`, `auth_sessions`, `game_sessions`, `game_rounds`, `guesses`, `player_aliases` or `user_stats`; no `test-` players, aliases, matches, clubs or competitions; no orphaned stats. The suite's own cleanup removed its guests, solo runs and temporary player, and the other two suites only use rolled-back transactions. The e2e reruns on `dev` before the commit

**Test results (2026-11-10)**

- `npm test` 1324 passed (+1); lint, build and `npx tsc --noEmit` clean
- On `ingest`, in process, SELECTs only: the showcase builds; `demo.reveals` is `[8, 10, 9, 7, 5, 2, 0, 4]` (FW, FW, FW, MF, MF, DF, GK, DF); the miss is present with an image; the whole response passes `CatalogOverview`; the showcase match is still not a candidate
- `test/catalog/` e2e on `dev`: 19 passed, after the incident above

## History
