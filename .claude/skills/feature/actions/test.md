# Test Action

1. Read current-feature.md to understand what was implemented
2. Identify services, `src/game/` functions and utilities added/modified for this feature
3. Check if tests already exist for these functions
4. For functions without tests that have testable logic, write unit tests:
   - Create unit tests using Vitest, as `*.spec.ts` next to the code
   - Focus on services, utilities and the `src/game/` rules engine (not controllers or gateways)
   - Test happy path and error cases
   - Do not write tests just to write them. Use your best judgement
5. Run `npm test` to verify all tests pass
6. Report test coverage for the new feature code
