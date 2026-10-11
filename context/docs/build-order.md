# Build Order — Mock Gameplay First, Scraper Second

Plan: prove the whole game on mock data first, then replace the data with scraped data. The architecture stays the same.

## Your plan, mapped to phases

| # | Item | When | Status |
| --- | --- | --- | --- |
| 3 | Schemas and types for the game tables | B03a (contract) + B05–B08 (tables) | ✅ Done |
| 1 | Seed the mock data into the DB | B09 | ✅ Done. Dev branch has 10 matches, 167 players, 220 lineup rows |
| 2 | Test gameplay end to end on mock data | After **B43**, with web W27–W32 | Next |
| 4 | Create the scraper repo | After **B43** (earliest: any time, see below) | Later |
| 5 | Scrape (e.g. mackolik.com) | After item 4 | Later |
| 6 | Validate and transform into the schemas | After item 5, then a backend load step | Later |

## Order at a glance

```text
DONE   B01–B14                     items 1 and 3 already done
NEXT   B25, B25b                   match selector + catalog, over the mock pool
       B27–B32                     rules engine in src/game/
       B33–B35  + web W27–W29      solo playable end to end   (item 2a)
       B36–B42  + web W30–W32      duel playable end to end   (item 2b)
       B43                         two-client harness → item 2 done
THEN   scraper repo                items 4 → 5 → 6
       backend: load + score + gate + QA + images + indexes
ANY    B44–B46                     observability, deploy, Redis; doesn't depend on the scraper
```

Skip B15–B24 for now and come back to them after B43, in their new form (next table).

## What happens to the ingestion phases

| Phase | With a scraper repo |
| --- | --- |
| B15 Ingestion Harness | **Moves to the scraper repo**: HTTP client, disk cache, rate limits |
| B16 Match Metadata | **Scraper**, item 5 |
| B20 Lineup Ingest | **Scraper**, item 5 |
| B17 Entity Resolution | **Scraper**, item 6: dedupe clubs and players, build aliases |
| B18 Cultural Footprint | Either repo. It comes from Wikipedia/Wikidata, not mackolik |
| *new*: Load step | **Backend** `scripts/ingest`: reads the scraper's files and writes the DB, reusing the B09 seed loader |
| B19 Memorability | **Backend**, runs on the loaded data |
| B21 Guessability Gate | **Backend** |
| B22 Pool QA Report | **Backend** |
| B23–B24 Storage, Images | **Backend**, after the load |
| B26 Indexes | **Backend**, after the load. Trigram cost can't be measured on 345 aliases |

## The handoff between repos

- The scraper **outputs validated JSON files**, in the same shape as the seed data (`scripts/seed/seed-data.schema.ts`): competitions, clubs, players with aliases, matches with two XIs.
- The scraper repo keeps **its own copy** of that schema. Nothing is shared, the same as with web and mobile.
- The backend **loads and revalidates** the files, so the backend alone owns the database schema. The scraper never writes to Postgres.

## When to start the scraper repo

- **Decided: after B43.** The scraper must capture every field that B19, B21 and B32 need, and those inputs are only fixed once those phases are specced. Scraping earlier risks missed fields and a second scrape.
- **Order after B43:** spec B19 and B21 first, so you know what to scrape → build the scraper → load → score → gate.
- **Optional, any time:** a manual look at about 20 match pages from 2001, 2006, 2011 and 2019, plus mackolik's terms. No code or schema needed. This is **P01**, and it decides whether the 2000–2026 range is realistic.

## Revisit once real data is loaded

Phases built on the mock data that need a second pass:

| Phase | What to revisit |
| --- | --- |
| B05–B08 Schema | Add migrations for any field the scraper brings that the tables lack. Never edit an applied migration |
| B09 Seed | Decide the mock data's fate: keep it for dev and tests, or keep it out of the real pool |
| B25 Selector | Remove the dev-only pool bypass. Test stratified sampling on a real-sized pool |
| B25b Catalog | Real competition and club lists. Narrow the era range if P01 rules out the 2000s |
| B27 Normalization | Check every real alias normalises to itself. Cover Turkish, Slavic and Nordic names |
| B28 Alias Matching | Retune the `pg_trgm` threshold on real names. Keep "Ronaldo ≠ Ronaldinho" |
| B29 Collisions | Test real surname clashes (two Silvas, two Nevilles) |
| B32 Side Selection | Replace the mock fallback with real guessability and star power |
| B43 Harness | Rerun win, loss, draw and forfeit against real matches |

## Open points to close

- [ ] **B25:** dev-only pool bypass, or run B19 and B21 on the mock data early
- [ ] **P01:** source coverage and terms checked
- [ ] **Spec:** update `project-overview.md` in all three repos for the scraper repo and the new source
- [ ] **Season range:** if the 2000s drop out, change the season constants in the contract (backend, then web, then mobile)
- [ ] **Images:** after B24 the backend sends absolute CDN URLs, and the web tightens `imageUrlSchema`

## Decide before you get there

1. **At B25:** the mock matches have no memorability scores (0 rows), so the selector's pool is empty. Either add a dev-only pool bypass, or run B19 and B21 on the mock data early.
2. **Before item 4:** a fourth repo and scraping mackolik both change `project-overview.md`. Today that file names API-Football as the primary source, keeps ingestion in this repo, and rules out programmatic scraping of similar sites (ToS). Check mackolik's terms and `robots.txt`, then update the spec in all three repos.
3. **After B43:** re-spec B15–B24 for the scraper split before starting them. `todo.md` already tags which phases move.
4. **At B32:** the mock has no star-power data. Use a neutral fallback, such as an even home/away pick, until B18 and B19 exist.
