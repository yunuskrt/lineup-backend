# Current Action

1. Read todo.md and find the first `- [ ]` line — that is the current phase
2. If every line is `- [x]`, report "All phases complete" and stop
3. Report:
   - Phase number and title
   - Whether it's not started or 🟡 partially implemented — if partial, quote its trailing note and point at `/todo remaining` for the breakdown
   - The one-line description from todo.md
   - Progress: `X/Y phases complete`
4. Do not modify any file
