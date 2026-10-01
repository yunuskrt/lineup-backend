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

Break the phase into concrete deliverables (schema/migrations, scripts, modules, services, controllers, gateway handlers, contract schemas, tests). Split into multiple specs when any of these hold:

- Deliverables span layers that are separately buildable and verifiable (e.g. schema + ingestion script + endpoint)
- A later deliverable only makes sense once an earlier one exists (a real dependency, not just a preference)
- More than roughly 8 deliverables, or the work clearly exceeds one focused branch/commit
- Distinct verification stories — one part is proven by `npm test`, another only by an HTTP call or the socket harness

Keep it as one spec when the deliverables are a single coherent unit built and verified together. Prefer fewer specs; do not split just to produce more files. Two to four specs is the normal ceiling for a phase — if it looks like more, say so and ask before writing.

Each spec must be independently implementable in order, and each must end in a state where `npm run build` passes.

## File naming

`context/features/phase-b<NN>-<kebab-title>.md` for a single spec, e.g. `phase-b02-config-module.md`.
Split specs get a letter suffix in build order: `phase-b38a-filter-coin-flip.md`, `phase-b38b-round-loop.md`.
If a target file already exists, show what would change and ask before overwriting.

## Spec file structure

**Do not mirror `context/current-feature.md` mechanically.** Shape each spec to what that phase actually needs. The skeleton below is a reference, not a template:

- **Add sections** when the phase calls for them, e.g. `## Contract` for payload shapes, `## States` for a state machine's transitions, `## Data` for fixture inventories, `## Open Questions` for decisions to settle before building, `## Out of Scope` when the boundary is easy to cross
- **Remove or merge sections** that would be empty or filler; e.g. fold a one-line dependency into Notes instead of giving it its own block
- **Keep `## Status`, `## Goals` and `## Notes`.** The `/feature` workflow reads and writes them, and deviations are recorded under `## Notes` per `context/ai-interaction.md`
- Extra sections go between `## Goals` and `## Notes`, ordered however reads best for that phase

Reference skeleton:

```markdown
# Phase <N><letter?> — <Title>

## Status

Not Started

## Goals

- <deliverable — concrete file paths, models, routes, or socket events>
- <one bullet per deliverable, in build order>

## Notes

- Scope: <what this spec covers, and for split specs what it explicitly does not>
- Depends on: <previous spec or phase, or "none">
- Constraints: <the hard constraints and coding standards that actually bite here>
- Verification: <how to prove it works — `npm test`, `npm run build`, call it with an HTTP client, or drive the socket harness>

## History
```

- If `## History` is kept, leave it empty — it is filled in when the phase completes
- Goals bullets are deliverables, not narration; name real paths (`src/solo/solo.service.ts`, `prisma/schema.prisma`)
- Carry over the relevant hard constraints from `context/project-overview.md` and the rules from `context/coding-standards.md` that apply to this phase; do not restate the whole standard
- **Referencing project files is optional — decide per spec.** Point to an existing file (a context doc section, an `api-contract.md` table, a source file the phase extends or mirrors) when it anchors a decision or saves restating detail; leave references out when the spec reads complete without them. Use repo-relative paths, and never add a reference just to have one

## Reporting

Report the files created, one line each with its scope, the intended build order, and remind that implementation starts by copying the first spec into `context/current-feature.md` per the workflow in `context/ai-interaction.md`.
