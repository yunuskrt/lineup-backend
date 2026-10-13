# Phase B33a — Solo Session Core

## Status

Complete

## Goals

- **`src/game/formation.ts` (pure):**
  - `positionForSlot(formation, slot)` returns the `PositionGroup` a slot must hold, or `null` for a slot outside the formation.
  - Slot 0 is `GK`. The outfield slots fill the lines from defence to attack: the first line is `DF`, the last is `FW`, and any line in between is `MF`.
  - It is the same rule as the web's `src/lib/formation.ts`, transcribed by hand.
- **`src/game/summary.ts` (pure):** `runFigures(firstRound, effects)` returns `{ accuracy, bestStreak, roundTimesMs }` (**Summary figures**).
  - `firstRound` is the `RoundTiming` from `createTimedGame`.
  - `effects` is every `TimedEffect` the run produced, in order.
- **`src/matches/squad-loader.service.ts`:** `SquadLoaderService.load(matchId, side)` returns a `LoadedSquad` (**Squad**).
  - It is exported from `MatchesModule`, because B38 loads a duel's squad the same way.
- **`src/matches/match-refs.ts`:** add `toMatchInPlay(match, side, formation)`, which extends `toMatchIdentity` and never touches a lineup.
- **`src/solo/solo-run.ts`:** the server-only `SoloRun` record (**Run record**).
- **`src/solo/solo-session.store.ts`:** `SoloSessionStore`, an in-memory store behind one class (**Store**).
- **`src/solo/solo-views.ts`:** pure mappers from a run to the contract shapes:
  - `toSoloSession(run)` returns a `SoloSession`
  - `toGuessResult(verdict, squad)` returns a `GuessResult`; only `correct_new` carries a `RevealedPlayer`
  - `toSoloSummary(run, tier)` returns a `SoloSummary`; `missed` is the list for `pro` and `null` for `free`
- **Tests:**
  - `formation.spec.ts`: `4-4-2`, `4-2-3-1`, `3-5-2` and `4-1-2-1-2` slot by slot; slot 0; slots past 10
  - `summary.spec.ts`: accuracy with no guesses, and mixed outcomes; streaks broken by each kind of miss; round times for found, expired and quit rounds, clamped to `ROUND_MS`
  - `squad-loader.service.spec.ts`: a stubbed Prisma, covering a good XI, 10 rows, a missing formation and a slot/position mismatch. Each error message must contain no player name or alias.
  - `solo-session.store.spec.ts`: owner-only reads, active-run lookup, eviction by idle time
  - `solo-views.spec.ts`: every output parses with its contract schema; a `SoloSession` never carries an unrevealed player; `missed` is `null` for `free`
  - `test/matches/squad-loader.e2e-spec.ts`: loads one seeded match's home and away XIs from the dev branch, 11 entries each, aliases normalised

## Squad

```ts
type LoadedSquad = {
  formation: string;
  entries: readonly SquadEntry[]; // what the engine matches against
  players: readonly RevealedPlayer[]; // reveal views, slot order
};
```

- **One query** reads the side's `match_teams` row with its 11 `lineups`, each player's `name`, `imageKey` and normalised aliases.
- **Image URLs:** `imageUrl` is `null` until B23 turns bucket keys into URLs, the same as `crestUrl` in `toClubRef`.
- **The loader throws a plain `Error`** when the side:
  - has a missing formation
  - has a row count other than 11
  - has a slot whose position disagrees with `positionForSlot`
  - has a player with no alias

  The message names the match id only. A pool match should never fail these checks (B25 already requires 11 rows and a formation), so B33b maps the error to `server_error`.
- **Prisma logs the arguments of a failed call** (B04 note). The loader's arguments are a match id and a side, never player data, so that log stays clean.

## Run record

```ts
type SoloRun = {
  id: string; // sessionId
  userId: string;
  match: MatchIdentity;
  side: Side | null; // null until chooseSide
  squad: LoadedSquad | null;
  timed: TimedGame | null;
  firstRound: RoundTiming | null;
  effects: TimedEffect[]; // the run's whole log
  endReason: SoloEndReason | null;
  touchedAt: number;
};
```

- The record holds the squad, so it never leaves the server. Only `solo-views.ts` turns it into a payload.
- `effects` is the run's whole log. The summary is derived from it, and B34 writes rounds and guesses from it.

## Store

- `create(run)`, `save(run)`.
- `get(id, userId)` returns `undefined` for an unknown id **and** for another user's run, so `not_found` never reveals that a run exists.
- `activeOf(userId)` returns that user's run that is still being played, if any.
- `evictIdle(now)` drops runs that have not been touched for `RUN_IDLE_MS` (30 minutes). B33b runs it on a timer.
- **It lives in memory, which matches the project overview:** live session state is ephemeral at MVP, and moves to Redis in B46. A restart loses runs in progress.

## Summary figures

| Figure | Rule |
| --- | --- |
| `accuracy` | `correct_new` guesses ÷ all resolved guesses; `0` with no guesses (as the mock does) |
| `bestStreak` | The longest run of consecutive `correct_new` guesses. Any other resolved guess, or a `life_lost`, breaks it (**Decisions**) |
| `roundTimesMs` | For each round that ended: `endedAt − startedAt`, clamped to `ROUND_MS` (the B31 note: an expired round lasts 15 400 ms on record) |

- A rejected guess (`round_over`, `session_over`) is not a resolved guess and doesn't count.
- The last round of a quit run ends at the quit instant, the same as the mock.

## Decisions

Settled at `/feature load`:

- **A live run lives in memory only.** B34 adds the Postgres writes, from the run's effect log, so B33 stays a wiring phase. The B14b history and profile stay empty until B34, as they are today. Rejected: writing `game_sessions` and participant rows at start, which would pull half of B34 into B33.
- **A streak breaks on any guess that isn't `correct_new`, or on a lost life.** A life lost to the clock is the clearest miss there is. This differs from the web mock, which leaves the streak intact on an expiry. The server is authoritative, and the web only shows the number. Rejected: the mock's rule, where only a guess breaks it.

## Out of Scope

- The routes, the error mapping, the clock provider and the eviction timer (B33b)
- Writing sessions, rounds, guesses and stats (B34); rate limits (B35)
- Real image and crest URLs (B23)

## Notes

- Scope: everything the solo endpoints need that is checkable without HTTP. B33b adds the service, the controller and the routes.
- Depends on: B25 (`MatchesModule`, the pool rules), B28–B31 (matcher, collisions, engine, timed game), B03a (the solo contract).
- Constraints:
  - **HC 2 and the CLAUDE.md rule:** the squad is never sent, logged or put in an error message. `squad`, `entries` and unrevealed `players` stay inside `SoloRun`; the views read only revealed ids. The tests assert this.
  - **HC 7:** all logic stays in `src/game/`. `formation.ts` and `summary.ts` are pure and import nothing from NestJS or Prisma. The views map data; they decide nothing.
  - **HC 17:** a squad is exactly the 11 starters.
  - **HC 20:** neither the loader nor the views read `memorability_scores`.
  - `MatchIdentity.date` is formatted `YYYY-MM-DD` (the B07 note), using the existing `toMatchIdentity`.
- Verification: `npm test` (100% coverage for `formation.ts` and `summary.ts`), `npm run test:e2e` (the loader on the dev branch), `npm run build` and `npm run lint`.

**Deviations recorded during implementation**

- `SoloRun` is a union, `OfferedRun | PlayedRun`, keyed on `side: null`, instead of one type with nullable fields. The views take a `PlayedRun`, so the type checker stops them being called on an offer.
- No `endReason` field: it is read from `timed.game.result` (via `isOver`), so it can't drift from the engine.
- Store: `save` both creates and updates, so there is no separate `create`. `drop(id)` is added for B33b, which removes an untaken offer when a new run starts. `activeOf` returns a run that is offered or in play, meaning not over.
- The loader doesn't select `imageKey`. `imageUrl` is `null` until B23, so reading the key now would be dead data.
- `toMatchInPlay` takes the run's stored `MatchIdentity`, not a database row.
- Added `src/solo/solo.fixtures.ts`: shared test squads and runs, like `contract.fixtures.ts`.
- The database test also loads every complete seeded XI (20), proving the slot rule agrees with the seed. The unit test also covers a missing team row.

## History
