# Phase B42 — Socket Rate Limiting

## Status

Complete

## Goals

- **`src/common/rate-limits.ts`:** a `SOCKET_LIMITS` table beside `RATE_LIMITS`, with one limit per duel command and a default (**Limits**).
- **`src/duel/socket-rate-limit.guard.ts`:** `SocketRateLimitGuard`, a Nest guard for the gateway's `ws` context.
  - It counts each command against the throttler storage that B35 already uses (`@nestjs/throttler`'s `ThrottlerStorage`), so B46's Redis swap covers sockets too.
  - The key is the user and the command (**Keys**).
  - Over the limit, it throws `ApiException('rate_limited', lockoutMessage(ms), { retryAfterMs })`. `SocketEnvelopeFilter` already turns that into a failure ack, or into an `error` event when the command was sent without an ack (**Lockout**).
  - It skips everything when `RATE_LIMITS_ENABLED` is false, as the REST guard does.
- **`src/duel/duel.gateway.ts`:** `@UseGuards(SocketRateLimitGuard)` on the gateway. A `@SocketLimit(name)` decorator gives a handler its own limit; any other command gets the default.
- **`src/contract/duel.ts`:** `DUEL_COMMAND_REFUSALS` lists `rate_limited` for every command, not only `duel:guess`, so `x-socket` reflects it. The "Sent from B42" comment goes.
- **Tests:**
  - `socket-rate-limit.guard.spec.ts`, with an in-memory throttler storage:
    - the key is the user id plus the command, never the socket id or anything the client sends
    - a handler without `@SocketLimit` gets the default
    - the call over the limit throws `rate_limited`, with `retryAfterMs` in milliseconds and never below 0, and the message names the wait
    - two users, or two commands of one user, never share a count
    - an `http` context, or limits switched off, is skipped
  - `rate-limits.spec.ts`:
    - every socket limit is positive
    - the guess limit equals the REST guess limit (12 per 3 s)
    - every `SOCKET_LIMITS` name is a duel command
  - `src/contract/socket.spec.ts`: every command's refusals include `rate_limited`
  - `test/duel/socket-rate-limit.e2e-spec.ts` (**E2E**)

## Limits

Provisional values, tuned once real traffic exists, like B35's.

| Command | Limit | Why |
| --- | --- | --- |
| `duel:guess` | 12 / 3 s | The same as the REST guess and the web mock. It's the dictionary-spam limit from overview § G |
| `queue:enter` | 10 / 60 s | Rapid re-queueing pairs and drops opponents, and each drop sends that opponent "Your opponent left." |
| `filters:submit` | 10 / 60 s | Each submission runs a pool query against Postgres |
| default (`queue:leave`, `duel:forfeit`) | 120 / 60 s | The same as REST's default: deny-by-default, so a new command is never unlimited by accident |

- **Each command keeps its own count,** as each REST route does (a B35 deviation). Guessing fast never blocks `duel:forfeit`.
- **Every call counts,** including ones the handler would refuse: out of turn, an invalid payload, already queued. The guard runs before the pipes and the handler, so a bot can't spam free refusals.
- **The guess limit also bounds a duel's effect log** (B41), as B35's limit bounds a solo run's.

## Keys

- **The user id from the handshake** (`socket.data.user`, set by B36 from the verified JWT), never anything the client sends. The todo says "per-connection"; keying on the user is stricter, because a reconnect or a second tab opens a new connection but keeps the same count (Open Questions 1).
- **Prefixed `socket:<command>:user:<id>`,** so a socket count never collides with a REST route's count in the shared storage.
- **No guess text** is ever part of a key or a log line.

## Lockout

- **With an ack:** `{ success: false, error: { code: 'rate_limited', message, retryAfterMs } }`. The web's duel guess already reads `retryAfterMs` into its cooldown.
- **Without an ack:** the same `ApiError` arrives as an `error` event, through the envelope filter (B39's note).
- **The message is `lockoutMessage`'s,** as on REST ("Too many attempts. Try again in 3 seconds."). It never names the limit.
- **A refused command does no work.** A blocked guess isn't judged and leaves no effect, but the round clock keeps running and the next allowed call catches up as usual.
- **Once over the limit, the user is blocked for a full window,** the throttler's default, as on REST.

## E2E

`test/duel/socket-rate-limit.e2e-spec.ts` boots `AppModule` with `RATE_LIMITS_ENABLED` switched back on through an `ENV` override, as `test/http/rate-limit.e2e-spec.ts` does:

- **Guesses:**
  - the player on turn sends 12 misses inside 3 s and each is acked `success`
  - the 13th gets `rate_limited`, with `retryAfterMs` > 0 and the lockout message
  - the refused guess sent no `guessResolved`, and the duel is unchanged: same turn, same lives
  - the opponent's next turn isn't limited by the first player's count
  - after the window, the first player can guess again
- **Per user, not per socket:** a player who reconnects mid-lockout is still refused.
- **Queue:** the 11th `queue:enter` within a minute gets `rate_limited`, even though the earlier ones were refused as already queued.
- **No ack:** a limited command sent without an ack brings an `error` event with `rate_limited`.
- **Envelope:** every refusal parses with `socketAckSchema` or `apiErrorSchema`, and no message contains a guess or a limit name.
- **Cleanup:** `removeGuests`, as in B41.

## Open Questions

Both settled at `/feature load`, as recommended.

1. **What does a socket limit count against?**
   - **Recommended: the user id from the handshake.** A reconnect or a second tab can't reset it, and it matches B35's per-user REST keys.
   - The connection (socket id), as the todo line words it. Simpler, but every reconnect starts a fresh count, and a bot reconnects for free with one token.
2. **Which commands are limited?**
   - **Recommended: every command.** `duel:guess`, `queue:enter` and `filters:submit` get their own limits; the rest share a default. This is REST's deny-by-default rule.
   - Only `duel:guess`, the one overview § G names. Queue spam and repeated pool queries stay unlimited.

## Out of Scope

- **Handshake rate limits.** The token route (30 per minute, B35) bounds how many tokens a user gets, but one token can open many sockets in its 5 minutes. An IP-keyed handshake limit needs `TRUST_PROXY_HOPS` set in production, which is B45.
- **Disconnecting an abusive socket.** A refusal is enough at MVP.
- **Unknown commands.** `answerUnknown` already refuses them without any work.
- **Redis-backed counts** shared across instances (B46)
- **Alerting on lockout spikes** (B44)

## Notes

- Scope: a single spec. It covers the guard, the limits table, the refusal lists and the tests, proven together by the unit suite and a socket e2e.
- Depends on:
  - B35: the throttler module and its storage, `lockoutMessage`, `RATE_LIMITS_ENABLED`, and the REST guard that skips non-HTTP contexts
  - B36: the handshake that sets `socket.data.user`, and `SocketEnvelopeFilter`
  - B39: `DUEL_COMMAND_REFUSALS` and `x-socket`
- Constraints:
  - **Overview § G:** "Server-side rate limiting on guesses ... on the HTTP path and the socket path alike." B35 covered HTTP; this phase covers sockets.
  - **"Never trust a client-supplied user id":** the key comes from the verified handshake.
  - **"Never fail silently on a game action":** a refused guess always gets a `rate_limited` ack or `error` event.
  - **CLAUDE.md:** a refused guess is never logged or echoed.
  - **HC 15:** limits are the same for every tier.
  - Limits use wall-clock time, not `CLOCK`, as on REST.
  - No `any`; `@/` imports; comments single-line, at most 50 characters
- **Contract:** additive only. `rate_limited` joins the refusal lists of four commands, and no payload changes, so `PROTOCOL_VERSION` stays 1. For W31: any command's ack can now carry `rate_limited`, not just `duel:guess`'s.
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`
  - By hand: a script sends 13 guesses within 3 s and sees the 13th refused, with the message and `retryAfterMs`. The guess text must be absent from the server log.

**Deviations recorded during implementation**

- **No `@SocketLimit` decorator.** The guard reads the command from `context.switchToWs().getPattern()` and looks it up with `socketLimitOf`. A command with no entry gets the default. Nothing on a handler can drift from the table, and a new command is limited without anyone remembering a decorator.
- **`SOCKET_LIMITS` is checked against `DuelCommand`** with `satisfies`, so a misspelled command doesn't compile. `duel:guess` reuses `RATE_LIMITS.guess`, so the two guess limits can't diverge.
- **`socketLimitOf` uses `Object.hasOwn`** and skips the `default` key. A pattern such as `toString` or `__proto__` falls to the default, never to a prototype value.
- **`socketKey` is exported** for the unit test. The throttler name passed to the store is `socket`.
- **`SocketRateLimitGuard` is listed in `DuelModule`'s providers.** Its dependencies, `ThrottlerStorage` (the throttler module is global) and `ENV`, resolve there.
- **E2E:** 3 cases, with 4 guests in all. REST limits are on in this suite, so `POST /auth/guest` is held to 10 per hour from 127.0.0.1. The duel case covers:
  - the 13th guess
  - the duel left unchanged, seen through the reconnect snapshot
  - the reconnected socket still refused
  - the window reopening
  - the opponent's own count
- **Tests:**
  - **Unit:** 1118 in all (20 new), in `socket-rate-limit.guard.spec.ts`, `rate-limits.spec.ts` and `socket.spec.ts`
  - **E2E:** 412 in all (3 new, in `test/duel/socket-rate-limit.e2e-spec.ts`)
- **Review:** one tidy-up, no fixes needed.
  - **Changed:** dropped a second comment line stacked on `DUEL_COMMAND_REFUSALS`; `socket.spec.ts` already states the rule.
  - **Checked:** a misspelled `SOCKET_LIMITS` key fails `tsc` ("does not exist in type"), so the `satisfies` check works.
  - **Checked:** `SocketEnvelopeFilter` returns an `ApiException`'s error without logging it, so lockouts add no log noise and never carry a guess.
  - **Checked:** the global `SessionGuard` and `RateLimitGuard` still skip `ws` contexts, so the socket guard is the only limiter on a command.
  - **Checked:** connection and disconnect hooks don't pass through guards, so a handshake is never counted. That matches Out of Scope.
  - **Checked:** a rate-limited guess skips the handler, so it applies no catch-up tick either. The round timer still fires on its own, so the clock is never held back.
  - **Checked:** socket keys are plain `socket:...` strings. REST keys are the throttler's hashes, so the two never collide in the shared store.
  - **Left alone:** the mock map says "12 guesses per 3 s per session". The real limit is per user, which is stricter and was settled at load.
- **At `/feature test`:** no new tests were needed.
  - **Coverage from unit tests:** 100% of statements, branches, functions and lines for `socket-rate-limit.guard.ts`, `rate-limits.ts` and `contract/duel.ts`
  - **Mutation checks,** each caught:
    - by the unit suite:
      - keyed on the socket id
      - keyed without the command
      - limits never switched off
      - the wait left in seconds
      - a negative wait
      - every command on the default
      - prototype keys read with `in`
    - by the e2e suite: the guard removed from the gateway
  - **By hand,** on the built server (port 8081, with `RATE_LIMITS_ENABLED=true` set over the dev `.env`, which has it off):
    - `/docs/openapi.json`: `x-socket` lists `rate_limited` for all five commands
    - two guests played to `matchReady`. The player on turn sent 13 misses in 26 ms: 12 were acked and judged (12 `guessResolved`), and the 13th got `rate_limited`, "Too many attempts. Try again in 3 seconds.", `retryAfterMs` 3000.
    - a `duel:forfeit` straight after the lockout went through, since it has its own count, and B41 saved the duel
    - the guess text never appeared in the server log, which held no errors
    - the guests and their session were then deleted

## History
