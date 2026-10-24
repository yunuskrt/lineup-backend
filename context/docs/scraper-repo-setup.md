# Scraper Repo Setup — `lineup-scraper`

How to create the fourth repo, the one that turns real football data into rows the game can play. When you finish this guide, the repo is empty but fully wired, and `/todo current` reports **S01**.

Steps 1–2 change the other repos first. Steps 3–10 create the scraper repo. Step 11 is the per-phase loop.

---

## 0. Decisions already made

| # | Question | Decision |
| --- | --- | --- |
| 1 | Who writes the database and the bucket? | **The scraper.** It builds validated dataset files, then its own loader writes the content tables and uploads images. This **replaces** the "scraper never writes to Postgres" rule in `build-order.md` § The handoff between repos |
| 2 | Who owns the database schema? | **The backend, alone.** The scraper keeps a *copy* of `schema.prisma` and never runs `prisma migrate`. A drift check stops the loader if the copy is stale |
| 3 | Which phases move to the scraper? | **The whole data pipeline:** B15–B22, B24 and P01. The backend keeps B23 (only the key-to-URL half), B26 and every migration |
| 4 | Which language? | **Both:** Python for extraction (fetching and parsing pages), TypeScript for everything after (resolution, aliases, scoring, gate, validation, loading, uploads) |
| 5 | Is data committed to git? | **The final dataset and the curation files are committed.** The HTTP cache, raw records and image binaries are not |

---

## 1. What the scraper repo is

### Its job

```text
 Python (extract/)                    TypeScript (src/)
 ─────────────────                    ─────────────────────────────────────────────
 fetch → cache → parse                resolve → aliases → score → gate → build → load
   │                                     ▲                                  │
   └── data/raw/*.ndjson ────────────────┘                                  ├─→ Postgres (Neon)
       (validated against                                                   └─→ Bucket (images)
        schemas/raw/*.json)
```

| Owns | Does not own |
| --- | --- |
| Fetching pages and APIs, with a disk cache, rate limits and `robots.txt` | The database schema and migrations (backend) |
| Parsing them into raw records | The rules engine, the matcher and the timer (backend `src/game/`) |
| Entity resolution: one club, one player, stable slugs | Turning image keys into URLs for clients (backend B23) |
| Alias sets for every player | Anything a client calls. It serves no traffic and is never deployed |
| Memorability scores, the `sides` signals, the guessability gate | |
| The final dataset, validated, committed | |
| Loading the content tables into a chosen Neon branch | |
| Uploading images and writing `crest_key` and `image_key` | |

### The boundary between Python and TypeScript

**Python only reads the outside world. TypeScript only writes to our own systems.**

- **Python** makes every outbound request: the football sites, Wikipedia and Wikidata, and image downloads. It writes raw records to `data/raw/` and image files to `data/raw/images/`. It never touches Postgres or the bucket, and it never normalises a name.
- **TypeScript** makes no request to any source. It reads `data/raw/`, writes `data/dataset/`, and talks only to Postgres and the bucket.
- **The handoff between them is a set of JSON Schema files** in `schemas/raw/`. TypeScript defines each raw record in Zod and exports it with `z.toJSONSchema()`. Python validates every record against that file before writing it, so a parse bug fails in Python and never reaches TypeScript. One test on each side keeps the files current.
- Raw records keep the source's text **exactly as fetched** (UTF-8, NFC). Names, stages and club names are translated and normalised later, in TypeScript.

### Why the language split

- **Python** has the scraping tools: Scrapy gives a disk cache, `robots.txt` handling, auto-throttling and retries out of the box, which is all of B15. `scrapy-playwright` is ready if a site renders with JavaScript.
- **TypeScript** has the rules that must match the backend exactly. `normalizeName`, the seed schema and the seed loader port almost line for line, and Prisma 7 is the backend's client. In Python, all three would be rewritten, and a rewritten `normalizeName` that differs by one character silently breaks matching.

---

## 2. Before you start

| Need | Check | Notes |
| --- | --- | --- |
| Node **v22.22.3+**, npm **11+** | `node -v`, `npm -v` | Already on this machine (v22.22.3, npm 11.21.0) |
| **uv** | `uv --version` | Not installed yet. Install it with `brew install uv`. It manages the Python version, the virtualenv and the lockfile |
| Python **3.12+** | `uv python list` | The system Python is 3.11.6. Leave it alone and run `uv python install 3.13`. The repo pins the version in `.python-version` |
| Git, GitHub CLI | `gh auth status` | Same as the other repos |
| Neon access | Neon MCP | The same project, **lineup** (`falling-resonance-57080969`). Its 10-branch limit is enough |
| A bucket account | — | Not yet. S17 picks the provider |

---

## 3. Step 1: update the shared spec in the existing repos first

The scraper repo copies `project-overview.md`, `coding-standards.md` and `ai-interaction.md`. They used to describe **three** repos and **ingestion in the backend**.

> ✅ **1a–1c are already applied in lineup-backend.** The backend's three files are now the four-repo versions. You copy their contents by hand, unchanged. The tables below record what changed.
>
> **Still to do:** copy the three files into lineup-web (below), then 1d and 1e. Never edit the shared files in one repo alone: `project-overview.md` must be identical everywhere.

**Copy into lineup-web by hand.** Open each backend file, select all, copy, then replace the whole content of the web file with it:

| # | Copy all of | Paste over all of |
| --- | --- | --- |
| 1 | `lineup-backend/context/project-overview.md` | `lineup-web/context/project-overview.md` |
| 2 | `lineup-backend/context/coding-standards.md` | `lineup-web/context/coding-standards.md` |
| 3 | `lineup-backend/context/ai-interaction.md` | `lineup-web/context/ai-interaction.md` |

Before this update, only `project-overview.md` differed between the two repos (the auth line), so replacing the whole of each file loses nothing from web.

> **Drift found while writing this guide.** The web repo's `project-overview.md` already differs from the backend's on one line, the auth methods (§ F). The web copy still lists Apple and Google sign-in, and the backend copy is correct ("email + password and continue as guest"). Copying the updated backend file over the web one fixes it.

### 1a. `project-overview.md`: what to change

| Where | Today | Change to |
| --- | --- | --- |
| § Data Architecture, the pipeline diagram | One unlabeled flow | Label the first five steps **lineup-scraper**, and the backend step **lineup-backend** |
| § Sources table | API-Football is the primary source | Mackolik added as a **candidate pending S02**. After S02, mark each source "primary", "fill gaps" or "rejected" (a backend docs change, copied to every repo). Keep "Transfermarkt, FBref, worldfootball.net: manual spot-checking only" unless their terms change |
| § Tech Stack, the **Repo** row | "Three separate repositories" | Four. Add `lineup-scraper`: offline ETL, never deployed |
| § Tech Stack, the **Data ingestion** row | "TypeScript scripts in the backend repo under `scripts/ingest`" | "A separate `lineup-scraper` repo: Python extraction, TypeScript transform and load. Rerunnable and idempotent. Never a runtime dependency" |
| § G, last bullet | "No code is shared between the three repos" | "…the four repos". Add: "the scraper keeps its own copy of the database schema; the backend owns it" |
| Hard Constraint 14 | "One backend, two clients, a database and a bucket" | Add: "plus one offline scraper repo that is never deployed and serves no traffic" |
| § Ingestion strategy, known-risk box | Mentions a provider trial | Name it **S02** in the scraper repo (it was P01) |
| § Status, build-order bullet | "…in three repositories" | "The scraper repo starts once duel gameplay is proven on mock data (backend B43)". The rest of § Status is left as it was |
| § G, rules-engine bullet | "Three repos make this easier…" | "Separate repos make this easier…" |
| § Tech Stack, **Framework (backend)**, **Language**, **Observability** rows | "…the database and ingestion", "in all three repos", "Sentry on all three repos" | "…and the database schema"; "in every repo; the scraper also uses Python for extraction only"; "Sentry on the three app repos" |

Hard Constraints 3, 4, 5, 13 and 17 stay as they are. The scraper repo is where they bite hardest; see § 9.

### 1b. `coding-standards.md` (shared)

- **Intro:** "all three repositories" became "all four".
- **Stack table:** add `lineup-scraper | Python + TypeScript | coding-standards-scraper.md`.
- **Repository Boundaries:** add `lineup-scraper — offline ETL: extracts, transforms and loads data and images`. The backend line drops "ingestion" and says "Prisma schema". "With the other two deleted" became "with the others deleted". New bullet: the backend owns the schema; the scraper copies it and never migrates.
- **Add a named exception:** the scraper holds a copy of `normalizeName` to fill `player_aliases.normalized`. This is data preparation, not game logic, the same as the backend seed. Its output must equal the backend's, and a backend check (§ 10) enforces that.
- **Testing:** add "`*.spec.ts` and `test_*.py` (scraper)" next to the existing file-naming rule.

### 1c. `ai-interaction.md` (shared)

- **Workflow step 4 (Test):** add a bullet: **scraper**: run the stage on a small cached sample and read its output; load into a disposable Neon branch, then rerun and expect 0 changes.
- **Working Across Repos:** "Three repos" became "Four repos". New rule: "A schema change the scraper needs is a **backend phase first**: write the migration and deploy it to every Neon branch. Only then does the scraper copy `schema.prisma`. The scraper never runs `prisma migrate`."

### 1d. Backend-only files (this repo)

| File | Change |
| --- | --- |
| `CLAUDE.md` | Add `lineup-scraper` to the architecture table. In the backend's role, change "ingestion" to "loads nothing; the scraper writes the content tables" |
| `context/coding-standards-backend.md` | Remove "`scripts/ingest/` is offline tooling". Add "the content tables (competitions to `memorability_scores`) are written by lineup-scraper; the backend reads them" |
| `context/docs/build-order.md` | Mark § The handoff between repos and § What happens to the ingestion phases as superseded by this file |
| `context/todo.md` | See § 10. **Only when you tell Claude to**, per CLAUDE.md |

### 1e. Web-only file

- `lineup-web/CLAUDE.md`: add `lineup-scraper` to its architecture table.

**How:** 1a–1c are done. For 1d, say "apply § 3, 1d of `scraper-repo-setup.md`" in the backend session. For 1e, copy the three files by hand (table above) and edit `CLAUDE.md` in the web session.

---

## 4. Step 2: one prompt to run in the web session

The scraper must produce data the UI can show: image sizes and formats, text that fits, and formations the pitch view can lay out. Only the web repo knows those limits. Paste this into the **lineup-web** Claude Code session:

> Write `context/docs/data-display-requirements.md` for the new `lineup-scraper` repo, which will produce the real match data and images. Work from this repo's components and schemas, not the mock's values. Do not change any code. Use plain Markdown tables:
>
> 1. **Images.** Every place `crestUrl` and a player's `imageUrl` render. For each: the rendered size in px (1x and 2x), the shape and crop (circle, square, contain or cover), whether SVG, PNG and WebP all work, what background is assumed (transparent or not), and what shows when the URL is `null` or fails to load.
> 2. **Text lengths.** For club `name` and `shortName`, competition `name`, `stage`, `nickname`, `season` and player `name`: where each one shows, the longest value that fits at phone and desktop width, and what happens on overflow (truncate, wrap or shrink).
> 3. **Formations.** Which `formation` strings the pitch view lays out correctly. How `slot` 0–10 maps to pitch positions: confirm or correct "slot 0 is the GK, then the lines from defence to attack, each filled right to left". What happens with a formation it doesn't special-case, such as 4-2-3-1, 4-1-4-1, 3-4-1-2, 3-5-2, 5-3-2 or 4-1-2-1-2.
> 4. **Positions.** Whether `position` (GK/DF/MF/FW) is shown or used for layout, and whether it must agree with the slot's line in the formation.
> 5. **Data assumptions.** Anything in the UI that assumes something about the data: non-Latin or Turkish characters, very long names, missing `stage` or `nickname`, national teams versus clubs, three-letter `shortName`.
> 6. **Attribution.** Whether any surface could show an image credit (author and licence), and what adding one would take.

Then open `lineup-web/context/docs/data-display-requirements.md`, copy all of it, and paste it into a new file, `lineup-scraper/context/docs/data-display-requirements.md` (item 12 in § 6's file list). S11, S14 and S18 read it.

No other web prompt is needed. The web's mock fixtures, `normalize.ts` and matcher tests were already transcribed into the backend at B09, B27 and B28, and the backend versions are the ones to port.

---

## 5. Step 3: create the repo

```bash
cd ~/Desktop/lineup
mkdir lineup-scraper && cd lineup-scraper
git init -b main
gh repo create lineup-scraper --private --source . --remote origin
```

**The repo must stay private.** The committed dataset contains every starting XI, which is the game's answer key, and scraped content may not be redistributable.

Leave the code scaffold to **S01**, the same way B01 scaffolded the backend through the normal workflow. Steps 4–6 (§ 6–8) only add context, skills and config, and every file in them is created by hand.

---

## 6. Step 4: copy and write the context files

Everything is done by hand. Each file is filled in one of two ways, and none needs editing afterwards:

- **Copy from a file:** open the source file, select all, copy, and paste into the new file.
- **Paste from this doc:** copy the contents of the named code block in this doc, without the fence lines, and paste them into the new file.

### Folders to create

Inside `lineup-scraper/`:

```text
context/
context/docs/
context/docs/backend-specs/
context/features/
context/fixes/
context/research/
```

### Every context file, one by one

Paths on the left are inside `lineup-scraper/`. Paths on the right starting `lineup-backend/` or `lineup-web/` are files to open and copy from.

| # | Create | Fill it with | Notes |
| --- | --- | --- | --- |
| 1 | `CLAUDE.md` (repo root) | Paste § 6b | |
| 2 | `context/project-overview.md` | Copy from `lineup-backend/context/project-overview.md` | Already the four-repo version (Step 1) |
| 3 | `context/coding-standards.md` | Copy from `lineup-backend/context/coding-standards.md` | Already the four-repo version (Step 1) |
| 4 | `context/coding-standards-scraper.md` | Paste § 6c | |
| 5 | `context/ai-interaction.md` | Copy from `lineup-backend/context/ai-interaction.md` | Already the four-repo version (Step 1) |
| 6 | `context/current-feature.md` | Paste § 6e | |
| 7 | `context/todo.md` | Paste § 8 (the code block at the top) | |
| 8 | `context/README.md` | Paste § 6d | |
| 9 | `context/docs/scraper-repo-setup.md` | Copy from `lineup-backend/context/docs/scraper-repo-setup.md` | This file, as the record of how the repo was set up |
| 10 | `context/docs/build-order.md` | Copy from `lineup-backend/context/docs/build-order.md` | Its "Revisit once real data is loaded" table says what the real data must support |
| 11 | `context/docs/data-contract.md` | Copy from `lineup-backend/context/docs/scraper-data-contract.md` | Exists only after § 6f |
| 12 | `context/docs/data-display-requirements.md` | Copy from `lineup-web/context/docs/data-display-requirements.md` | Exists only after Step 2 |
| 13 | `context/docs/backend-specs/phase-b05-club-competition-schema.md` | Copy from `lineup-backend/context/features/phase-b05-club-competition-schema.md` | Read-only reference: competitions, seasons, clubs and their CHECKs |
| 14 | `context/docs/backend-specs/phase-b06-player-alias-schema.md` | Copy from `lineup-backend/context/features/phase-b06-player-alias-schema.md` | Players and aliases, `pg_trgm`, `unaccent` |
| 15 | `context/docs/backend-specs/phase-b07-match-lineup-schema.md` | Copy from `lineup-backend/context/features/phase-b07-match-lineup-schema.md` | Matches, sides, XIs, events |
| 16 | `context/docs/backend-specs/phase-b08-scoring-session-schema.md` | Copy from `lineup-backend/context/features/phase-b08-scoring-session-schema.md` | `memorability_scores` and the session tables |
| 17 | `context/docs/backend-specs/phase-b09-seed-script.md` | Copy from `lineup-backend/context/features/phase-b09-seed-script.md` | The loader that S15 ports |
| 18 | `context/docs/backend-specs/phase-b25-match-selector.md` | Copy from `lineup-backend/context/features/phase-b25-match-selector.md` | How the pool and thresholds are read |
| 19 | `context/docs/backend-specs/phase-b27-name-normalization.md` | Copy from `lineup-backend/context/features/phase-b27-name-normalization.md` | The `normalizeName` that S04 ports |
| 20 | `context/docs/backend-specs/phase-b28-alias-matching.md` | Copy from `lineup-backend/context/features/phase-b28-alias-matching.md` | Why short names need exact aliases |
| 21 | `context/docs/backend-specs/phase-b29-squad-collision-rules.md` | Copy from `lineup-backend/context/features/phase-b29-squad-collision-rules.md` | Surname clashes inside an XI |
| 22 | `context/docs/backend-specs/phase-b32-team-side-selection.md` | Copy from `lineup-backend/context/features/phase-b32-team-side-selection.md` | The `sides` signals block |
| 23 | `context/features/.gitkeep` | Leave empty | Git doesn't keep empty folders |
| 24 | `context/fixes/.gitkeep` | Leave empty | |
| 25 | `context/research/.gitkeep` | Leave empty | |

Files 11 and 12 can come later. Create them once § 6f and Step 2 have produced their sources; everything else can be done now.

### What is not copied

| File | Into scraper? | Why |
| --- | --- | --- |
| `monetization.md` | ❌ | Nothing in the scraper touches tiers or payments |
| `api-contract.md` | ❌ | The scraper speaks no REST or socket. The few rules it needs (season range, squad size, slot order, formation rule) go into `data-contract.md` |
| `mock-to-backend-map.md` | ❌ | Web mock history |
| `coding-standards-backend.md`, `-web.md` | ❌ | Other stacks |
| `theme.md`, `design.md`, `screenshots/` | ❌ | UI only |
| Other `features/`, `fixes/` contents | ❌ | Backend history. Only the empty folders go across |
| `docs/auth-setup.md`, `guest-upgrade-testing.md`, `backend-repo-setup.md` | ❌ | Backend only |
| `../Resources/` | ❌ | An old template folder, superseded by the repos' own context |

### 6b. `CLAUDE.md` (repo root)

````markdown
# Lineup — Scraper

Know the XI. Beat the Clock.

## Architecture

Four separate repositories, one backend:

| Repo             | Stack               | Role                                                   | Runs on           |
| ---------------- | ------------------- | ------------------------------------------------------ | ----------------- |
| `lineup-backend` | NestJS              | REST, auth, Socket.IO, rules engine, schema owner      | Railway / Fly.io  |
| `lineup-web`     | Next.js             | Browser client — renders and transmits input           | Vercel            |
| `lineup-mobile`  | Expo React Native   | iOS + Android client — renders and transmits input     | EAS → both stores |
| `lineup-scraper` | Python + TypeScript | Offline ETL: extract, transform, load data and images  | A laptop, by hand |

**This repo.** It produces the match pool: it extracts real matches and XIs, resolves them, scores them, gates them and loads them into Postgres and the bucket. It is never deployed and serves no traffic.

**No code is shared between repos.** No package, no submodule, no cross-repo import. This repo keeps its own copy of the database schema; **the backend owns it**. This repo must build with the other three deleted.

## Context Files

- @context/project-overview.md
- @context/coding-standards.md
- @context/coding-standards-scraper.md
- @context/ai-interaction.md
- @context/current-feature.md
- @context/docs/data-contract.md

`project-overview.md` is the shared spec and must stay identical in all four repos.

@context/todo.md is for developer-side use. **Do not modify the project context based on this file.**

## Commands

- **Install**: `npm install` and `uv sync`
- **Test**: `npm test` and `uv run pytest`
- **Lint**: `npm run lint` and `uv run ruff check` and `uv run mypy extract`
- **Extract**: `uv run scrapy crawl <spider> -a <arg>=<value>` (S06 fixes the exact form)
- **Transform and load**: `npm run <stage>` (each phase names its stage)
- **Schema**: `npm run db:generate`, `npm run db:check` (fails if `schema.prisma` drifted from the database)
- **There is no migrate command.** Schema changes are backend phases.

**IMPORTANT:**

- **Do not add 'co-authored by Claude'** to any commit message
- History entries in `current-feature.md` must not exceed 75 characters
- Do not edit `todo.md` unless told to via prompt or skill
- When a phase completes, ask to tick it in `todo.md` in the same commit
- Never run `prisma migrate` or `prisma db push`. Never write a non-content table
- Never load into the `production` branch without an explicit instruction in the prompt
- No LLM is a source for a lineup, score, date, player name or alias
- Python never writes to Postgres or the bucket; TypeScript never fetches a source
- Respect every source's terms and `robots.txt`; never bypass a block or a rate limit
````

### 6c. `context/coding-standards-scraper.md`

Starter content. Refine it as the phases settle things.

````markdown
# Coding Standards — Scraper (Python + TypeScript)

For `lineup-scraper`. Read alongside `coding-standards.md`, which always applies. Where this file differs, it wins for this repo.

## Layout

- `extract/` is the Python package (import name `extract`): Scrapy spiders, parsers and the record writer. It runs from the repo root via `pyproject.toml` and `scrapy.cfg`.
- `src/` is TypeScript: one folder per stage (`raw`, `resolve`, `aliases`, `score`, `gate`, `dataset`, `load`, `storage`, `qa`), plus `db/`, `config/` and `names/`.
- `schemas/raw/` holds the JSON Schema files generated from `src/raw/`. They are the only interface between the two languages. Never edit them by hand.
- `prisma/schema.prisma` is a copy of the backend's. There is no `prisma/migrations/`.
- `data/` is described in `docs/data-contract.md`: what is committed and what is not.

## The two languages

- **Python:** fetch, cache and parse. No database, no bucket, no name normalisation.
- **TypeScript:** everything after the raw records. No outbound request except Postgres and the bucket.
- **Parsers are pure:** HTML or JSON in, records out. They are tested on saved pages in `extract/tests/fixtures/`, never against the live site.
- **Spiders stay thin:** they choose URLs and pass responses to a parser.
- **Stages are pure:** files in, files out. Scoring, the gate and alias building are pure functions with unit tests and no mocks, like the backend's `src/game/`.

## Python

- Python 3.13 via uv. `uv.lock` is committed.
- Type hints everywhere. `mypy --strict` passes. No `Any`.
- Ruff for lint and format.
- Absolute imports from the package root (`from extract.parsers.match import parse_match`). This is the Python form of the `@/` rule.
- PEP 8 naming: `snake_case` functions and modules, `PascalCase` classes, `SCREAMING_SNAKE_CASE` constants.
- Tests: pytest, `extract/tests/test_*.py`.
- Every record is validated against `schemas/raw/` before it's written. An invalid record fails the run.

## TypeScript

- Same as the backend: Node 22, ESM, strict, Zod 4, Vitest, oxlint, Prettier, `@/` imports. Tests are `*.spec.ts` beside the code.
- Every file read from disk is parsed with Zod. Types come from `z.infer`.

## Data rules

- **Raw text stays raw.** Source strings are stored as fetched, apart from NFC normalisation.
- **Slugs are permanent.** Once `data/curation/crosswalk/` gives an entity a slug, it never changes. The loader keys on slugs; a new slug is a new row.
- **Manual decisions live in `data/curation/`** (merges, splits, display names, extra aliases, excluded matches), never in code.
- **Output is deterministic:** sorted by slug, stable key order, 2-space JSON, trailing newline. A rerun with no new input gives a byte-identical dataset.
- **Timestamps** come from the source or the run's start, never from the middle of a loop.

## Database

- Prisma 7 with `@prisma/adapter-pg`, as in the backend.
- Write only the content tables listed in `docs/data-contract.md`.
- Diff, then write: create what's missing, update what differs, never touch what's equal. A rerun writes nothing.
- Never delete a competition, season, club, player or match. Game history points at them with `Restrict`.
- `npm run db:check` runs before every load.

## Logs and errors

- The loader and anything that can run against a shared branch prints counts and paths, never an XI or an alias list.
- Validation errors name a path, never a value, as the backend seed does.
- QA reports name entities, and they stay local, under `data/reports/` (gitignored).

## Comments

- Same rule as everywhere: rare, one line, at most 50 characters. `#` in Python, `//` in TypeScript.
````

### 6d. `context/README.md`

```markdown
# Context

These are the context files referenced by `CLAUDE.md` in the repo root. The ones listed first are loaded on startup; everything else is read on demand.

Loaded on startup:

- `project-overview.md` - Full project spec. Shared by all four repos and identical in each
- `coding-standards.md` - Conventions shared by all four repos
- `coding-standards-scraper.md` - Python and TypeScript rules for this repo; wins any conflict here
- `ai-interaction.md` - Workflow and communication guidelines
- `current-feature.md` - The feature in progress, plus the history of completed ones
- `docs/data-contract.md` - The tables, columns, CHECKs and rules the dataset must satisfy; owned by the backend
- `todo.md` - Ordered scraper build phases (`S` prefix), used with `/todo`

Read on demand:

- `docs/` - Setup record, build order, display requirements from the web, source-trial report, backend specs (`docs/backend-specs/`, read-only)
- `features/` - Phase specs, named `phase-s<NN>-<kebab-title>.md` (split: `phase-s11a-…`)
- `fixes/` - Fix specs, shaped like `features/`
- `research/` - Research prompts for `/research`

Workflow per phase: `/todo current` → `/todo spec` → `/feature load <spec>` → `/feature start` → `/feature review` → `/feature test` → `/todo done` → `/feature complete`.
```

### 6e. `context/current-feature.md`

```markdown
# Current Feature

<!-- Feature Name -->

## Status

<!-- Not Started|In Progress|Completed -->

Not Started

## Goals

<!-- Goals & requirements -->

## Notes

<!-- Any extra notes -->

## History

<!-- Keep this updated. Earliest to latest -->
```

### 6f. `context/docs/data-contract.md`, written by the backend session

The backend owns the schema, so this file comes from the backend repo. In **this** session, say:

> Write `context/docs/scraper-data-contract.md` for lineup-scraper. Cover:
>
> - the content tables it may write, column by column, with types, nullability, unique keys and every CHECK from the migration SQL
> - the tables it must never write
> - the FK delete rules that forbid deleting content
> - `normalizeName`'s exact rule and its test vectors
> - the season-label rules (`seasonIssue`), season range, competition kinds, club kind, squad size, the formation rule, and slot order with GK in slot 0
> - the `memorability_scores.signals` shape, including the `sides` block B32 reads
> - `ERA_BUCKETS`, `POOL_THRESHOLD` and their meaning
> - how the selector decides a match is in the pool
> - the Neon project and branch ids
> - which backend files each scraper phase should port

Then open `lineup-backend/context/docs/scraper-data-contract.md`, copy all of it, and paste it into a new file, `lineup-scraper/context/docs/data-contract.md` (item 11 in § 6's file list). When a backend migration changes a content table, regenerate the file and paste it over again.

---

## 7. Step 5: the `.claude` folder and `.mcp.json`, file by file

The same two ways as § 6: **copy from a file** (open it, select all, copy, paste into the new file) or **paste from this doc** (the contents of the named code block, without the fence lines).

### Folders to create

Inside `lineup-scraper/`:

```text
.claude/
.claude/agents/
.claude/skills/
.claude/skills/cleanup/
.claude/skills/feature/
.claude/skills/feature/actions/
.claude/skills/research/
.claude/skills/todo/
.claude/skills/todo/actions/
```

### Every file, one by one

| # | Create | Fill it with | Same as backend? |
| --- | --- | --- | --- |
| 1 | `.mcp.json` (repo root) | Copy from `lineup-backend/.mcp.json` | Yes (Neon) |
| 2 | `.claude/settings.json` | Paste § 7j | No, written for the scraper |
| 3 | `.claude/agents/README.md` | Copy from `lineup-backend/.claude/agents/README.md` | Yes |
| 4 | `.claude/agents/code-scanner.md` | Paste § 7h | No |
| 5 | `.claude/agents/refactor-scanner.md` | Paste § 7i | No (the backend file also ends mid-sentence; this one is complete) |
| 6 | `.claude/skills/README.md` | Copy from `lineup-backend/.claude/skills/README.md` | Yes |
| 7 | `.claude/skills/cleanup/SKILL.md` | Paste § 7g | No |
| 8 | `.claude/skills/research/SKILL.md` | Paste § 7f | No |
| 9 | `.claude/skills/feature/SKILL.md` | Paste § 7a | No |
| 10 | `.claude/skills/feature/actions/load.md` | Copy from `lineup-backend/.claude/skills/feature/actions/load.md` | Yes |
| 11 | `.claude/skills/feature/actions/start.md` | Copy from `lineup-backend/.claude/skills/feature/actions/start.md` | Yes |
| 12 | `.claude/skills/feature/actions/review.md` | Paste § 7c | No |
| 13 | `.claude/skills/feature/actions/test.md` | Paste § 7b | No |
| 14 | `.claude/skills/feature/actions/explain.md` | Copy from `lineup-backend/.claude/skills/feature/actions/explain.md` | Yes |
| 15 | `.claude/skills/feature/actions/complete.md` | Copy from `lineup-backend/.claude/skills/feature/actions/complete.md` | Yes |
| 16 | `.claude/skills/todo/SKILL.md` | Copy from `lineup-backend/.claude/skills/todo/SKILL.md` | Yes |
| 17 | `.claude/skills/todo/actions/current.md` | Copy from `lineup-backend/.claude/skills/todo/actions/current.md` | Yes |
| 18 | `.claude/skills/todo/actions/done.md` | Copy from `lineup-backend/.claude/skills/todo/actions/done.md` | Yes |
| 19 | `.claude/skills/todo/actions/list.md` | Copy from `lineup-backend/.claude/skills/todo/actions/list.md` | Yes |
| 20 | `.claude/skills/todo/actions/remaining.md` | Paste § 7e | No |
| 21 | `.claude/skills/todo/actions/spec.md` | Paste § 7d | No |

That is every file in the backend's `.claude/` folder except one. **Don't create `.claude/settings.local.json`.** It is personal and gitignored; Claude Code writes it when you approve a command.

The Neon MCP memory from the backend session does **not** carry over. Sessions keep separate memory, so the branch ids go into `data-contract.md` (§ 6f).

### 7a. `.claude/skills/feature/SKILL.md`

````markdown
---
name: feature
description: Manage current feature workflow - start, review, explain or complete
argument-hint: load|start|review|test|explain|complete
---

# Feature Workflow

Manages the full lifecycle of a feature from spec to merge.

## Working File

@context/current-feature.md

### File Structure

current-feature.md has these sections:

- `# Current Feature` - H1 heading with feature name when active
- `## Status` - Not Started | In Progress | Complete
- `## Goals` - Bullet points of what success looks like
- `## Notes` - Additional context, constraints, or details from spec
- `## History` - Completed features (append only)

## Task

Execute the requested action: $ARGUMENTS

| Action     | Description                                               |
| ---------- | --------------------------------------------------------- |
| `load`     | Load a feature spec or inline description                 |
| `start`    | Begin implementation, create branch                       |
| `review`   | Check goals met, code quality, scraper rules              |
| `test`     | Check for testable logic in parsers, stages and loaders   |
| `explain`  | Document what changed and why                             |
| `complete` | Commit, push, merge, reset                                |

See [actions/](actions/) for detailed instructions.

If no action provided, explain the available options.
````

### 7b. `.claude/skills/feature/actions/test.md`

````markdown
# Test Action

1. Read current-feature.md to understand what was implemented
2. Identify the parsers (`extract/`), stages, schemas, loaders and utilities (`src/`) added or modified for this feature
3. Check if tests already exist for these functions
4. For functions without tests that have testable logic, write unit tests:
   - TypeScript: Vitest, as `*.spec.ts` next to the code
   - Python: pytest, as `extract/tests/test_*.py`
   - Parsers are tested on saved pages in `extract/tests/fixtures/`, never against a live site
   - Pure stages (scoring, gate, aliases, resolution) are tested without mocks
   - Unit tests touch no network and no database; loader tests that need Postgres run against a disposable Neon branch, as a separate command
   - Test happy path and error cases
   - Do not write tests just to write them. Use your best judgement
5. Run `npm test` and `uv run pytest` to verify all tests pass
6. Report test coverage for the new feature code
````

### 7c. `.claude/skills/feature/actions/review.md`

````markdown
# Review Action

1. Read current-feature.md to understand the goals
2. Review all code changes made for this feature
3. Check for:
   - ✅ Goals met
   - ❌ Goals missing or incomplete
   - ⚠️ Code quality issues or bugs
   - 🚫 Scope creep (code beyond goals)
4. Check the scraper rules:
   - No outbound request in `src/`; no Postgres or bucket access in `extract/`
   - Python never normalises a name; raw text stays as fetched (NFC only)
   - Every record written by Python is validated against `schemas/raw/`
   - Output is deterministic: sorted, stable key order, a rerun is byte-identical
   - Slugs come from the crosswalk and are never regenerated
   - Only content tables are written; no competition, season, club, player or match is deleted
   - No `prisma migrate` or `db push`; `db:check` runs before a load
   - Logs and errors print counts and paths, never an XI or an alias list
   - `robots.txt`, the rate limit and the cache are respected
   - Substitutes are never stored as answers (HC 17); no LLM output is used as data (HC 4)
5. Final verdict: Ready to complete or needs changes
````

### 7d. `.claude/skills/todo/actions/spec.md`

````markdown
# Spec Action

Turns a phase into one or more ready-to-implement spec files in `context/features/`.
Writes only spec files — never implements the phase, never edits todo.md.

Usage: `/todo spec` (current phase) or `/todo spec <phase-number>`.

## Selecting the phase

1. If a phase number was given, use that line in todo.md
   - Not found → error and show the valid range
   - Already `- [x]` → say it's complete and ask whether to spec it anyway before writing anything
2. If no number was given, use the current phase (first `- [ ]` line)
   - If every line is `- [x]`, report "All phases complete" and stop
3. If the phase line carries a 🟡 marker, run the `/todo remaining` inspection first and scope the specs to what's actually left, noting the already-done parts under Notes

## Deciding one spec or several

Break the phase into concrete deliverables (spiders, parsers, raw record schemas, transform stages, curation files, dataset files, loader steps, storage uploads, reports, tests). Split into multiple specs when any of these hold:

- Deliverables span layers that are separately buildable and verifiable (e.g. a Python spider + a TypeScript stage + a loader change)
- A later deliverable only makes sense once an earlier one exists (a real dependency, not just a preference)
- More than roughly 8 deliverables, or the work clearly exceeds one focused branch/commit
- Distinct verification stories — one part is proven by unit tests on saved pages, another only by a run on cached data or a load into a Neon branch

Keep it as one spec when the deliverables are a single coherent unit built and verified together. Prefer fewer specs; do not split just to produce more files. Two to four specs is the normal ceiling for a phase — if it looks like more, say so and ask before writing.

Each spec must be independently implementable in order, and each must end in a state where both test suites (`npm test`, `uv run pytest`) and both linters pass.

## File naming

`context/features/phase-s<NN>-<kebab-title>.md` for a single spec, e.g. `phase-s06-fetch-harness.md`.
Split specs get a letter suffix in build order: `phase-s11a-lineup-extract.md`, `phase-s11b-slot-mapping.md`.
If a target file already exists, show what would change and ask before overwriting.

## Spec file structure

**Do not mirror `context/current-feature.md` mechanically.** Shape each spec to what that phase actually needs. The skeleton below is a reference, not a template:

- **Add sections** when the phase calls for them, e.g. `## Records` for raw record shapes, `## Fields` for a source-to-column mapping, `## Data` for curation or fixture inventories, `## Open Questions` for decisions to settle before building, `## Out of Scope` when the boundary is easy to cross
- **Remove or merge sections** that would be empty or filler; e.g. fold a one-line dependency into Notes instead of giving it its own block
- **Keep `## Status`, `## Goals` and `## Notes`.** The `/feature` workflow reads and writes them, and deviations are recorded under `## Notes` per `context/ai-interaction.md`
- Extra sections go between `## Goals` and `## Notes`, ordered however reads best for that phase

Reference skeleton:

```markdown
# Phase <N><letter?> — <Title>

## Status

Not Started

## Goals

- <deliverable — concrete file paths, spiders, stages, dataset files or tables>
- <one bullet per deliverable, in build order>

## Notes

- Scope: <what this spec covers, and for split specs what it explicitly does not>
- Depends on: <previous spec or phase, or "none">
- Constraints: <the hard constraints, data-contract rules and coding standards that actually bite here>
- Verification: <how to prove it works — `npm test`, `uv run pytest`, a run on a small cached sample, a dry run, or a load into a disposable Neon branch followed by a rerun with 0 changes>

## History
```

- If `## History` is kept, leave it empty — it is filled in when the phase completes
- Goals bullets are deliverables, not narration; name real paths (`extract/spiders/mackolik_matches.py`, `src/score/memorability.ts`, `data/dataset/clubs.json`)
- Carry over the relevant hard constraints from `context/project-overview.md`, the rules from `context/docs/data-contract.md` and the coding standards that apply to this phase; do not restate the whole standard
- If the phase ports a backend file, name it (`../lineup-backend/scripts/seed/seed.ts`) and say it is ported by hand, never imported
- If the phase needs a column the schema lacks, stop and say so: that is a backend migration first, not part of this spec
- **Referencing project files is optional — decide per spec.** Point to an existing file (a context doc section, a `data-contract.md` table, a source file the phase extends or mirrors) when it anchors a decision or saves restating detail; leave references out when the spec reads complete without them. Use repo-relative paths, and never add a reference just to have one

## Reporting

Report the files created, one line each with its scope, the intended build order, and remind that implementation starts by copying the first spec into `context/current-feature.md` per the workflow in `context/ai-interaction.md`.
````

### 7e. `.claude/skills/todo/actions/remaining.md`

````markdown
# Remaining Action

1. Read todo.md and find the current phase (first `- [ ]` line)
2. Break that spec into concrete deliverables (spiders, parsers, raw schemas, stages, curation files, dataset files, loader steps, scripts)
3. Inspect the codebase to see which deliverables already exist and work
4. Report each deliverable as:
   - ✅ Done
   - 🟡 Partial — say what's missing
   - ❌ Not started
5. Update that line's partial marker to match what you found — the only write this action makes:
   - Some deliverables done, some not → ensure the line reads `- [ ] 🟡 **Phase N — ...` and set its trailing note to ` — partially done: <one line on what's left>`
   - Nothing started → strip any 🟡 and trailing partial note, leaving a plain `- [ ]` line
   - Everything done → leave the line as-is and say it's ready for `/todo done`; do not check the box here
   - Keep the brackets as `- [ ]` in every case
6. Finish with the shortest path to close out the phase — ordered, actionable steps
7. Do not implement anything — this is a status check, not a build step
````

### 7f. `.claude/skills/research/SKILL.md`

````markdown
---
name: research
description: Run a research task to generate documentation
argument-hint: <prompt-name>
---

## Task

Execute research task: $ARGUMENTS

---

### Instructions

1. If no argument provided, error: "Usage: /research <prompt-name>"
2. Look for prompt file at `context/research/{$ARGUMENTS}.md`
3. If not found, error: "Prompt file not found at context/research/{$ARGUMENTS}.md"
4. Read the prompt file which should contain:
   - **Output**: Where to write results (e.g., `context/docs/source-trial.md`)
   - **Research**: What to investigate
   - **Include**: Specific details to capture
   - **Sources**: What files/tools to use
5. Execute the research using appropriate tools:
   - Read files (the schema copy, `context/docs/data-contract.md`, saved source pages)
   - Read a source's terms of use and `robots.txt` before looking at its data pages
   - Fetch only a handful of pages by hand, slowly; never crawl
   - Query database via Neon MCP if needed (read-only)
   - Search codebase for patterns
6. Write findings to the specified output location
7. Summarize what was discovered

---

### Rules

- This command produces DOCUMENTATION only
- Do NOT modify source code files
- Do NOT create branches or commits
- Never use an LLM's own knowledge as data: every lineup, date or name in a report cites the page it came from
- Output should go to `context/docs/` unless otherwise specified
- Use subagents for thorough exploration if needed
````

### 7g. `.claude/skills/cleanup/SKILL.md`

````markdown
---
name: cleanup
description: Clean up project housekeeping tasks (add "run" to execute fixes)
argument-hint: run|check
---

Review the codebase for cleanup tasks:

1. Make sure that the history in @context/current-feature.md is in order from oldest to newest
2. Find long comment blocks for a statement (more than 1 line or 50 characters), in both `//` and `#` comments
3. Find unnecessary `console.log` statements in `src/` and `print(` calls in `extract/`
4. Find unused imports (`npm run lint` for TypeScript, `uv run ruff check` for Python)
5. Check for stale TODO comments
6. Find orphaned/unused files, including spiders, parsers or stages nothing runs
7. Check that context files match actual project state, including that `prisma/schema.prisma` and `context/docs/data-contract.md` match the backend's current versions
8. Check that `.env` has every variable the Zod env schema in `src/config/` requires and every variable the Scrapy settings read, and no variable neither knows. If something is missing, tell me.
9. Find `@ts-ignore` and `# type: ignore` comments that might be stale
10. Check that nothing under `data/cache/`, `data/raw/`, `data/work/` or `data/reports/` is tracked by git

**Mode: $ARGUMENTS**

If no argument or argument is "check":

- Only report findings, don't modify anything
- List what WOULD be cleaned up

If the argument is "run" or "fix":

- First, report all findings with numbered items
- Then ask: "Which items would you like me to fix? (enter numbers like 1,3,5 or 'all' or 'none')"
- Wait for user response before making any changes
- Only fix the items the user specifies
- Report what you changed
````

### 7h. `.claude/agents/code-scanner.md`

````markdown
---
name: code-scanner
description: Scans the codebase for code quality, security, and performance issues
tools: Read, Glob, Grep
model: sonnet
---

You are a code quality scanner for an offline ETL repo: Python (Scrapy) extracts, TypeScript transforms, validates and loads into Postgres and a bucket.

## Your Task

Scan the codebase and report any issues you find. If no folder is specified, scan the entire codebase. If a folder is specified, scan and report from that folder only.

## What to Look For

### Security

- Exposed secrets, API keys, bucket credentials or database URLs in code or committed files
- SQL injection: `$queryRawUnsafe` / `$executeRawUnsafe` or raw SQL built by string interpolation
- Writes to a non-content table (`users`, `auth_*`, `game_*`, `guesses`, `user_stats`)
- Deletes of competitions, seasons, clubs, players or matches
- `prisma migrate` or `prisma db push` anywhere in scripts or docs
- A load that can reach the `production` branch without the explicit target guard
- An XI or an alias list printed in a log or an error message
- Untrusted page content used as a file path, URL or shell argument without validation

### Scraping conduct

- Requests that bypass `robots.txt`, the rate limit, AutoThrottle or the HTTP cache
- Spiders that fetch beyond the curated competitions, clubs or season range
- An outbound request from `src/`, or Postgres / bucket access from `extract/`

### Data integrity

- Python records written without validation against `schemas/raw/`
- Names normalised in Python, or `normalized` computed anywhere but the ported `normalizeName`
- Slugs generated outside the crosswalk, or changed for an existing entity
- Non-deterministic output: unsorted arrays, `Date.now()` or random values in dataset files
- Substitutes stored as starters; a lineup without exactly 11 starters
- Dataset files not parsed with the Zod dataset schema before loading

### Performance

- One query per row in the loader instead of batched `createMany` / diff-then-write
- Reading a whole partition into memory when a stream would do
- Re-fetching pages the cache already holds
- Giant files that can be broken up into smaller functions

### Code Quality

- Unused variables or imports
- `console.log` or `print(` left in code
- Long comment statements
- Large amount of reduceable comment code
- Missing error handling around file, network, database and bucket operations
- Inconsistent naming conventions (camelCase in TypeScript, snake_case in Python)
- TypeScript `any`; Python `Any` or missing type hints
- Magic numbers (unexplained numeric literals that should be named constants)

### Patterns

- Inconsistent file structure
- Parsers doing I/O, or spiders containing parsing logic
- Stages that are not pure where they could be (scoring, gate, aliases)
- Relative imports instead of the `@/` alias in TypeScript; relative imports in Python
- Hand-edited files under `schemas/raw/` or a stale copy of `prisma/schema.prisma`

## Output Format

Group findings by severity:

### 🔴 Critical

Issues that must be fixed (security, data loss, bugs)

### 🟡 Warnings

Issues that should be fixed (performance, quality)

### 🟢 Suggestions

Nice to have improvements

For each issue:

- **File:** path/to/file.ts
- **Line:** 42 (if applicable)
- **Issue:** Description of the problem
- **Fix:** How to resolve it

End with a summary count.
````

### 7i. `.claude/agents/refactor-scanner.md`

````markdown
---
name: refactor-scanner
description: "Use this agent when you need to scan a codebase for repeated code patterns, duplicated logic, and inline helpers that can be extracted into reusable utility functions. This agent focuses specifically on DRY violations and refactoring opportunities, not security or performance.\n\nExamples:\n\n<example>\nContext: User wants to find duplicated code across their project.\nuser: \"Scan for any repeated code that should be extracted into utility functions.\"\nassistant: \"I'll use the refactor-scanner agent to identify duplicated patterns and suggest utility extractions.\"\n<commentary>\nSince the user wants to find repeated code, use the refactor-scanner agent to perform a focused DRY audit.\n</commentary>\n</example>\n\n<example>\nContext: User wants to clean up before adding new features.\nuser: \"Before I build the next feature, let's clean up any duplicated logic.\"\nassistant: \"Let me use the refactor-scanner agent to find repeated patterns that should be consolidated into shared utilities.\"\n<commentary>\nBefore new feature work, use the refactor-scanner agent to reduce duplication and simplify the codebase.\n</commentary>\n</example>\n\n<example>\nContext: User notices similar code in multiple files.\nuser: \"I feel like I'm writing the same parsing logic in every spider. Can you find all the duplication?\"\nassistant: \"I'll launch the refactor-scanner agent to scan for repeated parsing logic and suggest shared helpers.\"\n<commentary>\nSince the user suspects duplication, use the refactor-scanner agent to find all instances and recommend extractions.\n</commentary>\n</example>"
tools: Glob, Grep, Read, mcp__ide__getDiagnostics
model: sonnet
---

You are an expert code refactoring analyst specializing in identifying duplicated logic, repeated patterns, and extraction opportunities in a two-language ETL codebase: Python (Scrapy spiders and parsers in `extract/`) and TypeScript (transform, validation and load stages in `src/`). Your goal is to find code that violates DRY principles and recommend clean, reusable utility functions.

## Core Principles

1. **Don't Over-Abstract**: Only flag code that is genuinely repeated or would clearly benefit from extraction. Two similar lines is not duplication. If a pattern only appears twice, consider whether extraction actually improves readability.

2. **Verify Duplication**: Confirm the repeated code actually exists in multiple locations before reporting. Include exact file paths, line numbers, and code snippets.

3. **Respect Context**: Similar-looking code may serve different purposes. Ensure the logic is truly the same before recommending extraction.

4. **Stay Inside One Language**: Never suggest sharing code between Python and TypeScript. The only interface between them is `schemas/raw/`.

5. **Provide Complete Solutions**: Every finding must include the suggested utility function implementation and how each call site would be refactored.

## What To Scan For

### Parsing (Python)

- Repeated selector logic for the same page element across spiders or parsers
- Repeated date, score, minute or stage-text parsing
- Repeated text cleanup (whitespace, NFC, stripping labels)
- Repeated record construction (`source`, `sourceId`, `sourceUrl`, `fetchedAt`)

### String & Data Formatting (TypeScript)

- Slug construction or disambiguation repeated outside the crosswalk helpers
- Repeated date or season-label handling
- Stage, competition or club name mapping repeated across stages

### Validation & Parsing (TypeScript)

- Repeated Zod schemas or validation logic
- Repeated NDJSON or JSON file reading and parsing
- Type guards used in multiple places
- Error message formatting (paths, never values)

### Data Transformations

- Array grouping, sorting or keying patterns (by slug, by competition-season)
- Repeated deterministic-output writing (sort, stable keys, 2-space JSON)
- Repeated .map/.filter/.reduce chains doing the same thing

### Error Handling

- Repeated try/catch patterns around file, database or bucket operations
- Repeated retry or backoff logic

### Database & Storage Patterns

- Repeated diff-then-write logic per table that the loader's generic `sync` should cover
- Repeated Prisma query patterns
- Repeated key construction or upload logic for bucket objects

## Output Format

Group findings by type, ordered by impact:

### 🔵 HIGH IMPACT

Duplication that exists in 3+ locations or involves complex logic worth extracting.

### 🟢 MODERATE IMPACT

Duplication in 2 locations or simpler patterns that would benefit from extraction.

### ⚪ OPTIONAL

Minor patterns that could be extracted but are borderline — note the tradeoff.

For each finding, provide:

- **Pattern:** What is repeated, in one line
- **Locations:** Every file path and line range where it appears
- **Snippet:** The repeated code, from one location
- **Suggested utility:** The full helper, its name and where it should live
- **Call sites:** How each location looks after the refactor
- **Tradeoff:** Anything that argues against extracting it

End with a summary count per impact level.
````

### 7j. `.claude/settings.json`

Every crawl and every load still asks first: `scrapy crawl`, `npm run load` and the bucket upload are not pre-allowed.

````json
{
  "permissions": {
    "allow": [
      "mcp__claude_ai_Context7__query-docs",
      "mcp__claude_ai_Context7__resolve-library-id",
      "mcp__neon__describe_project",
      "mcp__neon__list_branches",
      "mcp__neon__describe_branch",
      "mcp__neon__get_database_tables",
      "mcp__neon__describe_table_schema",
      "Bash(npx vitest *)",
      "Bash(npx oxlint *)",
      "Bash(npx prettier *)",
      "Bash(npx tsc *)",
      "Bash(npm test *)",
      "Bash(npm run lint *)",
      "Bash(npm run db:check *)",
      "Bash(npm view *)",
      "Bash(uv run pytest *)",
      "Bash(uv run ruff *)",
      "Bash(uv run mypy *)"
    ]
  }
}
````


---

## 8. Step 6: `context/todo.md`

```markdown
# Lineup — Scraper Build Phases

Phase IDs use the `S` prefix. Line order is build order; the current phase is the first `- [ ]` line.

Workflow per phase: `/todo current` → `/todo spec` → `/feature load <spec>` → `/feature start` → `/feature review` → `/feature test` → `/todo done` → `/feature complete`.

This todo file is for developer-side use.

## Scraper

- [ ] **Phase S01 — Repo & Scaffold**: npm TypeScript and uv Python projects side by side, lint, format, tests, `data/` layout.
- [ ] **Phase S02 — Source Trial**: Terms, robots.txt and field coverage of Mackolik and alternatives on 20 matches. (was P01)
- [ ] **Phase S03 — Schema Copy & Targets**: `schema.prisma` copy, Prisma client, `db:check` drift guard, Neon targets.
- [ ] **Phase S04 — Dataset Schema**: Zod schema for the final dataset, ported `normalizeName`, mirrors of every DB CHECK.
- [ ] **Phase S05 — Raw Record Contract**: Zod raw records exported to JSON Schema, validated by Python before writing.
- [ ] **Phase S06 — Fetch Harness**: Scrapy with disk cache, robots.txt, auto-throttle, retries, fixture-tested parsers. (was B15)
- [ ] **Phase S07 — Match Metadata Extract**: Fixtures, scores, dates, stages and competitions across the season range. (was B16)
- [ ] **Phase S08 — Entity Resolution**: Clubs, competitions, seasons and players deduped into permanent slugs. (was B17)
- [ ] **Phase S09 — Cultural Footprint**: Wikipedia and Wikidata articles, pageviews and match nicknames. (was B18)
- [ ] **Phase S10 — Memorability Engine**: Signal scoring with era-bucket normalisation, the shortlist, pure and tested. (was B19)
- [ ] **Phase S11 — Lineup Extract**: Starting XIs, formations, positions and events for the shortlist only. (was B20)
- [ ] **Phase S12 — Alias Sets**: Full, common, surname, mononym, nickname and transliteration aliases, with curation.
- [ ] **Phase S13 — Guessability Gate**: All 11 starters resolved with alias sets; writes `sides` guessability. (was B21)
- [ ] **Phase S14 — Dataset Build**: Assemble, validate and write the committed dataset, deterministic, with a manifest.
- [ ] **Phase S15 — DB Loader**: Idempotent diff-sync into a chosen Neon branch, chunked, dry run, counts only.
- [ ] **Phase S16 — Pool QA Report**: Pool size and coverage gaps per competition, era and club. (was B22)
- [ ] **Phase S17 — Storage Client**: Bucket choice, content-hash key scheme, idempotent uploads. (was half of B23)
- [ ] **Phase S18 — Image Ingest**: Licence check, attribution, upload, then `crest_key` and `image_key`. (was B24)

---

## Deferred

- New league and season packs, once the pipeline is cheap to extend
- Collecting real misspellings from live play into aliases (needs a backend export first)
```

### Notes for speccing each phase

| Phase | What its spec must settle |
| --- | --- |
| **S01** | Repo layout as in § 12. `pyproject.toml` with ruff, mypy and pytest config; `.python-version` 3.13. `package.json` scripts; `tsconfig` with `@/` (no decorators; port the backend's, minus the Nest options). Vitest, oxlint (`no-explicit-any`, `no-floating-promises`), Prettier (same `.prettierrc`). `.gitignore` per § 12. A no-op stage in each language proves the wiring |
| **S02** | Use `/research`. For each candidate (Mackolik, API-Football, StatsBomb Open Data, Wikipedia, openfootball, others), cover: terms of use, `robots.txt`, and whether pages are static or JS-rendered. Pick 20 matches from 2001, 2006, 2011 and 2019 and check which fields exist: XI, formation, positions, goal minutes, cards, half-time score, extra time, penalties, stage, and player ids that stay stable. Write the report to `context/docs/source-trial.md`. **It decides the sources, the season range, and Scrapy vs plain httpx.** If the 2000s fail, the season range changes in the backend contract first (backend, then web, then mobile) |
| **S03** | Copy `schema.prisma` verbatim (keep `output`, ESM, `js` extension). `prisma.config.ts` with no `migrations` block. Add `db:check`: `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`, where exit 2 means drift. CHECKs aren't in `schema.prisma`, so S04 mirrors them. A Zod env schema (`DATABASE_URL`, `LOAD_TARGET`) with fail-fast. Create the Neon `ingest` branch (§ 9) |
| **S04** | Port `scripts/seed/seed-data.schema.ts`, then extend it with what the seed left out: club `kind` set explicitly (the seed guesses it from a `nat-` slug prefix), `club_aliases`, `match_events`, `extraTime`, shootouts, image keys and scores. Port `src/game/normalize.ts` and **all** of its spec cases. Port `formationSchema`, the enums and the constants. Validation errors name paths, never values |
| **S05** | `src/raw/*.ts` defines one schema per record kind; `npm run schemas` writes `schemas/raw/*.schema.json`. A Vitest case fails if the committed files are stale. Python validates with `jsonschema` (Draft 2020-12). Every record carries `source`, `sourceId`, `sourceUrl` and `fetchedAt` |
| **S06** | Scrapy settings: `HTTPCACHE_ENABLED` (to `data/cache/`), `ROBOTSTXT_OBEY`, AutoThrottle, a concurrency of 1 per domain, an honest `USER_AGENT` with contact details, retries with backoff. Add `scrapy-playwright` only if S02 found JS-rendered pages. Records are NDJSON in `data/raw/<source>/<kind>/<partition>.ndjson` |
| **S07** | Only the competitions and clubs in the spec's curated set. Partition by competition and season so a rerun can target one. Translate the source's stage text into English display text (e.g. "Yarı Final" to "Semi-final", "34. Hafta" to "Matchday 34") in TypeScript, using a mapping file |
| **S08** | The crosswalk (`data/curation/crosswalk/*.json`) maps every source id to one slug, forever. **Display names come from a canonical source** (e.g. the Wikidata English label), not from the Turkish site. Mackolik may write "Şevçenko" or "Bayern Münih"; those become **aliases**, which helps Turkish players. Disambiguate same-name players with a birth year in the slug (`ronaldo-1976`). Club `shortName` follows the web's length rule (Step 2) |
| **S09** | Python fetches article existence, pageviews and nicknames from Wikipedia and Wikidata. Their APIs, not HTML scraping, and attribution kept. TypeScript turns them into a signal |
| **S10** | Port `ERA_BUCKETS` from the backend's `pool-rules.ts`. Signals: stage, rivalry, drama, stakes, star power and footprint, normalised within each era bucket. The output fills `memorability_scores` (`score` 0–100, `signals` JSON with per-signal values **and** the `sides` block, `algorithmVersion`, `computedAt`). The **shortlist** is what S11 fetches lineups for. `POOL_THRESHOLD` stays the backend's constant: S10 and S16 copy its values, and a retune is a backend change first |
| **S11** | Starting XI only; substitutes are never stored (HC 17). Map the source's formation and positions to **slots**: 0 is the GK, then the lines from defence to attack, filled right to left, each `position` agreeing with its line. Check every formation against the web's list (Step 2). If the source has no formation, the spec must decide how to infer one, or exclude the match |
| **S12** | For each player: full name, common name, surname, mononym and nickname, plus source spellings and transliterations (Turkish, Slavic, Nordic). Report same-surname clashes inside each XI; B29 resolves them at runtime, but QA should see them. Manual additions go in `data/curation/aliases.json`. Short names (Kaka, Pepe, Xavi) need exact aliases: the backend's fuzzy threshold doesn't reach them (B28 notes) |
| **S13** | A pure gate: 11 starters, each with a player record and at least one alias that normalises to a name. Writes `sides.{home,away}.guessability` (0–1). A match that fails is excluded and reported, never loaded with a score |
| **S14** | `data/dataset/`: `competitions.json`, `clubs.json`, `players.json` (with aliases), `matches/<competition>/<season>.json`, `scores.json`, `images.json`, `manifest.json` (counts, algorithm version, source list, schema hash). The whole dataset passes the S04 schema before anything is written |
| **S15** | Port `scripts/seed/seed.ts` and `main.ts`: diff-then-write keyed on slugs, lineups replaced per side, counts-only output. Changes from the seed: **one transaction per competition-season**, so about 3,000 matches don't hit one transaction's timeout, and a rerun resumes. A `--dry-run` that prints the planned creates, updates and deletes. `db:check` first. A target guard: `production` needs `--target production --confirm`. Uses a restricted DB role (§ 9) |
| **S16** | Counts per competition × era bucket × club at the backend's threshold; gate failures by reason; draws are likely when squads are famous (spec § Resolved Decisions). Written to `data/reports/` |
| **S17** | Pick the bucket (R2 has free egress; Supabase Storage and B2 also fit). Keys are `crests/<club-slug>/<sha256-12>.<ext>` and `players/<player-slug>/<sha256-12>.<ext>`, immutable and cacheable forever. Upload before writing the key; never delete an object the database still references |
| **S18** | Python downloads images and their licence metadata. TypeScript checks the licence against an allow-list (CC0, public domain, CC BY, CC BY-SA), converts to the web's formats and sizes, uploads, then writes `crest_key` and `image_key`. At MVP, prefer Wikimedia Commons or generated initials; crests are trademarks (spec § Data Architecture). **Blocked on the attribution decision in § 11** |

---

## 9. The database: rules the loader lives by

### Tables

| Writes (content) | Never writes |
| --- | --- |
| `competitions`, `seasons`, `clubs`, `club_aliases`, `players`, `player_aliases`, `matches`, `match_teams`, `lineups`, `match_events`, `memorability_scores` | `users`, `auth_*`, `game_sessions`, `game_participants`, `game_rounds`, `guesses`, `user_stats` |

### Deletes

`game_sessions → matches`, `lineups → players`, `guesses → players` and `memorability_scores → matches` are all `ON DELETE RESTRICT`. So:

- **Never delete** a competition, season, club, player or match.
- **To retire a match** from the pool, delete its `memorability_scores` row. In production the selector only plays scored matches.
- Aliases, club aliases, a match's events and a side's lineup may be replaced. Changing the XI of a match someone already played rewrites what their history means, so the dry run must flag it.

### Schema changes

1. The scraper finds it needs a column (e.g. image attribution).
2. **The backend phase** writes the migration and deploys it to every Neon branch.
3. The backend session regenerates `scraper-data-contract.md`.
4. The scraper copies `schema.prisma` and `data-contract.md`, and `db:check` passes.

This is the same rule as for contract changes: the backend ships first.

### Neon branches

| Branch | Id | Holds | Scraper use |
| --- | --- | --- | --- |
| `production` | `br-square-feather-b17d6fhc` | **No tables yet** (checked 2026-10-24): no migration has been deployed to it; backend B45 does that | Nothing can load here before B45. After that, only on an explicit instruction, after a clean dry run |
| `dev` | `br-noisy-queen-b1lzkl00` | The full schema and the B09 mock seed; the backend's tests run here | Don't load real data here yet (§ 11) |
| `ingest` (new, S03) | — | Real data while the pipeline is built | The default target. Branch it from `production` so it has no mock data, **then deploy the migrations to it**: from `lineup-backend`, `npm run db:deploy` with `DATABASE_URL` set to the `ingest` connection string. Branching from `production` alone gives an empty database |
| disposable | — | Throwaway | Loader e2e tests, deleted afterwards |

Every later migration must also be deployed to `ingest` (`npm run db:deploy` with that branch's URL). That is part of the backend phase that writes it. The full branch rules are in `data-contract.md` § 10.

### A restricted role

In S15, create a Neon role such as `lineup_loader` with `SELECT, INSERT, UPDATE, DELETE` on the content tables only and nothing on the rest. A bug then can't touch user data, whatever the code does. `db:check` needs read access to the catalog, which every role has.

### Volume

About 3,000 matches is roughly 66,000 lineup rows, 15,000–20,000 players and 60,000+ aliases, well inside Neon's free plan. One transaction per competition-season keeps each one small.

---

## 10. Backend and web follow-ups this creates

None of these are part of the scraper setup. Each is its own phase in its own repo, in this order.

### Backend (this repo)

| When | Work |
| --- | --- |
| Now (Step 1) | Spec edits § 3. In `todo.md`, **only when told**: replace B15–B22, B24 and P01 with one line pointing to the scraper's S-phases, and rename B23 (next row) |
| Now | **`scraper-data-contract.md`** (§ 6f) |
| Before S15 | **Alias check script:** `npm run db:check-aliases` recomputes `normalizeName(alias)` for every `player_aliases` row and reports any row where it differs from `normalized`. It is the guard on the scraper's ported normaliser. Run it after every load |
| Before S18 | **Attribution migration**, if § 11 decides credits are stored (e.g. `image_credit`, `image_licence`, `image_source_url` on `players` and `clubs`). If credits must be shown, this is also a contract change: backend, then web, then mobile |
| After S17 | **B23 becomes "Image URLs":** an `ASSET_BASE_URL` env var. `crest_key` and `image_key` become absolute URLs in `match-refs.ts`, `squad-loader.service.ts` and the history and profile views. Today they always send `null` |
| If S02 or S07 need it | New `CompetitionKind` values (e.g. a domestic cup) or a different season range. These are contract changes: backend, then web, then mobile |
| After the first real load | **B26 Indexes**, measured on real data. **B25:** turn `MATCH_POOL_INCLUDE_UNSCORED` off for the real pool and retune `POOL_THRESHOLD`. **B28:** retune the fuzzy threshold on real names. **B29:** check real surname clashes. **B43:** rerun the harness on real matches (all listed in `build-order.md` § Revisit) |

### Web

| When | Work |
| --- | --- |
| Now | Step 2's prompt. Copy the three shared files (Step 1); update `CLAUDE.md` |
| After backend B23 | Tighten `imageUrlSchema` to absolute URLs only (the W27 watch-out) |
| If credits are shown | Render the attribution |

### Mobile

When `lineup-mobile` is created, it gets the four-repo versions of the shared files.

---

## 11. Open decisions

| # | Decision | Decide in | Recommendation |
| --- | --- | --- | --- |
| 1 | **Is scraping Mackolik allowed?** Read its terms and `robots.txt`. Also note that systematic extraction from a database can be restricted by database rights in the EU and Turkey even when single facts are free. This guide can't answer that legally, so check it before scraping at scale | S02 | If the terms forbid it, use an API with a licence (API-Football) for lineups and Mackolik only for manual checks, as the spec already treats FBref |
| 2 | Season range: does coverage of 2000–2010 hold? | S02 | If not, launch from 2008–09 and ship the 2000s later as a Classics pack (spec § Ingestion) |
| 3 | Where does real data live during development? | S03 | A new `ingest` branch. Keep `dev` for the mock seed and the backend's tests, then decide later whether `dev` gets real data |
| 4 | What happens to the mock seed? | After the first real load | Keep it on `dev` only. It never goes into `ingest` or `production` (its slugs, like `club-northgate`, don't collide with real ones) |
| 5 | Image attribution: stored? shown? | Before S18 | Store it (backend migration). Show it if any CC BY or CC BY-SA image is used, since those licences require it |
| 6 | Images at all for the MVP? | S18 | Crests are trademarks and press photos are copyrighted. Initials or Commons images first, per the spec |
| 7 | Formations the source gives but the pitch view can't draw | S11, after Step 2 | Map them to the nearest supported shape, or exclude the match. Never send an unsupported shape |
| 8 | Seasons the date rules reject: 2019–20 club seasons ended in August 2020; Euro 2020 was played in 2021; the 2026 World Cup needs `start_year` 2026, which the database CHECK refuses (`data-contract.md` § 6.4) | S04 | Allow documented exceptions in the scraper's `seasonIssue` port for the first two (they're seed-schema rules, not DB rules). The 2026 World Cup waits for a backend migration and a season-range contract change, or stays out |

---

## 12. Final repo shape

```text
lineup-scraper/
├── CLAUDE.md
├── .claude/              skills: feature todo research cleanup · agents: code-scanner refactor-scanner
├── .mcp.json             Neon
├── context/
│   ├── project-overview.md          identical in all four repos
│   ├── coding-standards.md          shared
│   ├── coding-standards-scraper.md
│   ├── ai-interaction.md            shared
│   ├── current-feature.md
│   ├── todo.md                      S-phases
│   ├── README.md
│   ├── docs/
│   │   ├── data-contract.md         from the backend session
│   │   ├── data-display-requirements.md   from the web session
│   │   ├── scraper-repo-setup.md    this file
│   │   ├── build-order.md
│   │   ├── source-trial.md          S02
│   │   └── backend-specs/           read-only copies
│   ├── features/  fixes/  research/
├── package.json  tsconfig.json  vitest.config.ts  .oxlintrc.json  .prettierrc  .prettierignore
├── pyproject.toml  uv.lock  .python-version  scrapy.cfg
├── prisma/schema.prisma            copy of the backend's; no migrations/
├── prisma.config.ts                no migrations block
├── schemas/raw/*.schema.json       generated from src/raw; the Python↔TS interface
├── extract/                        Python: spiders/ parsers/ records.py settings.py tests/
├── src/                            TypeScript: raw/ names/ resolve/ aliases/ score/ gate/
│                                   dataset/ load/ storage/ qa/ db/ config/
└── data/
    ├── cache/        ✗ gitignored   Scrapy HTTP cache (back it up; it's what makes reruns free)
    ├── raw/          ✗ gitignored   NDJSON records and image files from Python
    ├── work/         ✗ gitignored   intermediate stage output
    ├── reports/      ✗ gitignored   QA reports
    ├── curation/     ✓ committed    crosswalk, merges, display names, extra aliases, exclusions
    └── dataset/      ✓ committed    the final validated dataset the loader reads
```

`.prettierignore` and the oxlint ignore list both include `data/`, `context`, `.claude` and `*.md`. Ruff excludes `src/` and `node_modules/`.

---

## 13. Step 7: commit the setup

```bash
git add -A
git commit -m "chore: add context, workflow skills and project docs"
git push -u origin main
```

Open the repo in Claude Code and run `/todo current`. It should report **Phase S01 — Repo & Scaffold**.

---

## 14. The per-phase loop

The same as in the other repos:

| Command | What happens |
| --- | --- |
| `/todo current` | Names the next phase |
| `/todo spec` | Writes `context/features/phase-sNN-….md`. Read it, and change it before loading |
| `/feature load <spec>` | Copies it into `current-feature.md`; asks the open questions |
| `/feature start` | Creates `feature/<name>` and implements |
| `/feature review` | Goals, code quality, scope, and the scraper checks from § 7 |
| `/feature test` | Vitest and pytest where there's real logic |
| `/todo done` | Ticks the phase |
| `/feature complete` | Commits after you approve, merges to `main`, deletes the branch, pushes once |

**How a scraper phase proves it works:**

- `npm test`, `uv run pytest`, `npm run lint`, `uv run ruff check`, `uv run mypy extract`
- The stage, run on one competition-season from the cache, with its output read by eye
- For S15 and after: a dry run, a load into a disposable branch, then a rerun that reports **0 changed**, then `db:check-aliases` from the backend

---

## Checklist

- [x] § 3, 1a–1c: shared spec updated in the backend
- [ ] § 3: the three shared files copied by hand into web; 1d and 1e done (both `CLAUDE.md` files list the scraper)
- [ ] § 4: web prompt run; `data-display-requirements.md` exists in lineup-web
- [ ] § 6f: backend session wrote `scraper-data-contract.md`
- [ ] uv installed, Python 3.13 available
- [ ] Repo created, **private**, remote set (§ 5)
- [ ] § 6: the 6 context folders and all 25 files created (11 and 12 once their sources exist)
- [ ] § 7: the 9 `.claude` folders and all 21 files created, including `.mcp.json` and `settings.json`
- [ ] Setup committed; `/todo current` reports S01
