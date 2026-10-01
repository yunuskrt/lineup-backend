---
name: todo
description: Manage the Lineup build-phase todo list in context/todo.md - current, done, remaining, list or spec
argument-hint: current|done|remaining|list <phase-number>|spec [phase-number]
---

# Todo Phase Workflow

Tracks progress through the phased build plan.

## Working Files

@context/todo.md — the ordered phase checklist (source of truth for progress)
@context/features/ — generated per-phase spec files, shaped like `context/current-feature.md`

### File Structure

todo.md is a single flat checklist. Every line looks like:

```text
- [ ] **Phase N — Title**: short description.
- [ ] 🟡 **Phase N — Title**: short description. — partially done: <what's left>
```

- `- [ ]` = not started, `- [ ] 🟡` = partially implemented, `- [x]` = complete
- **Never put anything but a space or `x` inside the brackets.** GitHub-flavored Markdown only recognizes `[ ]`, `[x]` and `[X]` — any other character stops the line rendering as a checkbox. Partial state is the 🟡 marker after the box, never `[~]` or `[-]`.
- The 🟡 marker is optionally followed by a short ` — partially done: ...` note at the end of the line. `/todo remaining` keeps both in sync; you can also set them by hand.
- **Line order = build order.** Completed phases sit at the top, in the order they were finished; incomplete phases follow. A 🟡 phase is still incomplete and stays in the incomplete section.
- **Current phase** = the first `- [ ]` line in the file.

## Task

Execute the requested action: $ARGUMENTS

| Action      | Description                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `current`   | Report the current phase                                                                                                                     |
| `done`      | Mark the current phase complete                                                                                                              |
| `remaining` | List what's still unimplemented in the current phase, refresh its 🟡 marker                                                                  |
| `list <N>`  | Promote phase N to be the next phase, reorder the rest                                                                                       |
| `spec [N]`  | Write phase N (default: current phase) into one or more spec files in `context/features/`, splitting it if it's too big for a single feature |

See [actions/](actions/) for detailed instructions.

If no action provided, explain the available options.
