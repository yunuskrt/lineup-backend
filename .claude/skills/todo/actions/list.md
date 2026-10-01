# List Action

Reprioritizes the build order by pulling a phase to the front of the queue.

Requires a phase number, e.g. `/todo list 13`.

1. If no phase number was given, error: "Usage: /todo list <phase-number>"
2. Read todo.md and find the line for that phase number
   - Not found → error and show the valid range
   - Already `- [x]` → report it's already complete, change nothing
3. If the phase currently at the front of the incomplete section is marked 🟡, warn that promoting phase N parks work already in progress, and ask before continuing
4. Move that line so it sits directly after the last `- [x]` line — i.e. it becomes the first incomplete line, the new current phase
   - If no phase is complete yet, it goes to the top of the list
5. Keep every other incomplete phase in its existing relative order, shifted down to fill the gap
6. Carry each moved line's 🟡 marker and trailing note along unchanged — reordering never changes a phase's implementation state
7. Report the new order of incomplete phases and which phase is now current
