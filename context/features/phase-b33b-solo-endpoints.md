# Phase B33b — Solo Endpoints

## Status

Complete

## Goals

- **`src/common/clock.ts`:**
  - The `CLOCK` token and `Clock = { now(): number }`, with a `Date.now` default provider.
  - It is the only time source for the rules. Tests override it, and B38 reuses it.
- **`src/solo/solo.service.ts`:** `SoloService`, with one method per route (**Routes**). It:
  - calls `MatchSelectorService`, `SquadLoaderService`, `SoloSessionStore` and `applyTimed`
  - reads the time from `CLOCK` on receipt and nowhere else
  - turns every engine rejection into an `ApiException` (**Errors**)
- **`src/solo/solo.controller.ts`:** six thin routes under `/solo/sessions`:
  - each validates with the `src/contract/solo.ts` and `src/contract/match.ts` schemas through `ZodValidationPipe`
  - each is documented with `@ContractResponse`, `@DocumentsSession` and `@ApiTags('solo')`
- **`src/solo/solo.module.ts`:**
  - It imports `MatchesModule` and provides `SoloService`, `SoloSessionStore` and `CLOCK`.
  - It runs `store.evictIdle` on an unref'd interval, started on module init and cleared on destroy.
  - It is registered in `src/app.module.ts`.
- **Tests:**
  - `solo.service.spec.ts`: stubbed selector, loader and store, with a fake clock. It covers each route's happy path and every row of **Errors**.
  - `test/solo/solo.e2e-spec.ts`: the full HTTP loop against the dev branch (**E2E**)
- **`context/api-contract.md` needs no change.** The routes are the suggested paths, and every shape already exists in B03a.

## Routes

| # | Route | Body | Response | Does |
| --- | --- | --- | --- | --- |
| 8 | `POST /solo/sessions` | `Filters` | `SoloMatchOffer` | Ends the user's open run (**Decisions**), selects a match and creates a run with no side and no clock |
| 9 | `POST /solo/sessions/:sessionId/side` | `{ side }` | `SoloSession` | Loads the squad and starts round 1 now |
| 10 | `POST /solo/sessions/:sessionId/guesses` | `SoloGuessRequest` | `SoloGuessResponse` | Applies a `guess` input |
| 11 | `GET /solo/sessions/:sessionId` | — | `SoloSession` | Sends `tick` (the B31 note) |
| 12 | `POST /solo/sessions/:sessionId/quit` | — | `SoloSummary` | Sends `quit`; a run that has already ended returns its summary (**Decisions**) |
| 13 | `GET /solo/sessions/:sessionId/summary` | — | `SoloSummary` | Sends `tick`, then reads the summary |

- **Every call passes the server receipt time (`clock.now()`)** to `applyTimed`, so any expiry is applied first. Nothing is read from the client except the guess text, the side and the filters.
- **A guess response carries `session`, the state after the guess.** After a `correct_new`, that means the next round's timing.
- **`missed` follows `user.tier` from the session.** Today that's always `free`, so `missed` is `null`. The client never sends a tier.
- **Session ids come from `randomUUID()`.** B34 can keep the same value as the `game_sessions` id.

## Errors

| Route | Condition | Code |
| --- | --- | --- |
| any | no session | `unauthorized` (the global guard) |
| any | body, query or path fails its schema | `invalid_input` |
| 9–13 | unknown id, or another user's run | `not_found` |
| 8 | no match fits | `empty_pool` + `emptyBecause` |
| 9 | side already chosen | `forbidden` |
| 10–13 | no side chosen yet | `invalid_input` |
| 10 | body `sessionId` ≠ path `:sessionId` | `invalid_input` |
| 10 | run over, before or after catch-up | `session_over` |
| 10 | `round_over`: the round expired before the guess arrived | `session_over` |
| 13 | run still active after the tick | `forbidden` |
| any | the squad loader throws, or anything else unexpected | `server_error` |

- Messages are short and safe to show: "That run no longer exists.", "Choose a side first.", "That round had already ended." They never include a guess, an alias or a player name.
- **The guess text is never logged**, and never echoed back in an error.

## E2E

`test/solo/solo.e2e-spec.ts`:

- It boots `AppModule` with `CLOCK` overridden by a test clock that the test moves forward.
- It plays as a guest (`POST /auth/guest`).
- It reads the chosen XI's aliases through Prisma, on the test side only, so it can type correct names.

Cases:

- **Perfect clear:** 11 correct names, then the summary is `perfect_clear` with 3 lives, accuracy 1 and a best streak of 11
- **Already found and not in the XI:** the round, lives and `endsAt` are all unchanged
- **One expiry:**
  - move past `endsAt + 400`, then `GET` shows 2 lives and a new round that starts at the old deadline
  - a guess sent after the deadline gets `session_over`
- **Three expiries:** the summary is `lives_out` with 0 lives
- **Quit:** mid-run quit gives a summary with `quit` and the lives kept
- **A new run ends the open one:** the old run's summary reads `quit`, and an untaken offer returns `not_found`
- **Quit after the lives run out:** returns the `lives_out` summary, not an error
- **Errors:**
  - the summary while the run is active gets `forbidden`
  - a second `chooseSide` gets `forbidden`
  - a guess before a side is chosen gets `invalid_input`
  - a mismatched body `sessionId` gets `invalid_input`
  - another guest's run gets `not_found`
  - filters with no match get `empty_pool`
- **Every success body parses with its contract schema.**
- **No response contains the name of a starter that hasn't been revealed yet.** This is checked against the test's own copy of the XI.

## Decisions

Settled at `/feature load`:

- **One open run per user.** Starting a new run ends the old one. If that run is being played, it is caught up to now first; if still unfinished, it then ends as `quit` with its lives kept. An offer with no side chosen is dropped. This keeps memory bounded, and B34 gets one clean result per run. Rejected: parallel runs, each with its own clock.
- **`quit` on a run that has already ended returns its summary unchanged.** This applies after lives run out, a perfect clear or an earlier quit, and matches the web mock. A player who taps Quit as the third life goes sees the real end reason (`lives_out`), not an error. Rejected: `session_over`, which `api-contract.md` doesn't list for `quit`.

## Out of Scope

- Database writes for runs, rounds, guesses and stats, and history entries for solo (B34)
- Guess and auth rate limits, `rate_limited` and `retryAfterMs` (B35)
- The solo daily cap for free users (monetization is Deferred)
- Real image URLs (B23)
- Wiring the web client (W29, in `lineup-web`)

## Notes

- Scope: the service, controller and module behind the six solo routes, plus the clock provider. Everything pure is in B33a.
- Depends on: B33a (the loader, store, views and summary); B25 `MatchSelectorService`; B12a `SessionGuard` and `@CurrentUser`; B03b's envelope and `@ContractResponse`.
- Constraints:
  - **HC 1, and "never trust a client-supplied user id, life count or elapsed time":**
    - The user comes from the session.
    - Lives and rounds come from the engine.
    - Time comes from `CLOCK`.
    - A client that stops calling still loses lives, because every call catches up first.
  - **HC 2:** only `solo-views.ts` builds payloads. The squad, an unrevealed player and a guess are never in a response, an error or a log.
  - **HC 9–11:** lives are lost only on expiry; a correct new name starts the next round; the round is 15 s plus 400 ms of grace on receipt. All of this comes from B30 and B31 unchanged.
  - **HC 17, 20:** the XI is exactly 11; the score is never read.
  - **Coding standards:** controllers stay thin (validate, call one service, return); every response uses the envelope.
- Verification:
  - `npm test`, `npm run test:e2e` (dev branch, with `MATCH_POOL_INCLUDE_UNSCORED=true`), `npm run build` and `npm run lint`
  - by hand: run `npm run start:dev`, then play a run with an HTTP client: guest, then match, side, guesses, sync after 16 s, then quit or the summary
  - `/docs` lists the six routes

**Deviations recorded during implementation**

- `src/common/clock.ts` exports `CLOCK`, `Clock` and a `SYSTEM_CLOCK` provider. `SoloModule` provides it; B38 can provide it too, or move it to a shared module.
- `SoloService` reads the `MatchIdentity` itself, through `PrismaService` and `MATCH_IDENTITY_SELECT`, because the selector returns only a match id.
- `start` selects the match before it ends the open run. An `empty_pool` refusal therefore leaves the player's open run untouched.
- `chooseSide` checks the offer again after the squad loads, so the loser of two concurrent picks gets `forbidden`.
- The eviction timer runs every 5 minutes.
- The `empty_pool` message is "No match fits those filters. Try widening them.". Engine rejections that can't happen in solo (`not_your_turn`, `wrong_mode`, `unknown_seat`) map to `forbidden`.
- The service unit tests use the real in-memory `SoloSessionStore`, which has no I/O, with a stubbed selector, loader and Prisma.
- Database test extras:
  - the `unauthorized` case
  - an empty guess and an unknown side
  - the hidden-player check covers every body, summaries included, because every guest is free
- A Neon query showed that no seeded player's name appears inside a club, competition, stage, nickname or teammate name, so that check can't fail by chance.
- Added in testing: `rejectionError` is exported, so the B30 rejection table is tested whole (B38 maps the same rejections). `solo.module.spec.ts` tests the eviction timer: every 5 minutes by `CLOCK`, unref'd, and stopped on destroy.

## History
