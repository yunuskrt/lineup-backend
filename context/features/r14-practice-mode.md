# R14 — Practice Mode

## Status

Complete

## Goals

- **The body**, `SoloStartRequest` (R13): gains an optional `practice: boolean`. It combines with `matchId`. Absent or `false` is today's run
- **Pro only** (`SoloService.start`), checked first, with R13's `matchId` check: a user whose effective tier isn't `pro` gets `forbidden`, `reason: 'pro_required'`, "Practice needs Pro." (with both fields set, this message). With `PRO_ENABLED=false` everyone is Pro
- **The rules stay in `src/game/`** (HC 7):
  - `NewGame` for solo takes `practice`; `GameState` carries it
  - the engine refuses `expire` in practice, so no life is ever lost
  - `createTimedGame` and `applyTimed` keep `round` `null` in practice, so no catch-up ever expires a round, however much time passes
  - guesses resolve as today: matching, collisions, the rate limit
  - the run ends on `perfect_clear` (all 11) or `quit`, never `lives_out`
- **Views:**
  - `SoloSession` gains `practice: boolean`, always sent; in practice `round` is `null` and `lives` is `3`
  - `SoloSummary` gains `practice: boolean`; `livesRemaining` is `3`; `missed` follows the tier as today
  - `roundTimesMs` measures from the side pick to the first find, then between finds, plus the stretch up to a quit
  - `NamedPlayer.elapsedMs` is the time since the previous find (or the side pick), uncapped in practice
- **The `elapsedMs` cap is lifted** (user, 2026-11-12): `NamedPlayer.elapsedMs` is a non-negative integer, no 15 000 max. Timed runs and duels still cap at the round length, as today
- **Never saved:** no `game_sessions` row, no rounds or guesses, no history, no stats. Neither the end of a run nor the sweep ever saves a practice run
- **Never counts toward the cap:** the start and side pick don't check the cap for practice, and `usedToday` ignores practice runs, so `GET /solo/allowance` reads the same `used` before and after
- **One open run a user, shared** (user, 2026-11-12):
  - starting practice ends a real run in play (saved as a quit, as today)
  - starting any run drops an open practice run, unsaved
- **Idle drop:** a practice run with no guess for 30 minutes (from the side pick or the last guess, or from its end) is dropped from memory by the minute sweep. A sync or a summary read doesn't extend it. An offered practice run (no side yet) is dropped after 30 minutes, as today's offers are. A call on a dropped run answers as a run gone from memory does today: `not_found`, "That run no longer exists."
- **Unit tests:**
  - Engine and timed game: no expiry however much time passes; 11 finds → `perfect_clear`, lives 3; quit → `quit`, lives 3; `expire` refused in practice; a non-practice game unchanged
  - Figures: practice `roundTimesMs` and `elapsedMs` uncapped, between finds; timed ones still capped
  - `SoloService`: Free with `practice` is refused before the cap and keeps the open run; with `matchId` plays that match; the run never reaches `persistence.save`, at its end or in the sweep; practice runs don't count in `allowance`; starting practice ends a real run (saved), starting a run drops a practice one (not saved); the idle drop after 30 minutes, not before, and a sync doesn't extend it
  - Contract: `practice` on the start body, `SoloSession` and `SoloSummary`; `elapsedMs` above 15 000 accepted
- **E2E**, on `dev`, `test/solo/practice.e2e-spec.ts`:
  - Pro practises: `practice: true` on the session, `round` `null`, lives 3; a wrong guess, then all 11 → `perfect_clear` with `practice: true`
  - no rows: no `game_sessions` for the user, empty `/profile/history`, `stats.played` 0
  - quit ends it with `quit`, lives 3
  - Free with `practice` is `403` + `pro_required`; with the switch off a stored-Free user practises, and `/solo/allowance` `used` is unchanged
  - `practice` with `matchId` plays that match
- **Docs:** `context/api-contract.md`: the start body, `SoloSession`, `SoloSummary`, the `NamedPlayer.elapsedMs` rule, the `findMatch` errors, the practice behaviour. OpenAPI follows the schemas

## Your part

1. **At `/feature load`:** nothing to decide; the two open points are settled below
2. **At `/feature test`:** `.env` points at `dev` for the e2e run. You edit `.env` yourself
3. **At `/feature complete`:** approve the commit, the merge into `main` and the push

## Notes

- **Why:** Pro can practise a match with no lives and no clock (user, 2026-11-10). Asked in `lineup-web/context/docs/backend-requests.md` § R14; web spec `context/features/pro-f-practice.md`. Needs R9 (`fcf2079`) and R13 (`7533e97`)
- **Decisions (user, 2026-11-12):**
  - the `elapsedMs` cap is lifted, so practice sends real times
  - practice shares the one-open-run rule
- **Numbering:** web request R14. Not a `todo.md` phase. Don't edit `todo.md`
- **HC 9 and 11 hold for every real game:** practice is a solo mode nobody plays against, and it's never saved or scored. HC 15: solo only, no duel change
- **The idle timeout is `RUN_IDLE_MS`, 30 minutes,** the value the store already uses
- **No migration.** Additive contract: one optional request field, two response fields, one max lifted. No `PROTOCOL_VERSION` bump
- Constraints:
  - comments single-line, at most 50 characters
  - `@/` imports
  - types from `z.infer`
  - never touch `production`
  - **never run the e2e suites while `.env` points at `ingest`**
- Verification:
  - `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`
  - `npm run test:e2e` on `dev`
  - `/docs/openapi.json`: `practice` on `SoloStartRequest`, `SoloSession` and `SoloSummary`
- Afterwards, in the web: mark R14 done in `backend-requests.md` with the commit, the idle timeout and what a dropped run answers; Pro F (`pro-f-practice.md`) can start, and relaxes its `elapsedMs` max

**Deviations recorded during implementation**

- **Only `NamedPlayer` loses its cap;** `DuelNamedPlayer` keeps `elapsedMs` ≤ 15 000, so the duel contract is unchanged. The two shared one timing shape before; solo now overrides `elapsedMs`
- **The engine refuses `expire` in practice with `wrong_mode`,** the rejection it already uses for an input the mode doesn't take; the timed layer never sends one, as the round stays `null`
- **`runFigures` and `namedOrder` take an `isPractice` flag** (default `false`) that drops the 15 000 cap. A practice run's `firstRound` is a `startRound` at the side pick, kept only as the figures' anchor; it's never sent
- **The idle clock** is `touchedAt`: in practice a sync or summary read keeps the old value, so the store's existing `RUN_IDLE_MS` eviction drops it. `isUnsaved` is `false` for practice, so an ended practice run is evicted like a saved one
- **The sweep skips practice runs** (no clock to tick, nothing to save), and `usedToday` skips them in memory
- **Review (2026-11-12):** a refused input (a guess or a second quit on an ended practice run) no longer resets the idle clock, as it only reads the run; the idle-drop test quits twice to prove it. Checked, not changed: the Pro check runs at the start only, as R13's does, so a tier drop between the start and the side pick still practises

**Test results (2026-11-12)**

- `npm test` 1480 passed (92 files); lint, build, `npx tsc --noEmit` clean
- `npm run test:e2e` on `dev`: 512 passed (41 files), including `test/solo/practice.e2e-spec.ts` (5)
- The built server on `dev`: `/docs/openapi.json` has `practice` (boolean) optional on `SoloStartRequest` and required on `SoloSession` and `SoloSummary`; `NamedPlayer.elapsedMs` is a non-negative integer with no 15 000 max (Zod's safe-integer bound only), `DuelNamedPlayer.elapsedMs` keeps 15 000
- No new unit tests at `/feature test`: the engine (4), timed game (5), figures (2), views (2), service (12) and contract (6) practice cases were already written

## History
