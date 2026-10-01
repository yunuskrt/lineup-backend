# AI Interaction Guidelines

## Communication

- Be concise and direct
- Explain non-obvious decisions briefly
- Ask before large refactors or architectural changes
- Don't add features not in the project spec
- Never delete files without clarification

## Workflow

This is the common workflow that we will use for every single feature/fix:

1. **Document** - Document the feature in @context/current-feature.md.
2. **Branch** - Create new branch for feature, fix, etc
3. **Implement** - Implement the feature/fix that I create in @context/current-feature.md
4. **Test** - Verify it actually works, then run the build and fix any errors:
   - **web** — click it in the browser
   - **backend** — call it with an HTTP client, or drive the socket with the two-client harness
   - **mobile** — run it on a simulator, and on a real mid-range Android before shipping
5. **Iterate** - Iterate and change things if needed
6. **Commit** - Only after build passes and everything works
7. **Merge** - Merge to main
8. **Delete Branch** - Delete branch after merge
9. **Review** - Review AI-generated code periodically and on demand.
10. Mark as completed in @context/current-feature.md and add to history

Do NOT commit without permission and until the build passes. If build fails, fix the issues first.

### Specs Track Reality

A spec is a record of what was built, not only a plan for it. **Whenever implementation, review or testing departs from the spec, update the spec file in `context/features/` or `context/fixes/` — and `current-feature.md` while it holds that spec — in the same turn the deviation is made.** Never leave the spec describing something that was not built.

This covers:

- A goal implemented differently than written, or solved by a different mechanism
- A goal dropped, deferred to a later phase, or added because the phase was unbuildable without it
- A dependency, version or tool swapped for another, and why
- A tuned value the spec asked to have recorded — thresholds, timings, limits
- A constraint that turned out to conflict with another, and which one won

Record it as a short bullet under `## Notes`, headed **Deviations recorded during implementation**, naming what changed and the reason in one line. A deviation is not a failure — an unrecorded one is, because the next phase reads the spec and not the diff.

Do not rewrite the original goals to match what happened. The goal stays as written and the deviation sits beside it, so the gap between intent and outcome stays visible.

## Working Across Repos

Three repos means a change can land in one and break another. Rules:

- **One feature, one repo.** If a feature needs work in two repos, it is two features with the backend one first. A branch never spans repositories.
- **The backend ships first, always.** Its API is additive until the clients catch up — never remove or rename a field a released client still reads.
- **A contract change is three separate tasks**, in order: backend, then web, then mobile. Nothing propagates automatically — there is no shared package, so a payload shape changed in one repo is still wrong in the other two until you go and change it there.
- **Breaking socket payloads bump `PROTOCOL_VERSION` in every repo.** The backend accepts N and N-1, which is what buys mobile users time to update, and what turns a drift into a refused connection instead of a broken duel.
- **When a client misbehaves, suspect the client's copy of the contract first.** Duplicated schemas are the most likely failure in this architecture, and the symptom is usually a parse error or a silently missing field.
- Say which repo you are in before making changes when it is not obvious from context.

## Branching

We will create a new branch for every feature/fix. Name branch **feature/[feature]** or **fix[fix]**, etc. Ask to delete the branch once merged.

## Commits

- Ask before committing (don't auto-commit)
- Use conventional commit messages (feat:, fix:, chore:, etc.)
- Keep commits focused (one feature/fix per commit)
- Never put "Generated With Claude" in the commit messages

## When Stuck

- If something isn't working after 2-3 attempts, stop and explain the issue
- Don't keep trying random fixes
- Ask for clarification if requirements are unclear

## Code Changes

- Make minimal changes to accomplish the task
- Don't refactor unrelated code unless asked
- Don't add "nice to have" features
- Preserve existing patterns in the codebase

## Code Review

Review AI-generated code periodically, especially for:

- Security (auth checks, input validation)
- Performance (unnecessary re-renders, N+1 queries)
- Logic errors (edge cases)
- Patterns (matches existing codebase?)
