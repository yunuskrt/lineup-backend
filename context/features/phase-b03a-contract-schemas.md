# Phase B03a — Contract Schemas

## Status

Complete

## Goals

- `src/contract/` holding every request, response and socket payload as a Zod schema, transcribed from `context/api-contract.md`:
  - `common.ts`: id, epoch ms, ISO date and datetime, `imageUrl`, lives (0–3), and the enums `Side`, `CompetitionKind`, `PositionGroup`, `Tier`
  - `envelope.ts`: `ApiErrorCode`, `EmptyPoolReason`, `ApiError`, and a `resultSchema(data)` builder for `{ success: true, data } | { success: false, error }`
  - `match.ts`: `ClubRef`, `CompetitionRef`, `MatchIdentity`, `MatchInPlay` (with `formation` rules), `Filters`
  - `player.ts`: `RevealedPlayer`, `DuelFoundPlayer`
  - `round.ts`: `RoundTiming` (`endsAt > startedAt`), `GuessResult` (discriminated on `outcome`)
  - `auth.ts`, `catalog.ts`, `solo.ts`, `profile.ts`: the §4 REST request and response types
  - `duel.ts`: §5 command payloads and every `DuelEventMap` event payload
- `src/contract/protocol.ts`: `PROTOCOL_VERSION = 1`
- `src/contract/constants.ts`: §6 constants (round 15 000 ms, grace 400 ms, 3 lives, squad 11, guess, handle and password lengths, history page sizes, season range 2000–2025, reconnect 20 s). Schemas read their limits from here
- Every top-level schema registered with `.meta({ id: '<TypeName>' })` so B03b can emit it as a named OpenAPI component
- `*.spec.ts` next to each file: accept and reject cases for every rule `api-contract.md` states

## Conventions

These apply to every schema written from B03 onward:

- One file per domain in `src/contract/`. Each exports `fooSchema` and `type Foo = z.infer<typeof fooSchema>`. No hand-written type sits beside a schema.
- **`T | null` is `.nullable()` and `optional` is `.optional()`.** They're never swapped (`api-contract.md` §1).
- **Objects use `z.object`, which drops unknown keys.**
  - On input, that keeps an N-1 client that still sends a removed field working.
  - On output, it's a guard: a field nobody declared never reaches a client.
- Enums are `z.enum([...])` with values exactly as in `api-contract.md`.
- Limits come from `constants.ts`, never from a literal repeated inside a schema.

## Notes

- Scope: schemas, types, constants and their unit tests. No Nest code, no Swagger, no validation pipe: those are B03b.
- Depends on: B02 (`zod` installed).
- Sources:
  - `context/api-contract.md` is the transcription to follow.
  - Cross-check field rules against `../lineup-web/src/lib/api/schemas/` by reading only. Never import from it, and never copy a file across: `CLAUDE.md` says no shared code.
  - `common.test.ts` there is a good source of `imageUrl` cases.
- Constraints:
  - From here on, the backend owns the contract. Where the web transcription and a hard constraint disagree, the constraint wins and the gap goes under Deviations.
  - **No schema may carry a squad.** `MatchInPlay` and every session payload hold revealed players only (Hard Constraint 2). Tests assert that an unrevealed-player field gets stripped.
  - `imageUrl` keeps the root-relative branch for now (`api-contract.md` §3). Tightening it is a web task (W27).
  - `network` stays in `ApiErrorCode` for parity, but it's client-only. The server never sends it; B03b's filter enforces that.
  - `PROTOCOL_VERSION` starts at 1. The web adds its own copy at W30.
- Verification:
  - `npm test`: every contract spec passes.
  - `npm run build` and `npm run lint` pass.
  - Spot-check three payloads by hand against the web schemas: `MatchInPlay`, `SoloSummary`, `DuelSession`.

**Deviations recorded during implementation**

- Schemas register in a dedicated `contractRegistry` via `.register(contractRegistry, { id })`, not `.meta({ id })`. Zod's global registry would reject the same id when a module reloads in tests, and B03b emits only contract schemas.
- `HistoryQuery` is shaped for the query string: `cursor` is optional (absent means first page) and `limit` is coerced from text with a default of 20. The web types `cursor` as `id | null` and `limit` as a number. W32 sends them as query parameters.
- Empty success is `{ success: true, data: null }` (`EmptyResult`). The web types it `ApiResult<void>`, and JSON can't carry `undefined`. W27 parses `data: null`.
- `ApiError` enforces both conditional fields: `retryAfterMs` non-null only with `rate_limited`, `emptyBecause` present only with `empty_pool`. The web doesn't check this.
- `formation` requires every line to be 1–9 and the outfield to total 10. The web only checks this in the mock's `parseFormation`.
- Slot ↔ position consistency isn't enforced in the contract. It needs the formation, which only `MatchInPlay` carries. It's checked where the server builds reveals (B30/B33).
- Added `EraRange`, `ChooseSideRequest`, `DuelPhase`, `DuelCommand` and `DuelEventMap`. These are named here but inline or method-only on the web. `DuelActor` lives in `player.ts` because `DuelFoundPlayer` needs it.
- Test fixtures live in `src/contract/contract.fixtures.ts`. `tsconfig.build.json` now excludes `**/*.fixtures.ts` so they never ship.
- No spec for `catalog.ts`, `constants.ts` or `protocol.ts`: they hold no rule of their own (era is tested in `match.spec.ts`).
- `contractRegistry` is a subclass that throws on a duplicate id. Zod's own registry lets a second id overwrite the first silently, which would drop a component from the OpenAPI doc. `registry.spec.ts` covers it, so `registry.ts` now has a spec after all.
- For B03b: `z.toJSONSchema` puts a `$id` on each component, which has to be stripped before merging into `components.schemas`.
- For B39: `error` is an event name Socket.IO handled specially in older versions; confirm it's safe on v4 or rename it.

## History
