# API Contract — as the web client expects it

A plain-text transcription of what `lineup-web` sends and expects today, taken from `src/lib/api/schemas/`, `src/lib/api/client.ts` and `src/lib/api/duel-client.ts`.

**Use it as the starting point for B03.** Once the backend defines the contract in OpenAPI, the backend is right and this file is history. REST paths and socket event names are **suggestions**: the web client only knows method names, so the backend chooses the final routes. Field names, types and rules are what the web actually validates.

---

## 1. Conventions

| Rule | Detail |
| --- | --- |
| Ids | Non-empty strings. Format is the backend's choice. |
| Timestamps in a round | Epoch milliseconds (integer, ≥ 0), from the **server** clock. |
| `playedAt` | ISO 8601 datetime string. |
| Match `date` | ISO date, `YYYY-MM-DD`. |
| Nullable vs optional | `T \| null` means the field is always present. `optional` means it may be absent. |
| Squad size | 11. Lists of players are at most 11 long. |
| Lives | Integer 0–3. |

---

## 2. Result envelope

**Every** REST response, and every socket ack, uses one of two shapes:

| Shape | Fields |
| --- | --- |
| Success | `success: true`, `data: <payload>` |
| Failure | `success: false`, `error: ApiError` |

`ApiError`:

| Field | Type | Rule |
| --- | --- | --- |
| `code` | `ApiErrorCode` | See below |
| `message` | string | Non-empty, safe to show the player. No stack traces, SQL or provider text. |
| `retryAfterMs` | integer ≥ 0, or `null` | Set with `rate_limited`; `null` otherwise. |
| `emptyBecause` | `EmptyPoolReason`, optional | Present **only** with `empty_pool`. |

### Error codes (`ApiErrorCode`)

| Code | Meaning |
| --- | --- |
| `unauthorized` | No session, or bad credentials |
| `forbidden` | Not allowed right now (wrong turn, already registered, run not over yet…) |
| `not_found` | Session or resource doesn't exist |
| `invalid_input` | Request failed validation, or the handle is taken |
| `empty_pool` | No match fits the filters. Comes with `emptyBecause`. |
| `rate_limited` | Too many guesses. Comes with `retryAfterMs`. |
| `session_over` | The run or duel has finished, or the round already ended |
| `network` | **Client-only.** The web app sets it when the request fails; the server never sends it. |
| `server_error` | Anything unexpected |
| `protocol_refused` | Client build older than the server accepts (socket handshake) |

### `EmptyPoolReason`

`competition` · `club` · `era` · `combination`. The first one names the single filter whose removal would refill the pool; `combination` means no single filter is to blame.

---

## 3. Shared types

### Enums

| Type | Values |
| --- | --- |
| `Side` | `home`, `away` |
| `CompetitionKind` | `league`, `ucl`, `uel`, `world_cup`, `euro` |
| `PositionGroup` | `GK`, `DF`, `MF`, `FW` |
| `Tier` | `free`, `pro` |
| `SoloSessionStatus` | `active`, `over` |
| `SoloEndReason` | `lives_out`, `quit`, `perfect_clear` |
| `DuelOutcome` | `win`, `loss`, `draw`, `forfeit_win` |
| `DuelActor` | `you`, `opponent`. **Relative to the receiving client.** |
| `ConnectionStatus` | `connected`, `reconnecting`, `forfeited` |
| `FilterSubmissionStatus` | `pending`, `submitted` |

### `imageUrl` rule (used by `crestUrl` and `imageUrl`)

| Accepted | Rejected |
| --- | --- |
| Absolute `http://` or `https://` URL | `//host/…` (protocol-relative) |
| Root-relative path with **one** leading slash and no spaces, `?` or `#` (e.g. `/mock/crests/x.svg`) | `data:`, `javascript:`, `ftp:` and any other scheme |
| | Bare relative paths (`mock/x.svg`, `./x.svg`), `/` alone, empty string |

**The backend should always send absolute CDN URLs.** The root-relative branch exists only for the web mock's own assets, and the web will tighten it at W27.

### `ClubRef`

| Field | Type | Rule |
| --- | --- | --- |
| `id` | id | |
| `name` | string | Non-empty |
| `shortName` | string | Non-empty. Shown on phones; 3-letter codes work best (`YLD`). |
| `crestUrl` | imageUrl or `null` | |

### `CompetitionRef`

| Field | Type |
| --- | --- |
| `id` | id |
| `kind` | `CompetitionKind` |
| `name` | non-empty string |

### `MatchIdentity`

| Field | Type | Rule |
| --- | --- | --- |
| `id` | id | |
| `competition` | `CompetitionRef` | |
| `season` | string | `YYYY-YY` for leagues and club cups (`2004-05`), `YYYY` for tournaments (`2006`) |
| `date` | ISO date | |
| `stage` | string or `null` | e.g. `Final`, `Matchday 19` |
| `home` | `ClubRef` | |
| `away` | `ClubRef` | |
| `score` | `{ home, away }` | Integers ≥ 0 |
| `nickname` | string or `null` | e.g. `The Rain Final` |

### `MatchInPlay` (the match during a solo run or a duel)

Every `MatchIdentity` field, **plus**:

| Field | Type | Rule |
| --- | --- | --- |
| `side` | `Side` | The XI being named. The named club is `match[side]`. |
| `formation` | string | Digits joined by `-`, 3–5 lines, outfield total 10 (e.g. `4-4-2`, `4-1-2-1-2`) |

**The full match is shown during play**: both clubs, the score, the competition and the date. It **never** includes a player of either XI.

### `RevealedPlayer`

| Field | Type | Rule |
| --- | --- | --- |
| `id` | id | |
| `name` | string | Non-empty, display form (`Oğuzhan Şimşek`) |
| `slot` | integer 0–10 | 0 is the goalkeeper; then the lines from defence to attack, filling right to left |
| `position` | `PositionGroup` | Must match the slot in the formation |
| `imageUrl` | imageUrl or `null` | |

`DuelFoundPlayer` = `RevealedPlayer` + `foundBy: DuelActor`.

### `RoundTiming`

| Field | Type | Rule |
| --- | --- | --- |
| `startedAt` | epoch ms | Server clock |
| `endsAt` | epoch ms | Must be greater than `startedAt` (15 000 ms later at launch) |

The client draws its countdown from these. It **never decides** an expiry; at 0 it asks the server.

### `GuessResult` (discriminated by `outcome`)

| `outcome` | Other fields |
| --- | --- |
| `correct_new` | `player: RevealedPlayer` |
| `already_found` | `playerId: id` |
| `not_in_xi` | none. **Unrecognised input and real-but-wrong players look identical.** |

### `Filters`

| Field | Type | Rule |
| --- | --- | --- |
| `competitionIds` | id[] | Empty means all |
| `clubIds` | id[] | Empty means all |
| `era` | `{ from, to }` | Season-start years, integers 2000–2025, `from ≤ to` |

### `User` and `Session`

| `User` field | Type | Rule |
| --- | --- | --- |
| `id` | id | |
| `handle` | string | Non-empty |
| `isGuest` | boolean | |
| `tier` | `Tier` | **Resolved by the server.** The client never asserts it. |

`Session` = `{ user: User }`.

---

## 4. REST calls

Paths are suggestions. Every response body is the envelope from §2, wrapping the **Response** type.

| # | Web method | Method and path | Request | Response |
| --- | --- | --- | --- | --- |
| 1 | `auth.getSession` | `GET /auth/session` | — | `Session` or `null` |
| 2 | `auth.signIn` | `POST /auth/sign-in` | `SignInRequest` | `Session` |
| 3 | `auth.signUp` | `POST /auth/sign-up` | `SignUpRequest` | `Session` |
| 4 | `auth.continueAsGuest` | `POST /auth/guest` | — | `Session` (guest) |
| 5 | `auth.upgradeGuest` | `POST /auth/upgrade` | `UpgradeGuestRequest` | `Session` (same user id, `isGuest: false`) |
| 6 | `auth.signOut` | `POST /auth/sign-out` | — | none (`data` empty) |
| 7 | `catalog.getFilterOptions` | `GET /catalog/filter-options` | — | `FilterOptions` |
| 8 | `solo.findMatch` | `POST /solo/sessions` | `Filters` | `SoloMatchOffer` |
| 9 | `solo.chooseSide` | `POST /solo/sessions/:sessionId/side` | `{ side: Side }` | `SoloSession` |
| 10 | `solo.guess` | `POST /solo/sessions/:sessionId/guesses` | `SoloGuessRequest` | `SoloGuessResponse` |
| 11 | `solo.syncSession` | `GET /solo/sessions/:sessionId` | — | `SoloSession` |
| 12 | `solo.quit` | `POST /solo/sessions/:sessionId/quit` | — | `SoloSummary` |
| 13 | `solo.getSummary` | `GET /solo/sessions/:sessionId/summary` | — | `SoloSummary` |
| 14 | `profile.getProfile` | `GET /profile` | — | `Profile` |
| 15 | `profile.getHistory` | `GET /profile/history?cursor=&limit=` | `HistoryQuery` | `HistoryPage` |

Better Auth (B10) mounts its own routes. Calls 1–6 may map onto them rather than onto these paths; the web only needs the shapes.

### Request types

| Type | Fields |
| --- | --- |
| `SignInRequest` | `email` (valid email), `password` (8–128 chars) |
| `SignUpRequest` | `email`, `password` (8–128), `handle` (trimmed, 3–24 chars) |
| `UpgradeGuestRequest` | same as `SignUpRequest` |
| `SoloGuessRequest` | `sessionId` (id), `guess` (trimmed, 1–64 chars) |
| `HistoryQuery` | `cursor` (id or `null`), `limit` (integer 1–50; web default 20) |

The web only checks password **length**. The backend owns the password policy.

### Response types

**`FilterOptions`**

| Field | Type |
| --- | --- |
| `competitions` | `CompetitionRef[]` |
| `clubs` | `ClubRef[]` |
| `era` | `{ from, to }`, the covered season range |

**`SoloMatchOffer`.** The run is created and the player picks a side next.

| Field | Type |
| --- | --- |
| `sessionId` | id |
| `home` | `ClubRef` |
| `away` | `ClubRef` |

**`SoloSession`**

| Field | Type | Rule |
| --- | --- | --- |
| `sessionId` | id | |
| `status` | `SoloSessionStatus` | |
| `match` | `MatchInPlay` | |
| `lives` | 0–3 | |
| `found` | `RevealedPlayer[]` | ≤ 11 |
| `round` | `RoundTiming` or `null` | `null` once the run is over |

**`SoloGuessResponse`**

| Field | Type |
| --- | --- |
| `result` | `GuessResult` |
| `session` | `SoloSession` (state after the guess) |

**`SoloSummary`**

| Field | Type | Rule |
| --- | --- | --- |
| `match` | `MatchIdentity` | |
| `found` | `RevealedPlayer[]` | ≤ 11 |
| `missedCount` | integer 0–11 | |
| `missed` | `RevealedPlayer[]` or `null` | **Pro gets the list, free gets `null`.** The server decides. |
| `livesRemaining` | 0–3 | |
| `endReason` | `SoloEndReason` | |
| `accuracy` | 0–1 | Correct guesses ÷ all guesses |
| `bestStreak` | integer 0–11 | |
| `roundTimesMs` | integer ≥ 0, array | Time per round |

**`Profile`** = `{ user: User, stats: UserStats }`

| `UserStats` field | Type |
| --- | --- |
| `played`, `wins`, `losses`, `draws` | integer ≥ 0 |
| `accuracy` | 0–1 |
| `bestStreak`, `perfectClears` | integer ≥ 0 |
| `favouriteClub` | `ClubRef` or `null` |

**`HistoryPage`** = `{ entries: HistoryEntry[], nextCursor: id | null }`

`HistoryEntry` (discriminated by `mode`):

| Field | Type |
| --- | --- |
| `id` | id |
| `playedAt` | ISO datetime |
| `match` | `MatchIdentity` |
| `foundCount` | integer 0–11 |
| `livesRemaining` | 0–3 |
| `mode` | `solo` or `duel` |
| `outcome` | `SoloEndReason` when `mode: solo`; `DuelOutcome` when `mode: duel` |

### Errors the web handles, per call

| Call | Codes |
| --- | --- |
| `signIn` | `invalid_input` (bad form), `unauthorized` (wrong credentials) |
| `signUp` | `invalid_input` (bad form, or **handle taken**) |
| `upgradeGuest` | `invalid_input` (bad form, handle taken), `unauthorized` (no session), `forbidden` (already registered) |
| `findMatch` | `unauthorized`, `invalid_input`, `empty_pool` + `emptyBecause` |
| `chooseSide` | `not_found`, `forbidden` (side already chosen) |
| `guess` | `invalid_input`, `not_found`, `session_over` (run over, or round already ended), `rate_limited` + `retryAfterMs` |
| `syncSession`, `quit` | `not_found`, `invalid_input` (no side chosen yet) |
| `getSummary` | `not_found`, `invalid_input`, `forbidden` (run still in progress) |
| `getProfile`, `getHistory` | `unauthorized`; `getHistory` also `invalid_input` |
| Any | `server_error` |

### Solo behaviour the web relies on

- **Guess handling:**
  - A `correct_new` guess starts the next round immediately; the new `round` is in `session`.
  - `already_found` and `not_in_xi` leave the round running. There's no penalty and no new round.
- **Expiry:** when the countdown reaches 0, the web calls `syncSession`. The server applies any expiry: it takes a life and starts a new round, or ends the run.
- **Grace window:** a guess received after `endsAt` plus the grace window (400 ms) returns `session_over`.

---

## 5. Duel over Socket.IO

### Handshake (`connect`)

- The connection carries the user's auth (JWT from B12) and the client's `protocolVersion`.
- **Refused:** a build older than N-1 gets an ack with error `protocol_refused`, and the web shows its update screen.
- **Accepted:** an ack with `success: true`.

`PROTOCOL_VERSION` doesn't exist in the web yet (W30). Agree the starting number in B03.

### Client → server commands

Every command is acked with the §2 envelope, `data` empty. **Outcomes arrive as events, not in the ack.**

| Web method | Suggested event | Payload | Errors in the ack |
| --- | --- | --- | --- |
| `connect()` | handshake | auth + `protocolVersion` | `protocol_refused`, `unauthorized` |
| `enterQueue()` | `queue:enter` | — | `forbidden` (already in a duel) |
| `leaveQueue()` | `queue:leave` | — | `forbidden` (not queued) |
| `submitFilters(filters)` | `filters:submit` | `Filters` | `forbidden` (filters not open), `invalid_input`, `empty_pool` + `emptyBecause` (refused before the coin flip) |
| `guess(request)` | `duel:guess` | `{ sessionId, guess }` (guess trimmed, 1–64) | `invalid_input`, `session_over`, `forbidden` (not your turn), `rate_limited` + `retryAfterMs` |
| `forfeit()` | `duel:forfeit` | — | `forbidden` (no duel running) |
| `disconnect()` | socket close | — | — |

### Server → client events (`DuelEventMap`)

`you` and `opponent` are always **from the receiving client's view**: the same moment reaches the two players with the actors swapped.

| Event | Payload | When |
| --- | --- | --- |
| `queued` | `QueueState` | After `queue:enter` |
| `queueTimedOut` | `QueueTimeout` | No opponent in time. The web offers solo with the same filters. |
| `paired` | `PairedState` | Opponent found; filters open |
| `filtersUpdated` | `FilterSubmission` | Each time either player submits |
| `coinFlip` | `CoinFlipResult` | Both submitted. One set wins and is applied **whole**. |
| `matchReady` | `DuelSession` | Match resolved; the first round has started. **Authoritative.** |
| `roundStarted` | `DuelSession` | A new round starts; follows every `turnChanged` that doesn't end the duel. **Authoritative.** |
| `guessResolved` | `GuessResult` | Your own guess resolved (sent to the guesser only) |
| `playerRevealed` | `DuelFoundPlayer` | Either player names a new starter (sent to both) |
| `lifeLost` | `DuelLifeLost` | A clock expires |
| `turnChanged` | `DuelSession` | Handover, after a correct guess or an expiry |
| `opponentConnection` | `ConnectionState` | The opponent drops, comes back, or the window closes |
| `finished` | `DuelResult` | Win, loss, draw (all 11 named) or forfeit |
| `disconnected` | `ConnectionState` | **Your own** connection state (reconnecting, then back, or forfeited) |
| `error` | `ApiError` | Errors outside a command ack, e.g. `empty_pool` after the flip, or `rate_limited` |

### Duel payload types

| Type | Fields |
| --- | --- |
| `QueueState` | `phase: 'queued'`, `since: epoch ms` |
| `QueueTimeout` | `phase: 'queued'`, `waitedMs: integer ≥ 0` |
| `PairedState` | `phase: 'paired'`, `opponent: DuelPlayer` |
| `FilterSubmission` | `yours: FilterSubmissionStatus`, `theirs: FilterSubmissionStatus` |
| `CoinFlipResult` | `winner: DuelActor`, `filters: Filters` (the set applied) |
| `DuelPlayer` | `id`, `handle` (non-empty), `lives` (0–3) |
| `DuelLifeLost` | `who: DuelActor`, `lives: 0–3` (after the loss) |
| `ConnectionState` | `status: ConnectionStatus`, `reconnectDeadline: epoch ms or null` |

**`DuelSession`**

| Field | Type | Rule |
| --- | --- | --- |
| `sessionId` | id | |
| `match` | `MatchInPlay` | Both players name the same XI |
| `you` | `DuelPlayer` | |
| `opponent` | `DuelPlayer` | |
| `turn` | `DuelActor` | |
| `round` | `RoundTiming` | |
| `found` | `DuelFoundPlayer[]` | ≤ 11, the shared found-pool |

**`DuelResult`**

| Field | Type |
| --- | --- |
| `outcome` | `DuelOutcome` (receiver's view) |
| `match` | `MatchIdentity` |
| `found` | `DuelFoundPlayer[]` |
| `you` | `DuelPlayer` |
| `opponent` | `DuelPlayer` |
| `isForfeit` | boolean |

`duelPhase` values used across the payloads: `queued`, `paired`, `filters`, `match_ready`, `playing`, `finished`.

### Duel behaviour the web relies on

- **Correct, new name:** `guessResolved` to the guesser, `playerRevealed` to both, `turnChanged`, then `roundStarted`. If that name was the 11th, `finished` replaces the last two.
- **Already found, or not in the XI:** `guessResolved` only. The turn and the clock carry on.
- **Expiry:** `lifeLost`, `turnChanged`, then `roundStarted`. If the player who lost the life is at 0, `finished` replaces the last two.
- **Draw:** all 11 named ends in an instant `finished` with `outcome: draw`.
- **Reconnect window:** 20 s. The dropped player's clock **keeps running**. `opponentConnection` and `disconnected` carry `reconnectDeadline` while it's open.

---

## 6. Constants the two sides must agree on

| Constant | Value |
| --- | --- |
| Round length | 15 000 ms |
| Grace window | 400 ms, measured on server receipt |
| Lives | 3 |
| Squad size | 11 |
| Guess length | 1–64 characters, trimmed |
| Handle length | 3–24 characters, trimmed |
| Password length | 8–128 characters |
| History page | default 20, maximum 50 |
| Season range | 2000–2025 (season-start years) |
| Reconnect window | 20 s |
