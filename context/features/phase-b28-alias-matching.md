# Phase B28 — Alias Matching

## Status

Complete

## Goals

- `src/game/matcher.ts`: pure, no imports beyond `@/game/normalize.js`.
  - **`SquadEntry`:** `{ playerId: string; aliases: readonly string[] }`. The aliases are the stored `normalized` forms, which B27's CHECK guarantees are already normalized, so the matcher never re-normalizes them.
  - **`MatchResolution`:**
    - `{ kind: 'hit'; playerId }`
    - `{ kind: 'ambiguous'; playerIds }`, at least two
    - `{ kind: 'miss' }`
  - **`resolveGuess(guess, squad)`:**
    1. `normalizeName(guess)`. An empty result is a `miss` at once, so an all-non-Latin guess never reaches the scorer (B27).
    2. **Exact:** the players with an alias equal to the normalized guess. One gives a `hit`; two or more give `ambiguous`.
    3. **Fuzzy, only when nothing matched exactly:** the best `similarity` over every alias of every player. A score above `FUZZY_THRESHOLD` gives a `hit`. A tie at the best score across players gives `ambiguous`, so a typo can't dodge a collision. Nothing above the threshold gives a `miss`.
  - **`similarity(a, b)`:** `1 − distance / max(length)`, using restricted Damerau-Levenshtein, where a swapped pair costs 1 (Open Questions 1).
  - **`FUZZY_THRESHOLD`:** `0.82`, carried from the web mock and recorded as tuned on the seeded data (Open Questions 2).
- `src/game/matcher.spec.ts`. Squads are built inline from the seeded players' aliases, since `src/` never imports `scripts/`.
  - **Every case from the web mock's `matcher.test.ts`, copied by hand:**
    - full name and bare surname (`Kieran Moss`, `Moss`)
    - nickname and mononym (`Kiko`, `Tavinho`)
    - case, accents and whitespace (`  kerem şahin `, `İLKER DOĞANÇAY`, `Kılıç`, `Černý`, `Łukasz Wróbel`)
    - a surname shared by two players in the XI is `ambiguous` (`Harlow`)
    - a typo that ties across that collision is `ambiguous` (`Harlwo`)
    - the first name settles it (`Dean Harlow`, `Rhys Harlow`)
    - a surname shared only with the opposing XI is a `hit` (`Price`)
    - misses: `Zinedine Zidane`, `''`, `!!!`
    - typos: a swapped pair and a dropped letter (`Pennokc`, `Tollnd`, `Fenwikc`)
    - **never `Ronaldo` → `Ronaldinho`**
  - **Added here:**
    - `Xavi` never resolves to `Xabi`, and the reverse: two real, different players
    - a guess equal to one player's alias and a fuzzy neighbour of another's resolves exactly
    - an exact `ambiguous` isn't overridden by a better fuzzy single
    - a non-Latin guess is a `miss`
    - `similarity` is symmetric, 1 for equal strings, and the threshold boundary is strict (`>`, not `≥`)
    - the empty squad is a `miss`
- `scripts/seed/matcher-fixtures.spec.ts`, the tuning check over all 20 seeded XIs. No database; it imports the transcribed data.
  - **Recall:** every alias of every starter resolves to that starter within its own XI, except designed collisions (`harlow`), which come back `ambiguous`.
  - **Precision:** every full name from the **other** 19 XIs either misses this XI or hits the same player. A match never resolves to a different player. The surname-only aliases of players outside the XI are left out, since a shared surname is a legitimate `hit` (the `Price` rule).
  - The spec states the threshold it ran at, so retuning shows up as a diff.

## Open Questions

Both settled at `/feature load`, as recommended: edit distance in `src/game/`, and a threshold of 0.82. Follow-up: `project-overview.md` § C must change identically in all three repos.

1. **The fuzzy scorer: Postgres `pg_trgm`, or edit distance in `src/game/`?** `project-overview.md` § C says "Fuzzy fallback via Postgres `pg_trgm` + `unaccent`". Measured on the dev branch with `similarity()`:

   | Pair | `pg_trgm` | Should |
   | --- | --- | --- |
   | `ronaldo` / `ronaldinho` | **0.462** | never match |
   | `pennokc` / `pennock` | 0.455 | match |
   | `fenwikc` / `fenwick` | 0.455 | match |
   | `harlwo` / `harlow` | 0.400 | match |
   | `tollnd` / `tolland` | 0.500 | match |

   No threshold accepts the typos and refuses Ronaldinho: trigrams punish any edit near the end of a short name. `word_similarity` is worse (0.750 for Ronaldinho).

   **Recommended: restricted Damerau-Levenshtein in `src/game/matcher.ts`, as the web mock does.** It separates them cleanly (Ronaldinho 0.70, every typo ≥ 0.83).
   - It also keeps matching pure and unit-tested, and runs against the precomputed alias set for the match (§ C: "against a precomputed alias set for the current match"): at most 11 players' aliases, in memory, with no database round trip on a 15-second clock.
   - `pg_trgm` stays installed for what it's good at: candidate search across the whole `players` table at ingestion (B17 entity resolution) and QA (B22).
   - **This changes `project-overview.md` § C,** which must stay identical in all three repos. That's a small follow-up in each repo, recorded as a deviation here.
2. **The threshold.** **Recommended: keep 0.82** from the mock. It's the value that already separates the cases above, and the fixture spec checks it over all 167 seeded players. Retune with real names after the load step (see `context/docs/build-order.md`), where Turkish, Spanish and Slavic surnames will test it properly.

## Out of Scope

- **What an `ambiguous` result means for the player:** B29 (squad collision rules). The web mock treats it as `not_in_xi`; B29 decides whether, for example, an already-found Harlow settles the other.
- Already-found, turn and life handling: B30. The matcher only names the player; it doesn't know what's been found.
- Loading a match's alias set from the database: B33 (solo) and B38 (duel), at session start. It must never reach a client or a log (Hard Constraint 2).
- Collecting misspellings from live play into the alias table: a later ingestion concern.

## Notes

- Scope: one pure module, its unit spec, and one data-driven spec over the seed. No migration, no service, no route.
- Depends on: B27 (`normalizeName` and the normalized `aliases` it guarantees), B09 (the seeded XIs for the fixture spec).
- **`src/game/` is pure** and the lint guard from B27 enforces it. `matcher.ts` imports only `@/game/normalize.js`.
- **The squad is never logged.** No `console` call in the matcher; the tests assert on ids only.
- Hard Constraints:
  - **2:** the matcher runs on the server against an alias set the client never sees.
  - **10:** a `miss` is not a penalty. That's B30's to apply, but the matcher must never turn a near-miss into a wrong `hit`; the precision half of the fixture spec is that check.
- Constraints:
  - no `any`; `@/` imports; comments single-line, at most 50 characters
  - functions under about 50 lines
- **Revisit once real data is loaded:** retune `FUZZY_THRESHOLD` against real names and rerun the fixture-style precision and recall check on the real pool.
- Verification:
  - `npm test` (both specs), `npm run build`, `npm run lint`
  - No e2e: nothing here touches the database or HTTP.

**Deviations recorded during implementation**

- **The threshold is strictly `>`, ties included.** The web mock started its tie list at the threshold, so a score of exactly 0.82 with no better hit would still count. Ties now count only once something has scored above it. No guess of up to 64 characters can score exactly 0.82 (the nearest is 0.8200000000000001), so strictness is pinned as a property instead: over 5–12 edits of a 50-letter alias, a guess hits exactly when `similarity > FUZZY_THRESHOLD`.
- **`similarity` has extra cases:** 0 against an empty string, and the exact scores for Ronaldinho (0.70), Harlwo (0.833), Tollnd (0.857) and Xavi/Xabi (0.75).
- **The fixture spec builds each XI's aliases with `normalizeName`,** exactly as the seed stores them, so it tests what the database holds. Recall treats an alias shared inside the XI as an expected `ambiguous`, without listing `harlow` by name, so a future collision is covered too.
- **Precision uses every outsider's display name,** which is all 167 players minus the XI. It asserts a `miss`, not just "no wrong hit": an `ambiguous` result for someone not in the XI would be wrong too.
- **Mutation check:** with `FUZZY_THRESHOLD` dropped to 0.5, the fixture spec failed 19 of its 41 cases. Restored to 0.82, all pass. The check has teeth.
- **Tests:** 566 unit, all green. New: 30 in `matcher.spec.ts` and 41 in `matcher-fixtures.spec.ts`. No e2e, as planned: nothing touches the database or HTTP.
- **`/feature test`:** no new tests needed. **Coverage from unit tests:** `src/game/` (`matcher.ts` and `normalize.ts`) is at 100% of statements (60/60), branches (33/33), functions (11/11) and lines (49/49). That includes every early return in `editDistance` and the guarded tie branch.
- **Review:** every goal is met; no code change.
  - **Exact before fuzzy:** an exact hit or collision is never second-guessed by a fuzzy score, and the fuzzy tie list only grows above the threshold.
  - **No leaks:** the matcher returns player ids only, has no `console` call, and both specs assert on ids.
  - **Purity:** `matcher.ts` imports only `@/game/normalize.js`, and B27's lint guard passes.
  - **Observation for the real-data retune:** at 0.82, a one-letter typo only matches names of six letters or more. One edit scores 0.80 at five letters, 0.75 at four and 0.67 at three. Short real names (`Mesi` for Messi, `Kaka`, `Pepe`, `Xavi`) need an exact alias. That's the same behaviour as the web mock, and it's what keeps `Xavi` and `Xabi` apart. When the threshold is retuned on real names, decide whether short names get their own rule or rely on collected misspellings in the alias table.

## History
