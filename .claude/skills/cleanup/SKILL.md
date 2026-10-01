---
name: cleanup
description: Clean up project housekeeping tasks (add "run" to execute fixes)
argument-hint: run|check
---

Review the codebase for cleanup tasks:

1. Make sure that the history in @context/current-feature.md is in order from oldest to newest
2. Find long comment blocks for a statement (more than 1 line or 50 characters)
3. Find unnecessary console.log statements in src/
4. Find unused imports
5. Check for stale TODO comments
6. Find orphaned/unused files
7. Check that context files match actual project state
8. Check that `.env` has every variable the Zod env schema in `src/config/` requires, and no variable the schema doesn't know. If something is missing, tell me.
9. Find `@ts-ignore` comments that might be stale

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
