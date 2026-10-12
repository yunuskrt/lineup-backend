# Phase B29 — Squad Collision Rules

## Status

Complete

## Goals

- `src/game/collisions.ts` — `classifyGuess(guess, squad, foundIds)` composes `resolveGuess` (B28) with the found-pool and returns a `GuessVerdict`: `correct_new` with a player id, `already_found` with a player id, or `not_in_xi`
- `classifyGuess` applies the collision rule from **Rules** below, so an ambiguous match never reaches B30 as a raw `ambiguous`
- `src/game/collisions.ts` — `squadCollisions(squad)` lists every alias held by two or more players of one XI, with their ids, for B21 and B22 to reuse
- `src/game/collisions.spec.ts` — every row of the **Rules** table, plus: an exact hit, a fuzzy hit, a miss, both sides of a crown-2015 Price, a typo tie (`Harlwo`) with one Harlow found, and a squad with no collisions
- `scripts/seed/matcher-fixtures.spec.ts` — extended:
  - `squadCollisions` over the 20 seeded XIs returns exactly the two deliberate `harlow` collisions (crown-2003 home, continental-2005-final away)
  - each of those XIs can be cleared one player at a time by full name, ending with 11 found

## Rules

The squad is the current XI only (B28 already takes care of the "ambiguous only inside the XI" rule). Candidates are the player ids the matcher returned as `ambiguous`.

| Matcher result                      | Found-pool                    | Verdict                         |
| ----------------------------------- | ----------------------------- | ------------------------------- |
| `hit` p                             | p not found                   | `correct_new` p                 |
| `hit` p                             | p found                       | `already_found` p               |
| `miss`                              | —                             | `not_in_xi`                     |
| `ambiguous`, ≥ 2 unfound candidates | —                             | `not_in_xi`                     |
| `ambiguous`, 1 unfound candidate    | the others found              | `not_in_xi`                     |
| `ambiguous`, 0 unfound candidates   | every candidate found         | `already_found`, first in squad order |

## Decisions

Settled at `/feature load`.

1. **Hybrid collision rule.** A bare surname that matches more than one player never reveals anyone; the player has to type the first name. Once every candidate is found, the guess returns `already_found`. That outcome needs a single id, so it uses the first candidate in squad order, which keeps the result deterministic. Rejected: always refusing (the mock's behaviour), and narrowing by the found-pool (which gives a free reveal).
2. **No "be more specific" outcome.** An ambiguous guess reads as `not_in_xi`, and the `GuessResult` contract keeps its three outcomes. A separate outcome would leak that two starters share a surname (HC 2) and would change the contract in all three repos.

## Out of Scope

- Lives, turns, rounds and the session state machine (B30); building `RevealedPlayer` from an id (B30, B33)
- Loading a squad's aliases from Postgres (B33, B38)
- The guessability gate's use of `squadCollisions` (B21)
- Updating `project-overview.md` § C from `pg_trgm` to edit distance (an open follow-up from B28, done separately in all three repos)

## Notes

- Scope: a single spec. It adds a pure verdict layer over the B28 matcher and changes nothing outside `src/game/` and the seed fixture test.
- Depends on: B27 `normalizeName`, B28 `resolveGuess`.
- Constraints:
  - `src/game/` is pure (oxlint guard).
  - The squad, candidate ids and aliases never go into a log, an error message or a test failure message; assertions compare ids only, as in B28.
  - The only id a `GuessVerdict` carries is the one a contract outcome will reveal.
  - HC 9 and HC 10: no verdict costs a life or ends a turn on its own. That is B30's job.
- Verification: `npm test` (unit only; no database, no HTTP), `npm run build` and `npm run lint`.

**Deviations recorded during implementation**

- The full-name clearing test runs over all 20 seeded XIs, not only the two with collisions; it costs nothing and covers more.
- `foundIds` is a `readonly string[]`, not a Set: the found-pool holds at most 11 ids, so a lookup in a list costs nothing.

## History
