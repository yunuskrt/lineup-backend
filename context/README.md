# Context

These are the context files referenced by the `CLAUDE.md` file in the repo root. The nine files listed first are loaded into the AI's memory on startup. Everything else is read on demand, via commands like `/feature` and `/todo`, or when a phase spec points at it.

Loaded on startup:

- `project-overview.md` - Full project spec: features, data, tech stack, hard constraints. Shared by all three repos and must stay identical in each
- `coding-standards.md` - Code conventions, patterns and rules shared by all three repos
- `coding-standards-backend.md` - The NestJS-specific rules, read alongside `coding-standards.md`; it wins any conflict for this repo
- `ai-interaction.md` - Workflow and communication guidelines for working with the AI
- `current-feature.md` - Living document tracking the feature currently being worked on, plus the history of completed ones
- `mock-to-backend-map.md` - Every behaviour the web client's mock fakes today, and the backend phase that makes it real, with the gaps to resolve
- `api-contract.md` - The REST calls, socket events, payload shapes, error codes and shared constants the web client expects today. The starting point for B03; once the backend defines the contract in OpenAPI, the backend is right and this file is history
- `monetization.md` - Free vs Pro, entitlements and revenue options; entitlements resolve in this repo
- `todo.md` - Ordered roadmap of backend build phases (`B` prefix) and open decisions, used with the `/todo` command

Read on demand:

- `docs/` - Reference documentation for the libraries, providers and designs the phases are built against
- `features/` - Phase spec files used with the `/feature` command, named `phase-b<NN>-<kebab-title>.md` (split specs add a letter: `phase-b13a-…`). A spec may reference other project files where that helps
- `fixes/` - Fix spec files used with `/feature load`, shaped like `features/`. They correct or reshape work already built, outside the `todo.md` phases
- `research/` - Research files used with the `/research` command to generate documentation; created the first time `/research` runs

Workflow per phase: `/todo current` → `/todo spec` → `/feature load <spec>` → `/feature start` → `/feature review` → `/feature test` → `/feature complete`.
