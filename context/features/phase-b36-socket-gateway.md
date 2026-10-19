# Phase B36 — Socket Gateway

## Status

Complete

## Goals

- **Dependencies:**
  - `@nestjs/websockets` and `@nestjs/platform-socket.io` 12.x (which bring `socket.io` 4.8)
  - `socket.io-client` 4.8 as a dev dependency, for the e2e suite
- **`src/contract/protocol.ts`:** `isSupportedProtocol(version)`. It is true only for `PROTOCOL_VERSION` and `PROTOCOL_VERSION - 1`, and never below 1 (**Handshake**).
- **`src/contract/socket.ts`:** the handshake and ack shapes, registered like the duel schemas:
  - `socketHandshakeSchema`: `{ token, protocolVersion }`, read from `socket.handshake.auth`
  - `socketAckSchema`, the ack every command gets: `emptyResultSchema` (§2's envelope, with `data: null`)
- **`src/duel/socket.adapter.ts`:** `LineupIoAdapter extends IoAdapter`. It builds the Socket.IO server from `Env` (**Server**). `main.ts` installs it with `app.useWebSocketAdapter`, next to `applyCors`.
- **`src/duel/socket-origin.ts`:** `allowRequest` refuses a foreign `Origin` before the upgrade, using the trusted list of `OriginCheckMiddleware` (**Server**).
- **`src/duel/socket-auth.service.ts`:** `SocketAuthService.authenticate(handshake)` returns a `User` or throws an `ApiException`. The checks run in order (**Handshake**):
  - the version gate
  - the token, through `GatewayTokenService.verify`
  - the user row, loaded fresh and mapped with `toContractUser`
- **`src/duel/duel.gateway.ts`:** `DuelGateway`, the one gateway:
  - `afterInit` adds the handshake as a Socket.IO middleware (`server.use`). A refused socket never reaches a handler.
  - `handleConnection` puts the `User` in `socket.data.user` and joins the room `user:<id>`
  - each command in `duelCommandSchemas` is a `@SubscribeMessage` handler, validated with its schema (**Commands**)
- **`src/duel/connection-registry.ts`:** `ConnectionRegistry`, one live socket per user (Open Questions 3). B37–B40 find a player's socket through it.
- **`src/duel/socket-envelope.filter.ts`:** `SocketEnvelopeFilter`, `@Catch()` scoped to the gateway. It turns every thrown error into the failure envelope in the command's ack (**Acks**).
- **`src/duel/duel.module.ts`:** `DuelModule`, importing `AuthModule` (for `GatewayTokenService`), registered in `AppModule`.
- **Tests:**
  - `src/contract/protocol.spec.ts`: N and N-1 pass; N-2, N+1, 0, negative, fractional and non-number versions fail
  - `src/duel/socket-auth.service.spec.ts` (verify and Prisma mocked):
    - a bad version is refused before the token is read
    - a `null` verify gives `unauthorized`
    - a missing user gives `unauthorized`
    - a found user maps to a fresh `User`, with `tier` from the server
    - nothing in a refusal echoes the token
  - `src/duel/socket-origin.spec.ts`: no `Origin` passes (mobile); the web app's origin passes; any other origin is refused
  - `src/duel/connection-registry.spec.ts`: register, replace, and remove only the current socket
  - `src/duel/socket-envelope.filter.spec.ts`:
    - an `ApiException` becomes its own error
    - any other error becomes `server_error` with the safe message, logged by its name only
    - no ack callback means no throw
  - `test/duel/gateway.e2e-spec.ts` (**E2E**), with the client helper in `test/duel/socket-client.ts`

## Server

- **Same process, same port (8080), default path `/socket.io`, default namespace.** HC 14: REST and sockets are one service.
- **Transports:** WebSocket and HTTP long-polling, which are Socket.IO's defaults. Polling needs sticky sessions once there's more than one instance (B45, B46).
- **`cors`:** `origin: [WEB_APP_URL]`, `credentials: false`. The credential is a token in the handshake, not a cookie, so no cookie crosses origins.
- **`allowRequest`:** CORS covers only the polling requests, not the WebSocket upgrade. A request whose `Origin` is not trusted is refused before any handshake work. No `Origin` passes, because mobile sends none. This is the same rule as `OriginCheckMiddleware` (B13a).
- **`maxHttpBufferSize: 16_384`**, matching the REST body limit. A larger frame closes the connection.
- **`pingInterval` and `pingTimeout`** keep Socket.IO's defaults (25 s and 20 s). B40 tunes them against its 20 s reconnect window.
- **`serveClient: false`.** The clients bundle their own `socket.io-client`.

## Handshake

The client connects with:

```ts
io(API_URL, { auth: { token, protocolVersion: PROTOCOL_VERSION } });
```

`token` is a `GatewayToken.token` from `GET /auth/token` (B12b). It is good for 5 minutes and is used once. A reconnect fetches a fresh one.

The checks run in this order, and the first failure refuses the socket:

| # | Check | Refusal | Message |
| --- | --- | --- | --- |
| 1 | `protocolVersion` is N or N-1 | `protocol_refused` | "This version of Lineup is out of date. Update to keep playing." |
| 2 | `token` is present, and `verify` returns a user id | `unauthorized` | `NO_SESSION` ("Sign in or continue as a guest first.") |
| 3 | That user still exists in `users` | `unauthorized` | `NO_SESSION` |

- **The version is checked first.** An old build is told to update, whatever else is wrong with its handshake. A missing or malformed `protocolVersion` counts as old.
- **A version newer than N is refused too.** The backend ships first, so a newer client is a deploy-order bug. It is logged as a warning with the version number.
- **The user is loaded from the database on every handshake** (the B12b observation). `isGuest` and `tier` come from the row, never from the token (HC 16). A user deleted after their token was issued is refused.
- **After the handshake, the connection stays authenticated** until it closes. A token that expires mid-connection doesn't matter. Signing out elsewhere doesn't close the socket; the next reconnect needs a new token, and that needs a session. The window is accepted, as B12b recorded.
- **Logging:** only the refusal code, plus the version number for a version refusal. Never the token, its claims or the user's email.

## Commands

The five commands in `duelCommandSchemas` (`queue:enter`, `queue:leave`, `filters:submit`, `duel:guess`, `duel:forfeit`) are registered now (Open Questions 2):

- **The payload is validated with its schema** through the existing `ZodValidationPipe`. A bad payload gets `invalid_input`, naming the fields only.
- **A valid payload gets `forbidden`, "Duels aren't open yet."** B37–B41 replace each handler with the real one.
- **An event that isn't a known command and has an ack** gets `invalid_input`, "Unknown command." (`socket.onAny`). One without an ack is ignored. A client that waits on an ack never hangs on a typo.
- Event names stay provisional until B39, as `src/contract/duel.ts` says.

## Acks

Every command is acked with §2's envelope, as `api-contract.md` §5 says:

| Handler result | Ack |
| --- | --- |
| returns | `{ success: true, data: null }` |
| throws `ApiException` | `{ success: false, error }`, parsed with `apiErrorSchema` |
| throws anything else | `{ success: false, error: server_error }` with `SERVER_ERROR_MESSAGE` |

- **`SocketEnvelopeFilter` is scoped to the gateway,** so it handles socket errors ahead of the global `EnvelopeExceptionFilter`. That filter rethrows outside HTTP (B03b), which would otherwise end up in Nest's default handler and its `exception` event.
- **An unexpected error is logged by its class name only.** A duel payload may hold the squad, so neither the message nor the stack is logged unless it's known to be safe. The B03b interceptor follows the same rule.
- **The global guards and interceptor stay out of the way:**
  - `SessionGuard` returns `true` outside HTTP (B12a)
  - `RateLimitGuard` skips outside HTTP (B35)
  - `ContractResponseInterceptor` passes through outside HTTP (B03b)

  The e2e suite proves all three, since a command ack would fail if any of them ran.
- **Server-to-client events** (`error`, and B37's `queued` onwards) are plain payloads, not envelopes, as in `DuelEventMap`.

## E2E

`test/duel/gateway.e2e-spec.ts` boots `AppModule` with `LineupIoAdapter`, listens on port 0, and connects with `socket.io-client`. Guests come from `POST /auth/guest` and tokens from `GET /auth/token`.

- **Accepted:** a guest with version N connects. A `queue:enter` with an ack gets the `forbidden` envelope, which proves the handshake set the user and the global guards let the event through.
- **Version:**
  - version N-2, a missing version or a string version gets `connect_error` with `protocol_refused`
  - so does a bad token sent with an old version, because the version is checked first
- **Token:** a missing, tampered or expired token (signed with `auth.api.signJWT` and a past `exp`, as in B12b) gets `connect_error` with `unauthorized`.
- **Deleted user:** a token issued before the guest was deleted is refused with `unauthorized`.
- **Origin:**
  - a foreign `Origin` header is refused before the handshake
  - no `Origin` connects
  - the web origin connects
- **One socket per user:** a second connection with a fresh token gets in, and the first gets an `error` event (`forbidden`) and is disconnected.
- **Commands:**
  - `filters:submit` with a bad payload gets `invalid_input`
  - `duel:guess` with a valid payload gets `forbidden`
  - an unknown event with an ack gets `invalid_input`
  - every ack parses with `socketAckSchema`
- **No envelope leaks:** no ack or `connect_error` contains the token, and none contains a stack trace.
- **REST still works on the same port:** `GET /auth/session` answers as usual.
- **Size:** a frame over 16 KB closes the connection.
- **Cleanup:** the suite deletes its guests and closes every client.

## Open Questions

All three settled at `/feature load`, each as recommended.

1. **How is a refused handshake reported?** Socket.IO has no ack for the connection itself.
   - **Recommended: `connect_error`.** The middleware calls `next(err)`; `err.message` is the code and `err.data` is the failure envelope `{ success: false, error: ApiError }`. The socket is never connected, so a refused client gets no handler and no room. The web's `connect()` resolves on `connect` and maps `connect_error`'s `data` to its `ApiResult`.
   - Rejected: accept the socket, send an `error` event, then disconnect. It does work for a client that should never have got in, and it races the client's first command.
2. **What do the duel commands answer before B37?**
   - **Recommended: register all five now, validate them, and answer `forbidden`, "Duels aren't open yet."** W30 gets real acks to wire against, the envelope and the validation are proven over the wire, and B37–B41 only replace each handler's body.
   - Rejected: no handlers until B37. Socket.IO would drop the events, and a client waiting on an ack would hang until its own timeout, a silent failure on a game action.
3. **What if one user opens a second connection** (two tabs, or a phone and a browser)?
   - **Recommended: the latest connection wins.** The older socket gets an `error` event (`forbidden`, "You're connected somewhere else.") and is disconnected. B37–B40 then route a player's events to exactly one socket, and B40's reconnect is just a new connection replacing the dropped one.
   - Rejected: allow many, which means every duel event fans out to several sockets and a guess can arrive from two places.
   - Rejected: refuse the newer one, which locks a player out behind a dead tab until the ping timeout.

## Out of Scope

- Matchmaking and the duel itself (B37–B39); the reconnect window and forfeit (B40); duel persistence (B41)
- Socket rate limits (B42). That includes a limit on handshake attempts; until then each attempt costs a JWT check and one user read.
- The two-client harness (B43). `test/duel/socket-client.ts` is a start it can build on.
- The Redis adapter for several instances (B46), and sticky sessions (B45)
- Bumping `PROTOCOL_VERSION`. It stays 1, so today only version 1 connects.

## Notes

- Scope: a single spec. It covers the Socket.IO server, the handshake gates, one-socket-per-user tracking, command acks and the placeholder commands. All of it is proven by one socket e2e suite. Matchmaking starts in B37.
- Depends on:
  - B03a (`PROTOCOL_VERSION`, `duelCommandSchemas`) and B03b (the envelope, and the filter and interceptor skipping non-HTTP)
  - B12a (`SessionGuard` skips non-HTTP) and B12b (`GatewayTokenService.verify`, exported from `AuthModule`)
  - B13a (the trusted origins) and B35 (`RateLimitGuard` skips non-HTTP)
- Constraints:
  - **HC 8:** every handshake is version-checked; N and N-1 are accepted, and anything older is refused with an update message.
  - **HC 16 and "never trust a client-supplied user id":** the user id comes only from a verified token's `sub`. The tier comes from the server.
  - **CLAUDE.md:** no token, claim or squad in a log, an ack or an error. Nothing about the squad exists in this phase, but the filter's logging rule is set for B38.
  - **"Never fail silently on a game action":** every command with an ack gets one, including unknown ones.
  - The gateway holds no game logic. `src/game/` is untouched.
  - No `any`; `@/` imports; comments single-line, at most 50 characters
- Carried forward:
  - **B38:** reuse `CLOCK` (`src/common/clock.ts`) for round timing, as solo does
  - **B39:** never send a guess's text to the opponent
  - **B40:** `pingTimeout` decides how fast a drop is noticed, so tune it with the 20 s window
- For W30 (web): the URL is the API's origin; the auth fields are `token` and `protocolVersion`. A refusal arrives as `connect_error` with the failure envelope in `data`. An `error` event with `forbidden` means another connection took over. Give the web session this after the phase, as was done for W32.
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`
  - By hand on `npm run start:dev`:
    - get a guest cookie and a token with curl
    - connect with a small `socket.io-client` script, once with version 1 and once with version 0
    - see `connect` for the first and `connect_error` with `protocol_refused` for the second
    - send `queue:enter` and see the `forbidden` ack
    - check that the server log holds no token

**Deviations recorded during implementation**

- **Nest runs no global filter on a gateway at all.** Its socket `ExceptionFiltersContext` returns no global metadata, so `EnvelopeExceptionFilter` never sees a socket error. `SocketEnvelopeFilter`, set with `@UseFilters` on `DuelGateway`, is the only filter. Global guards and interceptors do run, and skip outside HTTP as planned.
- **The placeholders validate inside the handler.** Each one calls `refuseUntilOpen(command, payload)`, which runs `ZodValidationPipe.transform` and then throws `forbidden`. A `@MessageBody(pipe)` parameter that's never used fails lint. B37 moves the pipe onto the real handler's body.
- **A failed command sent with no ack gets an `error` event.** The spec only said the filter mustn't throw. Without an ack, the client would never hear of the failure ("never fail silently").
- **A database failure during the handshake is a `server_error` refusal,** not `unauthorized`. `SocketAuthService` lets the error through, and the gateway maps it, logging the class name only.
- **An origin refusal isn't an envelope.** Engine.io answers 403 with `ORIGIN_REFUSED` before Socket.IO's handshake, so the client's `connect_error` has no `data`. The e2e suite checks both transports.
- **`socket.io` is a direct dependency** (4.8.4, the version `@nestjs/platform-socket.io` pins), because the gateway imports its types.
- **`trustedOrigins(env)` moved out of `OriginCheckMiddleware`** into an exported function, so the socket origin check uses the same list.
- **`socketAckSchema` is `emptyResultSchema` itself.** It is already registered as `EmptyResult`, and a second id would replace the first. `SocketHandshake` is a new registered component. `src/contract/openapi.ts` and `registry.spec.ts` import `socket.ts`.
- **Where things live:**
  - `socketError`, `failureAck` and `handshakeRefusal` sit in `socket-envelope.filter.ts`
  - `DUELS_NOT_OPEN`, `REPLACED`, `UNKNOWN_COMMAND` and `roomOf` are exported from the gateway
  - `OUT_OF_DATE` is exported from `SocketAuthService`
  - `ConnectionRegistry` is generic over anything with an `id`, so the unit test uses plain objects
- **Logging:** a refusal is logged at debug level as `Handshake refused: <code>`. A version newer than N also logs a warning.
- **Tests:**
  - **Unit:** 911 in all (50 new): `protocol.spec.ts`, `socket-auth.service.spec.ts`, `socket-origin.spec.ts`, `connection-registry.spec.ts` and `socket-envelope.filter.spec.ts`
  - **E2E:** 367 in all (26 new), in `test/duel/gateway.e2e-spec.ts`. Every existing suite still passes with a socket server on its app.
- **Mutation checks:**
  - with the origin gate removed, both foreign-origin cases fail
  - with the gateway filter removed, 7 command and replacement cases fail
- **By hand,** on the built server (port 8081, since 8080 was in use):
  - a guest's token connected at version 1, and `queue:enter` got the `forbidden` ack
  - version 0 got `connect_error` `protocol_refused` with the envelope in `data`
  - the log held one debug line and no token
  - the test guest was deleted
- **Seen in passing, not changed:**
  - a full `tsc` that includes spec files flags `src/matches/match-refs.spec.ts` (from B33a); the build excludes spec files
  - Prettier still flags `test/auth/session-guard.e2e-spec.ts`, as B12b recorded
- **Review:**
  - **Simplified:** the gateway builds its `REPLACED` and `UNKNOWN_COMMAND` errors with `new ApiException(...).error`, like every other error, instead of a hand-built `ApiError`.
  - **Checked:** `allowRequest` runs only on a new handshake. Later polling requests and the WebSocket upgrade carry the session's `sid` and skip it. That's safe: the `sid` is unguessable and only goes to a client whose handshake passed the check.
  - **For W30:** a replaced socket is closed with `disconnect(true)`, so its client sees `io server disconnect` and doesn't reconnect by itself. The web must not reconnect after the `forbidden` "connected somewhere else" error either, or two tabs would keep taking over from each other.
- **Added at `/feature test`:** 5 unit cases.
  - `src/duel/socket.adapter.spec.ts` (4):
    - the 16 KB frame cap
    - CORS for the web app only, with no credentials
    - the origin gate trusts the same list as the REST check
    - the env's options win over a gateway's own. Flipping the merge order fails this case.
  - `socket-auth.service.spec.ts`: a `null` handshake is refused as out of date
  - **Coverage from unit tests:**
    - 100% lines, branches and functions for `protocol.ts`, `socket.ts`, `connection-registry.ts`, `socket-envelope.filter.ts`, `socket-origin.ts`, `socket.adapter.ts` and `origin-check.middleware.ts`
    - `socket-auth.service.ts`: 100% lines; 94.73% branches. The missed branch is the constructor metadata on `@Injectable()`, as in B12a.
    - `duel.gateway.ts` and `duel.module.ts` are wiring, covered by the 26 e2e cases
  - **Totals:** 916 unit and 367 e2e.

## History
