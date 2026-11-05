# R4b — Named Order

## Status

Not Started

## Goals

- **Rules engine**, `src/game/summary.ts`: a new pure `namedOrder(firstRound, effects)`
  - one pass over the `TimedEffect` stream, as `runFigures` does
  - returns `{ playerId, order, elapsedMs }` for each `guess_resolved` with a `correct_new` verdict, in stream order
  - `order` starts at 1, no gaps
  - `elapsedMs` = `receivedAt` − the `startedAt` of the round the guess landed in (`firstRound` for the first round), capped at `ROUND_MS` as `roundTimesMs` is
- **Unit tests** in `src/game/summary.spec.ts`:
  - a run with a lost life between two names: the second name's time is measured from the round after the expiry
  - a guess in the grace window: capped at 15000
  - a perfect clear: orders 1–11
  - a run quit before any name: empty
  - a duel where the names alternate between the two seats: each time is from that seat's own round
- **Contract**, `src/contract/player.ts` (D1):
  - `namedPlayerSchema = revealedPlayerSchema.extend({ order, elapsedMs })`, registered as `NamedPlayer`
  - `duelNamedPlayerSchema = duelFoundPlayerSchema.extend({ order, elapsedMs })`, registered as `DuelNamedPlayer`
  - `order`: an integer 1–`SQUAD_SIZE`; `elapsedMs`: an integer 0–`ROUND_MS`
  - `SoloSummary.found` becomes an array of `NamedPlayer` (at most 11); `missed` stays `RevealedPlayer[] | null`
  - `DuelResult.found` becomes an array of `DuelNamedPlayer` (at most 11)
  - `src/contract/registry.spec.ts`: the id list gains both
- **Solo summary**, `src/solo/solo-views.ts`, `toSoloSummary`:
  - `found` lists `run.timed.game.found`, each with its `order` and `elapsedMs` from `namedOrder(run.firstRound, run.effects)`, sorted by `order`
  - a found player with no entry, or an entry with no found player, throws (D2)
- **Duel result**, `src/duel/duel-views.ts`, `toDuelResult`:
  - takes the effect stream so far and builds `found` the same way, with `foundBy` as today
  - `eventsFor` (`src/duel/duel-events.ts`) passes `[...before.effects, ...effects]`, so the step that ends the duel (the 11th name, an expiry, a forfeit) is counted (D3)
  - every other caller of `toDuelResult`, if any, passes its room's full stream
- **Not in live payloads:** `SoloSession.found`, `DuelSession.found`, `playerRevealed` and `correct_new.player` are unchanged
- **Tests beyond `src/game/`:**
  - `solo-views.spec.ts`: `found` sorted by `order` with times, the summary passes `soloSummarySchema`, a mismatch throws
  - `duel-events.spec.ts` (or `duel-views.spec.ts`): the `finished` payload of a duel won on the 11th name has orders 1–11, the last name included, with its time and `foundBy` per receiver
  - `test/solo/solo.e2e-spec.ts`: a summary after two names has orders 1 and 2, times in 0–15000
  - the B43 `DuelHarness` whole-game cases: `finished.found` orders are 1…n with no gaps, the same for both players
- **Docs:**
  - `context/api-contract.md`: `SoloSummary.found` is `NamedPlayer[]`, `DuelResult.found` is `DuelNamedPlayer[]`, with field tables
  - the OpenAPI document gains `NamedPlayer` and `DuelNamedPlayer`; the socket catalogue's `finished` payload follows

## Your part

1. **At `/feature load`:** confirm the decisions below, or change them
2. **At `/feature test`:** point `.env` at `dev` for the e2e run, then back to `ingest` afterwards. You edit `.env` yourself (as for R3a)
3. **At `/feature complete`:** approve the commit, the merge into `main` and the push

## Decisions

Proposed:

- **D1. Two new schemas, `NamedPlayer` and `DuelNamedPlayer`,** rather than new fields on `RevealedPlayer` and `DuelFoundPlayer`. Those two are shared with live payloads (`SoloSession.found`, `DuelSession.found`, `playerRevealed`) and with `missed`, which must not gain them
  - Alternative: optional fields on the shared schemas. That leaves a field present in some payloads and absent in others under one name
- **D2. Membership and order come from `game.found`; `namedOrder` supplies only the timings.** A disagreement between the two throws, which reaches the client as `server_error`. The response fails closed instead of sending a wrong list
  - Alternative: trust `namedOrder` alone and skip `game.found`
- **D3. The duel result reads the full stream: the room's effects plus the step that ends the duel.** Today `toDuelResult` runs while `eventsFor` replays a step over the room as it was *before* that step, so `before.effects` lacks the final name or expiry. Without this, the last name would have no time
  - Alternative: rebuild the timings from Postgres after B41's save. That's slower, and `finished` is sent before the save

## Notes

- **Why:** the solo summary and the duel result become a list of the players named, in the order they were named, with the seconds each took (in a duel, in the finder's colour). Asked in `lineup-web/context/docs/backend-requests.md` § R4, Part 2 (2026-11-06); web spec `context/fixes/gameplay-visuals-c-named-order.md`
- **Numbering:** web request R4, Part 2. Independent of R4a (`r4a-solo-offer-match.md`)
- **Scope:** not a `todo.md` phase. Don't edit `todo.md`
- **Why not `roundTimesMs`:** it has a row for every round, including those that ended in a lost life, so it doesn't line up with the names
- **The data already exists, in memory:**
  - the run's and the room's `effects` hold each `round_started` (`startedAt`) and each `guess_resolved` (`receivedAt`, the verdict's `playerId`)
  - `applyTimed` clamps `receivedAt` to the round start, so `elapsedMs` is never negative
  - **Nothing new is written to the database.** No migration. The summary is built from the in-memory run, as today
- **Duel:** a name always lands in the finder's own turn, so `elapsedMs` is how long the finder took on that turn
- **The squad stays put** (HC 2): only found players are listed, at the end, as today. `missed` stays Pro-only
- `accuracy`, `bestStreak` and `roundTimesMs` stay on `SoloSummary`. The web stops showing them, but they stay in the contract
- **Additive contract change:**
  - nothing removed or renamed
  - a web build from before R4 drops `order` and `elapsedMs`
  - `DuelResult` is a socket payload, but it only gains fields, so no `PROTOCOL_VERSION` bump
  - no migration
- Constraints:
  - `src/game/` stays pure: no NestJS, no Prisma, no I/O
  - comments single-line, at most 50 characters
  - `@/` imports
  - types from `z.infer`
  - never touch `production`
  - **never run the e2e suites while `.env` points at `ingest`**
- Verification:
  - `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`
  - `npm run test:e2e` on `dev`, including the duel harness
  - `/docs/openapi.json`: `NamedPlayer` and `DuelNamedPlayer` listed; `SoloSummary.found` and `DuelResult.found` reference them
  - on `dev`: one solo run with two names, then quit; report the summary's orders and that each time is in 0–15000. Counts and numbers only, never a name
- Afterwards, in the web: mark R4 Part 2 done in `backend-requests.md`; Gameplay Visuals C transcribes `NamedPlayer` and `DuelNamedPlayer`

## History
