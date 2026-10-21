# Phase B39 — Duel Events

## Status

Complete

## Goals

- **`src/contract/duel.ts`:** the event and command names are final (**Names**). The "provisional until B39" comment goes. `DUEL_COMMAND_REFUSALS` lists the error codes each command's ack can carry, taken from the B37 and B38 tables.
- **`src/contract/socket.ts`:**
  - `ServerToClientEvents`: one listener type per `DuelEventMap` entry
  - `ClientToServerEvents`: one emitter type per command, with its payload and a `SocketAck` callback
  - `socketCatalog()`: every command (payload component, ack component, refusal codes) and every event (payload component), by component id (**Catalogue**)
- **`src/duel/duel.gateway.ts`:** `DuelSocket` and `DuelServer` are typed with both maps, so every `emit` in `src/duel/` is checked against the contract at compile time.
- **`src/duel/duel-notifier.ts`:** every event is checked against its schema before it leaves (**Fail closed**).
  - `toUser(userId, event, payload)` emits the parsed payload, so a key that isn't in the contract is stripped
  - a payload that fails is never sent: the log gets its paths and codes, and the player gets `error` `server_error`
  - `toSocket(socket, event, payload)` does the same for one socket. The gateway's "connected somewhere else" error uses it, since the old socket and the new one share `user:<id>`.
- **`src/docs/setup-docs.ts`:** the OpenAPI document gains `x-socket`, the catalogue, with each schema as a `$ref` into `components` (Open Questions 1).
- **Tests:**
  - `src/duel/duel-notifier.spec.ts`:
    - a valid payload goes out
    - an extra key (an `aliases` field on a found player) is stripped
    - a failing payload is replaced by `error` `server_error`, and the log names paths and codes but no value
    - `toSocket` behaves the same
  - `src/contract/socket.spec.ts`:
    - the catalogue holds every `duelCommandSchemas` and `DuelEventMap` entry, and nothing else
    - every component id it names exists in the registry
    - every command lists `server_error` and `invalid_input`
  - `test/contract.e2e-spec.ts`: `/docs/openapi.json` carries `x-socket`, and every `$ref` in it resolves to a component of the document

## Names

The names in `duelCommandSchemas` and `duelEventSchemas` are kept as they are, and are final from this phase:

- **Commands:** `queue:enter`, `queue:leave`, `filters:submit`, `duel:guess`, `duel:forfeit`
- **Events:** the 15 keys of `DuelEventMap`, `error` included

Why keep them:
- **The web's W30 socket client already uses these names.** Renaming any of them now is a breaking change, so it would need a `PROTOCOL_VERSION` bump in every repo.
- **`error` is safe on Socket.IO v4.** The v4 server reserves only `connect`, `connect_error`, `disconnect`, `disconnecting`, `newListener` and `removeListener` (B03a asked for this check). Earlier versions handled `error` specially. B36–B38's e2e suites already send it and receive it as a plain event.

## Fail closed

The same rule as REST (B03b): nothing off-contract leaves the server.

- **Every payload is parsed with its `duelEventSchemas` entry** inside `DuelNotifier`, the one place duel code emits. The parsed value is what's sent, so a field added by mistake, such as a squad player's aliases, is stripped rather than leaked (HC 2).
- **A payload that fails** is not sent (Open Questions 2):
  - the log line names the event and each issue's path and code, never the value
  - the player gets `error` with `server_error` and `SERVER_ERROR_MESSAGE`, which always parses

  The web drops an event that fails its schema without telling the player (`reportDrift`), which would be a silent failure on a game action.
- **Acks are already safe:**
  - success is the `SUCCESS_ACK` constant
  - failures are built from an `ApiError` that `socketError` has parsed (B36)

  This phase adds a test that both parse with `socketAckSchema`.

## Catalogue

`socketCatalog()` is built from the contract, so it can't drift from the code:

```json
{
  "commands": {
    "duel:guess": {
      "payload": "DuelGuessRequest",
      "ack": "EmptyResult",
      "refusals": ["invalid_input", "session_over", "forbidden", "rate_limited", "server_error"]
    }
  },
  "events": { "matchReady": "DuelSession", "error": "ApiError" }
}
```

- `payload` is `null` for a command that takes none.
- `rate_limited` is listed for `duel:guess` now, since B42 adds it and the web already handles it.
- In the OpenAPI document, each id becomes `{ "$ref": "#/components/schemas/<id>" }`. The components are there already, since B03a registered every duel schema.

## Screen states

Every state the duel screen can be in, and the event that puts it there:

| Screen state (`DuelPhase`) | Entered by | Since |
| --- | --- | --- |
| `queued` | `queued`; left by `queueTimedOut` | B37 |
| `paired` | `paired` | B37 |
| `filters` | `filtersUpdated` | B38a |
| `match_ready` | `coinFlip`, then `matchReady` | B38a |
| `playing` | `roundStarted`, `turnChanged`, `guessResolved`, `playerRevealed`, `lifeLost` | B38b |
| `finished` | `finished` | B38b |

`opponentConnection` and `disconnected` arrive with B40. The catalogue lists them now, because the contract does.

## Open Questions

Both settled at `/feature load`, each as recommended.

1. **Should the socket contract be published in machine-readable form?** The coding standards say OpenAPI doesn't cover sockets, so the clients transcribe them by hand.
   - **Recommended: an `x-socket` extension in `/docs/openapi.json`.** It's built from the same schemas, references the components the document already has, and gives W31 and mobile one file to check their copies against.
   - A separate `/docs/socket.json`: the same content, but a second document to find and keep linked.
   - Nothing: `api-contract.md` stays the only description of the socket contract, and it was written before the backend existed.
2. **What happens to an event that fails its schema?**
   - **Recommended: don't send it.** Log the paths and codes, and send `error` `server_error` instead, so the player always hears something.
   - Send it anyway and log: the web would drop it silently.
   - Throw: the step's state is already saved and the other player's events may have gone out, so throwing leaves the two players out of step.

## Out of Scope

- `opponentConnection`, `disconnected` and the reconnect window (B40)
- Persistence (B41), socket rate limits (B42), the two-client harness (B43)
- Any change to a payload's shape. This phase checks shapes; it doesn't change them, so `PROTOCOL_VERSION` stays 1.

## Notes

- Scope: a single spec, covering the typed socket maps, the fail-closed notifier, the frozen names and the catalogue. It's proven by the unit suite and a docs check in the contract e2e.
- Depends on:
  - B03a (`duelEventSchemas`, `duelCommandSchemas`, the registry) and B03b (the REST fail-closed rule)
  - B36 (`socketError`, `SocketAck`) and B37–B38 (every emit goes through `DuelNotifier`, and the refusal tables)
- Constraints:
  - **HC 2:** the schema strip is a second guard on the squad. The views remain the first.
  - **"Never fail silently":** a failing event becomes an `error`, never nothing.
  - **CLAUDE.md:** a failing event's log line holds paths and codes only, never the value.
  - No `any`; `@/` imports; comments single-line, at most 50 characters
- For W31 (web) and mobile: compare their copies of the socket contract against `x-socket`. The names are final.
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`
  - By hand: fetch `/docs/openapi.json` and check `x-socket` lists 5 commands and 15 events. Play one duel move with two `socket.io-client` scripts and see every event arrive.

**Deviations recorded during implementation**

- **`DUEL_COMMAND_REFUSALS` declares its own `ServerErrorCode`** (`ApiErrorCode` without `network`), since `src/contract/` can't import `src/common/`. It's checked with `satisfies` against every command.
- **`socketDoc()` lives in `src/contract/openapi.ts`,** next to `contractComponents`. `setupDocs` spreads `x-socket` onto the document, because Nest's `OpenAPIObject` type has no index for extensions.
- **`DuelNotifier.send` holds the one cast,** to a plain `emit(event, payload)`: a generic emit can't narrow a typed event map (B37's finding). The schema check right before it is what makes the cast safe.
- **The envelope filter still emits its own `error`** for a failed command sent without an ack. That `ApiError` has already been parsed by `socketError` (B36), and the filter isn't built by DI, so it doesn't go through the notifier.
- **The ack check sits in `src/duel/socket-envelope.filter.spec.ts`,** not `src/contract/socket.spec.ts`, so a contract spec never imports duel code.
- **Added to the gateway suite:** the newer connection in the "latest wins" case must hear nothing. A mutation sending the takeover notice to `user:<id>` instead of the old socket passed every test until then, and that mutation would close the new tab too.
- **Tests:**
  - **Unit:** 1044 in all (11 new), in `duel-notifier.spec.ts`, `socket.spec.ts` and `socket-envelope.filter.spec.ts`
  - **E2E:** 401 in all (1 new case in `test/contract.e2e-spec.ts`, plus the new check in the gateway suite)
- **Mutation checks:**
  - emitting the raw payload instead of the parsed copy fails the strip case
  - sending an off-contract payload anyway fails 3 cases
  - the takeover notice sent to the user's room fails the replacement case (after the check above was added)
- **By hand,** on the built server (port 8081):
  - `/docs/openapi.json` carries `x-socket` with the 5 commands and 15 events, and every `$ref` names an existing component
  - two guests played to `matchReady`, then a miss and a forfeit; every event arrived, and the log has no contract failure
  - both guests were deleted
- **Review:** no changes needed.
  - **Checked:** the refusal lists match the B37 and B38 command tables exactly. An unknown command's `invalid_input` isn't listed, because it isn't a command.
  - **Checked:** no event schema has a `transform`, `trim` or `default`. The only `trim` is on guess text, inside a command. So the parsed copy differs from the payload only in stripped keys. A future event schema with a transform would change what clients get, so keep event schemas transform-free.
  - **Checked:** the takeover notice still reaches the old socket before `disconnect(true)`, since both run in order in `handleConnection`.
  - **Checked:** a failure log names the event and each issue's path and code. The strip case's `aliases` and the broken payload's name never reach a log or a client.
  - **Left alone:** `coding-standards.md` still says OpenAPI doesn't cover socket payloads. That file is shared by all three repos, and the core of the rule still holds: each client keeps its own hand-written copy. `x-socket` only gives those copies something to check against.
- **At `/feature test`:** 3 new `socketDoc` cases in `socket.spec.ts`. Unit tests are now 1047 in all (14 new in B39).
  - every id becomes a `$ref` into components
  - a command with no payload keeps `null`
  - the document covers the same commands and events as the catalogue
  - **Coverage from unit tests:**
    - 100% lines, branches and functions for `duel-notifier.ts` and `duel.ts`
    - `socket.ts`: 100% lines, 75% branches. The miss is `idOf`'s throw for an unnamed schema, which can't happen while every socket schema is registered. It stays so the catalogue test fails loudly if an unnamed one is ever added.
    - `socketDoc` in `openapi.ts` is now covered by unit tests too. The rest of `openapi.ts` and `setup-docs.ts` is covered by the contract e2e.

## History
