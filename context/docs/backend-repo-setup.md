# Backend Repo Setup — `lineup-backend`

A step-by-step guide to creating the NestJS backend repo. It ends with an empty but fully wired repo, ready for `/todo current`.

You'll do steps 1–9 once, in order. Step 10 is the loop you repeat for every phase.

---

## Before you start

| Need | Check | Notes |
| --- | --- | --- |
| Node **v22.22.3+** (or v24.15+) | `node -v` | Nest 12's generators refuse older versions. This machine has v22.22.3, which is enough. |
| npm **11+** | `npm -v` | npm 10 crashes installing Nest 12's Vitest (`Cannot read properties of null (reading 'edgesOut')`). Upgrade with `npm i -g npm@11`; under nvm this needs no `sudo`. |
| Git and GitHub CLI | `git --version`, `gh --version` | `gh auth status` should show you logged in. |
| Claude Code | — | Same setup as for `lineup-web`. |

Not needed yet: the Neon, Railway or Fly, Upstash, bucket and API-Football accounts. Their phases ask for them.

Both repos sit side by side:

```text
~/Desktop/lineup/
├── lineup-web/        exists
└── lineup-backend/    you create this
```

---

## Step 1 — Scaffold the NestJS app

```bash
cd ~/Desktop/lineup
npx @nestjs/cli@latest --version   # expect 12.x
npx @nestjs/cli@latest new lineup-backend --package-manager npm --skip-git --no-observe
```

If the scaffold ends with **"Packages installation failed!"**, the files are already written and only the install failed. Run `cd lineup-backend && npx npm@11 install`, then continue.

Use `npx`, not a global install. An old global `nest` (e.g. 10.x under `/usr/local`) can shadow a newer one and scaffold the wrong version. After scaffolding, the project carries its own CLI, so `npx nest …` inside `lineup-backend/` always runs the right version.

When it asks for the **module system**, choose **ESM**. That gives you Vitest, the same test runner as the web repo. Nest 12's own packages are ESM-only, so ESM is also the path with the fewest workarounds.

| Flag | Why |
| --- | --- |
| `--skip-git` | You run `git init` yourself in Step 2, so the first commit is clean. |
| `--no-observe` | The spec uses Sentry for observability (B44), not NestJS Observe. |

The scaffold already gives you strict TypeScript, Vitest, oxlint and Prettier. Check that it runs:

```bash
cd lineup-backend
npm run build
npm test
npm run lint
```

**Leave the generated code alone.** B01 cleans it up through the normal workflow (Step 10).

---

## Step 2 — Create the git repo and push

```bash
git init -b main
gh repo create lineup-backend --private --source . --remote origin
git add -A
git commit -m "chore: scaffold NestJS app"
git push -u origin main
```

Never add a "Co-authored by Claude" line to a commit, here or later.

---

## Step 3 — Copy the context files

Run from `lineup-backend/`:

```bash
WEB=../lineup-web

mkdir -p context/docs context/features context/fixes

# Copy unchanged
cp $WEB/context/project-overview.md  context/
cp $WEB/context/coding-standards.md  context/
cp $WEB/context/ai-interaction.md    context/
cp $WEB/context/monetization.md      context/
cp $WEB/context/docs/mock-to-backend-map.md context/

# Copy, then edit (Step 4)
cp $WEB/context/todo.md    context/
cp $WEB/context/README.md  context/
```

### What goes in, and what doesn't

| File | In the backend repo? | How |
| --- | --- | --- |
| `project-overview.md` | ✅ | **Unchanged.** It must stay identical in all three repos. |
| `coding-standards.md` | ✅ | Unchanged. These are the shared rules. |
| `ai-interaction.md` | ✅ | Unchanged. It already says how to test a backend. |
| `monetization.md` | ✅ | Unchanged. Entitlements and webhooks are backend work. |
| `mock-to-backend-map.md` | ✅ | Unchanged. It maps each phase to the mock behaviour it replaces. |
| `todo.md` | ✅ | Edit: backend part only (Step 4). |
| `README.md` | ✅ | Edit (Step 4). |
| `current-feature.md` | ✅ | New and empty (Step 4). |
| `coding-standards-backend.md` | ✅ | **New** (Step 5). |
| `api-contract.md` | ✅ | **New** (Step 6). |
| `theme.md`, `design.md` | ❌ | UI only. |
| `coding-standards-web.md` | ❌ | Web only. |
| `screenshots/`, `features/`, `fixes/` contents | ❌ | Web history. Only the empty folders go across. |
| `docs/prompt-*.md` | ❌ | Design-tool prompts. |
| `AGENTS.md` | ❌ | It points at Next.js docs. |

---

## Step 4 — Edit the copied files

### 4a. `context/todo.md` — keep only the backend part

1. **Delete** `## Part 1 — Web (Next.js)` and all its lines.
2. **Rename** `## Part 2 — Backend (NestJS) **All Disabled To Modify**` to `## Backend (NestJS)`.
3. **Keep** `## Prerequisite` (P01) and `## Deferred` unchanged.
4. **Replace the intro** at the top with:

   ```markdown
   # Lineup — Backend Build Phases

   Phase IDs use the `B` prefix. Line order is build order; the current phase is the first `- [ ]` line.

   Workflow per phase: `/todo current` → `/todo spec` → `/feature load <spec>` → `/feature start` → `/feature review` → `/feature test` → `/feature complete`.

   This todo file is for developer-side use.
   ```

5. **Fill the catalog gap.** No phase serves the web's filter options (`getFilterOptions`). Add this line right after B25:

   ```markdown
   - [ ] **Phase B25b — Catalog Endpoint**: Filter options (competitions, clubs, era range) from the pool.
   ```

### 4b. `context/current-feature.md` — start empty

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

### 4c. `context/README.md`

Paste the ready-made file from `lineup-web/context/docs/backend-context-readme.md`. It contains:

- **Loaded on startup:** `project-overview.md`, `coding-standards.md`, `coding-standards-backend.md`, `ai-interaction.md`, `current-feature.md`, `monetization.md`, `todo.md`.
- **Read on demand:** `api-contract.md`, `mock-to-backend-map.md`, `docs/`, `features/`, `fixes/`, `research/`.
- No mention of `theme.md`, `design.md`, `screenshots/` or `coding-standards-web.md`.

### 4d. `CLAUDE.md` at the repo root

Create `CLAUDE.md`:

````markdown
# Lineup — Backend

Know the XI. Beat the Clock.

## Architecture

Three separate repositories, one backend:

| Repo             | Stack             | Role                                                   | Deploys to        |
| ---------------- | ----------------- | ------------------------------------------------------ | ----------------- |
| `lineup-backend` | NestJS            | REST, auth, Socket.IO, Prisma, rules engine, ingestion | Railway / Fly.io  |
| `lineup-web`     | Next.js           | Browser client — renders and transmits input           | Vercel            |
| `lineup-mobile`  | Expo React Native | iOS + Android client — renders and transmits input     | EAS → both stores |

**This repo.** It owns the API contract, documented via OpenAPI. The clients transcribe it by hand.

**No code is shared between repos.** No package, no submodule, no cross-repo import. This repo must build with the other two deleted.

## Context Files

- @context/project-overview.md
- @context/coding-standards.md
- @context/coding-standards-backend.md
- @context/ai-interaction.md
- @context/current-feature.md
- @context/monetization.md

`project-overview.md` is the shared spec and must stay identical in all three repos.

@context/todo.md is for developer-side use. **Do not modify the project context based on this file.**

## Commands

Port is fixed so the web app (3000) and the backend (3001) run side by side.

- **Dev server**: `npm run start:dev` (http://localhost:3001)
- **Build**: `npm run build`
- **Test**: `npm test`
- **Lint**: `npm run lint`
- **Migrate**: `npx prisma migrate dev`

**IMPORTANT:**

- **Do not add 'co-authored by Claude'** to any commit message
- History entries in `current-feature.md` must not exceed 75 characters
- Do not edit `todo.md` unless told to via prompt or skill
- When a phase completes, ask to tick it in `todo.md` in the same commit
- No game logic outside `src/game/` — it is pure and imports nothing from NestJS or Prisma
- The squad is never sent to a client, logged, or put in an error message
- Never trust a client-supplied user id, tier, life count or elapsed time
````

---

## Step 5 — Write `context/coding-standards-backend.md`

`coding-standards.md` already refers to this file, so every phase spec reads it. Create it with this starter, then refine it as phases settle things:

```markdown
# Coding Standards — Backend (NestJS)

For `lineup-backend`. Read alongside `coding-standards.md`, which always applies.

## Layout

- One NestJS module per domain under `src/` (`auth`, `users`, `catalog`, `matches`, `solo`, `duel`, `storage`).
- `src/game/` is the rules engine: pure TypeScript, **no NestJS, no Prisma, no I/O**. Every function is unit tested.
- `src/contract/` holds the Zod schemas for every request, response and socket payload, plus `PROTOCOL_VERSION`.
- `src/config/` parses the environment with Zod at boot and fails fast.
- `scripts/ingest/` is offline tooling. `src/` never imports it.

## Controllers and services

- Controllers stay thin: validate, call one service, return.
- Every response uses the result envelope the clients expect: `{ success: true, data }` or `{ success: false, error: { code, message, retryAfterMs, emptyBecause? } }`. The error codes are listed in `api-contract.md`.
- Validate every body, query and socket payload with the `src/contract/` Zod schemas. Types come from `z.infer`.

## Data

- Prisma is the only database access, through `PrismaService`.
- Migrations only through `prisma migrate`. Never edit an applied migration.
- Postgres is the record. Redis or in-memory state is only what is safe to lose.

## Realtime

- One Socket.IO gateway. Every handshake checks a JWT and `PROTOCOL_VERSION` (N and N-1).
- The server owns the clock: payloads carry `startedAt` and `endsAt` timestamps.

## Testing

- Vitest. Tests sit next to the code as `*.spec.ts`.
- `src/game/` must be covered: timer, lives, turns, round resolution, normalisation, matching, collisions.
- Unit tests touch no network and no database. E2E and the two-client harness live in `test/` and run as separate commands.

## Errors and logs

- Never leak a stack trace, SQL or provider response to a client.
- Never log the squad.
```

---

## Step 6 — Add `context/api-contract.md`

This is the contract the web app already expects, as **text**, not code. B03 builds the backend's Zod schemas from it. After B03, the backend owns the contract.

Make it in the **web** repo with Claude, using this prompt:

> Write `context/docs/contract.md` from `src/lib/api/schemas/`, `src/lib/api/client.ts` and `src/lib/api/duel-client.ts`. List every REST call (method, path suggestion, request, response) and every socket event in `DuelEventMap`, with each payload's fields and types. Include the result envelope, the error codes, `matchInPlaySchema`, and `imageUrlSchema`'s rules. Plain Markdown tables, no code to import.

Then copy it across:

```bash
cp ../lineup-web/context/docs/contract.md context/api-contract.md
```

---

## Step 7 — Copy the `.claude` folder

```bash
WEB=../lineup-web
mkdir -p .claude/skills .claude/agents

cp -R $WEB/.claude/skills/feature  .claude/skills/
cp -R $WEB/.claude/skills/todo     .claude/skills/
cp -R $WEB/.claude/skills/research .claude/skills/
cp -R $WEB/.claude/skills/cleanup  .claude/skills/
cp    $WEB/.claude/skills/README.md .claude/skills/

cp $WEB/.claude/agents/code-scanner.md     .claude/agents/
cp $WEB/.claude/agents/refactor-scanner.md .claude/agents/
cp $WEB/.claude/agents/README.md           .claude/agents/
```

**Don't copy** the `frontend-design` skill, the `ui-reviewer` agent, `settings.json`, `settings.local.json` or `.mcp.json`. They only cover the browser and Playwright.

### Five edits

| File | Change |
| --- | --- |
| `skills/feature/actions/start.md` | Delete step 5, the one that loads `frontend-design`. |
| `skills/todo/actions/spec.md` | **Naming:** `phase-<NN>-<kebab-title>.md` becomes `phase-b<NN>-<kebab-title>.md` (e.g. `phase-b01-repo-scaffold.md`, split: `phase-b13a-…`). |
| `skills/todo/actions/spec.md` | **Verification line:** "what to click in the browser" becomes "call it with an HTTP client, or drive the socket harness". |
| `skills/todo/SKILL.md` | In `description:`, "LegacyRun" becomes "Lineup". |
| `skills/README.md`, `agents/code-scanner.md` | Remove the `frontend-design` line. In the scanner, "Next.js application" becomes "NestJS service", and add Prisma, auth guard and socket handshake checks. |

---

## Step 8 — Match the formatting with the web repo

Use the same Prettier style in both repos:

```bash
cp ../lineup-web/.prettierrc .prettierrc
```

Keep docs out of formatting, as in web. Add these lines to `.prettierignore` (create it if missing):

```text
context
.claude
*.md
```

Then run `npm run format`.

---

## Step 9 — Commit the setup

```bash
git add -A
git commit -m "chore: add context, workflow skills and project docs"
git push
```

Open the repo in Claude Code and run `/todo current`. It should report **Phase B01 — Repo & Scaffold**.

---

## Step 10 — The per-phase loop

Repeat this for every phase, exactly as in `lineup-web`:

| Command | What happens |
| --- | --- |
| `/todo current` | Names the next phase (the first `- [ ]` line). |
| `/todo spec` | Writes `context/features/phase-bNN-….md`. Read it and change it before loading. |
| `/feature load <spec>` | Copies the spec into `current-feature.md`. |
| `/feature start` | Creates `feature/<name>` and implements. |
| `/feature review` | Checks goals, code quality and scope. |
| `/feature test` | Adds unit tests where there is real logic. |
| `/feature complete` | Commits (after you approve), merges to `main`, deletes the branch and pushes. It asks to tick the phase in `todo.md` in the same commit. |

**How a backend phase proves it works** (`ai-interaction.md` § Workflow, step 4):

- `npm test`, `npm run lint`, `npm run build`
- Call the endpoint with `curl` or the Swagger UI (from B03)
- For duel phases, drive two simulated socket clients (the harness from B43)

---

## What B01 should settle

`/todo spec` writes B01. Make sure its spec decides these, because every later phase builds on them:

1. **Port 3001.** Read from `PORT`, defaulting to 3001.
2. **`bodyParser: false`** in `NestFactory.create`. Better Auth (B10) needs it.
3. **The `@/` import alias.** ESM with `nodenext` won't resolve `@/` at runtime by itself. Choose one: the SWC builder with `paths` in `.swcrc`, or `tsc-alias` after `tsc`. Vitest needs the same alias.
4. **Lint tool.** `todo.md` says "eslint", but Nest 12 ships **oxlint**. Keep oxlint, or swap to ESLint, and record the choice.
5. **Remove the boilerplate:** `app.controller`, `app.service` and their specs. Keep a health route if you like (B44 adds the real one).
6. **Folder skeleton.** Create `src/game/` and `src/contract/`, so B03 and B27 have a home.
7. **Drop `@nestjs/mau`** and the `deploy` script. Mau is Nest's own hosting, and this project deploys to Railway or Fly (B45). All of the scaffold's `npm audit` findings (`tmp`, `undici`) come through it; production dependencies have none.

---

## Phase order at a glance

```text
B01–B03   scaffold, config, contract + OpenAPI      ← start here
B04–B09   Prisma, schema, seed (web mock fixtures)
B10–B14   auth, guests, guards, CORS/cookies, users  → unlocks W27, W28
P01       data provider trial (run in parallel; must finish before B20)
B15–B25b  ingestion, scoring, gate, storage, selector, catalog
B26–B32   indexes, rules engine (pure, tested)
B33–B35   solo endpoints, persistence, rate limits   → unlocks W29, W32
B36–B43   sockets, matchmaking, duel, harness        → unlocks W30, W31
B44–B46   observability, deployment, Redis           → unlocks W34, W35
```

For what each phase replaces in the web mock, see `context/mock-to-backend-map.md`.

---

## Final repo shape

```text
lineup-backend/
├── CLAUDE.md
├── .claude/
│   ├── skills/  feature  todo  research  cleanup
│   └── agents/  code-scanner  refactor-scanner
├── context/
│   ├── project-overview.md        identical in all repos
│   ├── coding-standards.md        shared
│   ├── coding-standards-backend.md
│   ├── ai-interaction.md
│   ├── monetization.md
│   ├── current-feature.md
│   ├── todo.md                    backend phases only
│   ├── README.md
│   ├── api-contract.md
│   ├── mock-to-backend-map.md
│   ├── docs/                      library and provider references
│   ├── features/                  phase specs land here
│   └── fixes/
├── prisma/                        B04+
├── scripts/ingest/                B15+
├── src/                           grows phase by phase
└── test/                          e2e, two-client harness
```

## Checklist

- [ ] Node v22.22.3+ and npm 11+ installed
- [ ] `nest new` with ESM, `--skip-git`, `--no-observe`; build, test and lint pass
- [ ] `git init`, GitHub repo created, first commit pushed
- [ ] Context files copied (Step 3) and edited (Step 4)
- [ ] `CLAUDE.md` written
- [ ] `coding-standards-backend.md` written
- [ ] `contract.md` copied as `context/api-contract.md`
- [ ] `.claude` copied, with the five edits
- [ ] Prettier matched, setup committed
- [ ] `/todo current` reports B01
