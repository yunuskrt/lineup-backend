# Phase B32 — Team Side Selection

## Status

Complete

## Goals

- `src/matches/side-rules.ts` (pure, like `pool-rules.ts`):
  - `SideSignals`: `guessability` and `starPower` for `home` and `away`, each in `[0, 1]`
  - `NEUTRAL_SIGNALS`, where every value is `0.5`
  - `homeProbability(signals)` gives the chance of picking home; `pickSide(signals, random)` returns a `Side`
- `src/matches/side-signals.ts`: the Zod schema for the optional `sides` block inside `memorability_scores.signals` (**Data**), plus `readSideSignals(json)`. A missing or invalid block reads as `NEUTRAL_SIGNALS` and never throws.
- `src/matches/side-picker.service.ts`: `SidePickerService.pick(matchId, random = Math.random)` loads the match's score row (if any), reads its side signals and returns a `Side`. It is exported from `MatchesModule` for B38.
- Tests:
  - `side-rules.spec.ts`: the probability bounds, neutral signals giving 0.5, the tilt following the signals, symmetry when home and away are swapped, and a seeded `random` hitting both sides
  - `side-signals.spec.ts`: a valid block, a missing block, an out-of-range value, extra keys, and a non-object `signals`
  - `side-picker.service.spec.ts`: a stubbed Prisma, with and without a score row
  - `test/matches/side-picker.e2e-spec.ts`: a rolled-back transaction inserts a score row whose `signals` tilt toward away, and a fixed `random` picks away; a seeded match with no score row comes back neutral
- `context/docs/build-order.md`: the B32 revisit row names the `signals.sides` block B19 and B21 must write

## Data

B19 does not exist yet, and the seeded matches have no `memorability_scores` row. B32 therefore reads an **optional** block that B19 (star power) and B21 (guessability) will write later:

```json
{
  "sides": {
    "home": { "guessability": 0.8, "starPower": 0.6 },
    "away": { "guessability": 0.5, "starPower": 0.9 }
  }
}
```

- The rest of `signals` is B19's own breakdown, and B32 ignores it.
- No migration is needed: `signals` is already `Json`.
- `context/docs/build-order.md` already plans a neutral fallback at B32 (open point 4) and lists B32 under "Revisit once real data is loaded". B32 updates that row to name the `sides` block, so B19 and B21 know to write it.

## Decisions

Settled at `/feature load`:

- **Neutral until real signals exist.** A match with no `sides` block (every seeded match today) is a fair 50/50. The same code path weights the pick once B19 and B21 write the block, so nothing changes in B32 then. Nothing is guessed from mock data. Rejected: proxies such as alias counts or pool appearances.
- **Bounded tilt.** Each side's strength is the mean of its `guessability` and `starPower`; `P(home) = 0.5 + (home − away) / 2`, clamped to `[0.3, 0.7]`. The stronger side is favoured but never certain, so both XIs of a match still turn up in duels. Rejected: proportional weighting (unbounded), and always picking the stronger side.

## Out of Scope

- Calling it from a duel: coin flip, squad load, `matchReady` (B38)
- Solo: the player picks the side (`chooseSide`, B33), so this service is never used there
- Computing star power (B19) or guessability (B21); writing the `sides` block

## Notes

- Scope: a single spec covering pure rules, a JSON reader, one service and its tests.
- Depends on: B25 `MatchesModule`; B08 `memorability_scores`.
- Constraints:
  - Project overview § B: the side is chosen on the server, weighted, not a coin flip, aiming for a squad that is "hard but fair". Duels only.
  - HC 20: the signals and the probability never reach a client, a log or an error; only the chosen `Side` leaves the service.
  - HC 15: no tier, client input or player affects the pick.
  - Validation: the JSON block is parsed with Zod, and a bad block falls back to neutral rather than failing a duel.
- Verification: `npm test`, `npm run test:e2e` (rolled-back transactions on the dev branch), `npm run build` and `npm run lint`.

**Deviations recorded during implementation**

- The e2e "no score row" case builds its own unscored match inside the rolled-back transaction instead of reading a seeded one, so it does not depend on the dev branch's seed. A third case covers an invalid stored block.
- `build-order.md`: besides the B32 revisit row, "Decide before you get there" item 4 is marked done, naming the `sides` block.
- Added in review: `SideStrength` is read-only and `NEUTRAL_SIGNALS` is frozen. `readSideSignals` hands out that one shared object, so a caller writing to it would have changed every later neutral pick.

## History
