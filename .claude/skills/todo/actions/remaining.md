# Remaining Action

1. Read todo.md and find the current phase (first `- [ ]` line)
2. Break that spec into concrete deliverables (files, schema, routes, socket events, scripts)
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
