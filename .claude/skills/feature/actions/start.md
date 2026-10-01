# Start Action

1. Read current-feature.md - verify Goals are populated
2. If empty, error: "Run /feature load first"
3. Set Status to "In Progress"
4. Create and checkout the branch (derive name from H1 heading): `fix/<name>` when the loaded spec lives in `context/fixes/`, otherwise `feature/<name>`
5. List the goals, then implement them one by one
