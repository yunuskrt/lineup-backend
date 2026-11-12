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
| `reason` | `ForbiddenReason`, optional | Only ever with `forbidden` (R9), and optional there: most refusals have none. |

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

### `ForbiddenReason` (R9)

`pro_required` · `daily_cap`. `pro_required`: the feature needs Pro (R10, R12–R14). `daily_cap`: the free solo runs for the UTC day are used up (R11). The same field on REST and in socket acks. The message stays safe to show (for example "That needs Pro.").

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

### `imageUrl` rule (used by `crestUrl`, `imageUrl` and `logoUrl`)

| Accepted | Rejected |
| --- | --- |
| Absolute `http://` or `https://` URL | `//host/…` (protocol-relative) |
| Root-relative path with **one** leading slash and no spaces, `?` or `#` (e.g. `/mock/crests/x.svg`) | `data:`, `javascript:`, `ftp:` and any other scheme |
| | Bare relative paths (`mock/x.svg`, `./x.svg`), `/` alone, empty string |

**The backend sends absolute `https` URLs, or `null`** (R2): `<ASSET_BASE_URL>/<key>`, straight from the public bucket, never proxied. With `ASSET_BASE_URL` unset, every `crestUrl` and `imageUrl` is `null`. The root-relative branch exists only for the web mock's own assets, and the web will tighten it at W27.

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
| `logoUrl` | imageUrl or `null` (R3b). Always present |

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
| `directoryKey` | string, 22 base64url characters | Equals this player's `DirectoryPlayer.key` (R5), so a client can mark named players in the directory. Opaque: it says nothing about the player |

`DuelFoundPlayer` = `RevealedPlayer` + `foundBy: DuelActor`.

`NamedPlayer` = `RevealedPlayer` + the two fields below (R4b). `DuelNamedPlayer` = `DuelFoundPlayer` + the same two. **End-of-game only**: in `SoloSummary.found` and `DuelResult.found`, never in a live payload.

| Field | Type | Rule |
| --- | --- | --- |
| `order` | integer 1–11 | When this player was named in the session; 1 is the first. Unique, no gaps. The list is sorted by it |
| `elapsedMs` | integer 0–15 000 | Server receipt of the correct guess minus the start of its round, capped at the round length (a guess in the grace window reads 15 000). In a duel, the finder's own turn |

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
| `tier` | `Tier` | **Resolved by the server** (R9), never asserted by the client. The effective tier: the user's stored tier while `PRO_ENABLED` is on, `pro` for everyone while it's off. Read from the user row on every request, so a change applies without signing in again. |

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
| 16 | `catalog.getPlayerDirectory` | `GET /catalog/players` | — | `PlayerDirectory` (R5), or `304` with no body |
| 17 | `catalog.getOverview` | `GET /catalog/overview` | — | `CatalogOverview` (R7). Public: no session needed |
| 18 | `config.getConfig` | `GET /config` | — | `AppConfig` (R9). Public: no session needed |

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
| `competitions` | `CompetitionOption[]`, by name |
| `clubs` | `ClubRef[]`, by name: every pool club |
| `era` | `{ from, to }`, the covered season range |

**`CompetitionOption`** (R3a). The pool's view of one competition, so a client can narrow the club and era pickers to it.

| Field | Type | Rule |
| --- | --- | --- |
| …every `CompetitionRef` field | | Unchanged |
| `clubIds` | id[] | The pool clubs with at least one pool match in this competition. Every id is also in `clubs`, in the same order |
| `seasonStarts` | integer[] | Season start years of its pool matches. Ascending, no repeats, never empty, each inside `era` |

The `Filters` request is unchanged: `competitionIds` is still an array, and any number of ids is accepted.

**`PlayerDirectory`** (R5) = `{ players: DirectoryPlayer[] }`. **Every** player with at least one alias, sorted by `key`. Never scoped to a match, a filter, the pool or a session, so the 11 answers sit among the rest unmarked (HC 2). For guess suggestions only: the client still sends the typed or picked text as a guess, and the server decides.

**`DirectoryPlayer`**

| Field | Type | Rule |
| --- | --- | --- |
| `key` | string, 22 base64url characters | Opaque and stable. **Not** `players.id`: those are uuid(7), and their creation order groups teammates. A revealed player's `directoryKey` equals it |
| `name` | string | Non-empty, display form, diacritics kept |
| `imageUrl` | imageUrl or `null` | As `RevealedPlayer.imageUrl` |
| `terms` | string[] | The player's distinct normalised aliases, sorted, at least one. For searching; never shown |

**Caching `GET /catalog/players`.** Any session may call it, guests included; with no session it's `401 unauthorized`. Rate-limited with the `catalog` limit (60 a minute).

| Header | Value |
| --- | --- |
| `ETag` | A strong tag. It changes only when a player or alias the directory reads is added, edited or deleted, or when the server's asset base or key changes |
| `Cache-Control` | `private, no-cache`: the browser keeps the copy and asks before reusing it |
| `If-None-Match` (request) | Equal to the current `ETag` (or `*`) → `304 Not Modified`, no body |
| `Content-Encoding` | `br` when accepted, else `gzip`, else none. `Vary: Accept-Encoding` |

CORS allows `If-None-Match` and exposes `ETag`, so a client can revalidate through the browser cache or by hand.

**`CatalogOverview`** (R7). What the playable pool holds, for a home or landing screen. **Public** (no session), rate-limited with the `catalog` limit (60 a minute). Every figure is over the matches the selector can serve, the same pool `FilterOptions` reads; the showcase match is never one of them. Dataset figures only: no community activity, no memorability score (HC 20). The server keeps the built overview for **5 minutes**, so new data shows within that.

| Field | Type | Rule |
| --- | --- | --- |
| `counts.matches` | integer ≥ 0 | Pool matches |
| `counts.players` | integer ≥ 0 | Distinct starters of those matches, both sides |
| `counts.clubs` | integer ≥ 0 | Distinct sides that are clubs |
| `counts.nationalTeams` | integer ≥ 0 | Distinct sides that are national teams |
| `counts.seasons` | integer ≥ 0 | Distinct season start years |
| `era` | `{ from, to }` | As `FilterOptions.era` |
| `highlights.finals` | integer ≥ 0 | Matches with `stage` exactly `Final` |
| `highlights.shootouts` | integer ≥ 0 | Matches decided on penalties |
| `highlights.extraTime` | integer ≥ 0 | Matches that went to extra time |
| `highlights.goals` | integer ≥ 0 | Both sides' goals, summed |
| `competitions` | `CompetitionRef[]` | The pool's competitions, by name, as `FilterOptions.competitions` |
| `topClubs` | `ClubRef[]`, at most 12 | Clubs only (no national teams), most pool matches first, then by name |
| `showcase` | `Showcase` or `null` | `null` when its data doesn't check out; every other field still returns |

**`Showcase`.** One real XI shown whole, for a scripted demo. It is a backend constant (a match slug, a side, the reveal order and a wrong guess, all by slug), checked against the data on every read. **Its match is never served as a game** (solo, duel or room), so sending this XI breaks nothing (HC 2).

| Field | Type | Rule |
| --- | --- | --- |
| `match` | `MatchInPlay` | The match, with `side` the XI shown and its `formation` |
| `players` | `RevealedPlayer[]`, exactly 11 | That side's XI, by slot, each slot once, with `directoryKey` |
| `demo` | `ShowcaseDemo` | |

**`ShowcaseDemo`**

| Field | Type | Rule |
| --- | --- | --- |
| `reveals` | integer[] | 1–11 distinct slots, in the order the demo reveals them |
| `miss` | `ShowcasePlayer` or `null` | The demo's wrong guess: a starter of the **other** side, so it really isn't in this XI |

**`ShowcasePlayer`** = `{ name, imageUrl, directoryKey }`, as on `RevealedPlayer`.

`showcase` is `null` if its match isn't loaded, the side has no formation or not 11 starters, a slot breaks the formation, a starter has no alias, a reveal isn't in that XI, or the miss isn't in the other one. The response is otherwise unchanged.

**`AppConfig`** (R9). Whether the Free/Pro split exists. **Public** (no session), rate-limited with the `catalog` limit (60 a minute), `Cache-Control: public, max-age=300`: the value only changes on a restart.

| Field | Type | Rule |
| --- | --- | --- |
| `proEnabled` | boolean | The backend's `PRO_ENABLED`. `false`: every user and guest is Pro, and no Pro wording or lock should show. `true`: `User.tier` is each user's own. For display only: it grants nothing |

**`SoloMatchOffer`.** The run is created and the player picks a side next.

| Field | Type | Rule |
| --- | --- | --- |
| `sessionId` | id | |
| `match` | `MatchIdentity` | The offered match (R4a): the same identity `SoloSession.match` carries once a side is picked, without `side` and `formation`. Never a player |
| `home` | `ClubRef` | **Deprecated** (R4a): equals `match.home`. Kept for clients from before R4 |
| `away` | `ClubRef` | **Deprecated** (R4a): equals `match.away`. Kept for clients from before R4 |

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
| `found` | `NamedPlayer[]` | ≤ 11, in the order named (R4b) |
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
| `isPrivate` | boolean, **duel entries only** (R6): `true` when the duel was played in a private room. Solo entries have no such field |

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
| `getPlayerDirectory` | `unauthorized`, `rate_limited` + `retryAfterMs` |
| `getOverview` | `rate_limited` + `retryAfterMs` |
| `getConfig` | `rate_limited` + `retryAfterMs` |
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
| `createRoom(filters)` | `room:create` | `Filters` | `forbidden` + `reason: 'pro_required'` (R10: a Free host while `PRO_ENABLED` is on; checked first), `forbidden` (queued, already hosting a room, or in a duel), `invalid_input`, `empty_pool` + `emptyBecause` (checked now; nothing is stored) |
| `joinRoom(code)` | `room:join` | `RoomJoinRequest` | `not_found` (no open room has that code: wrong, expired, left or already joined), `forbidden` (your own room, or you're queued, hosting or in a duel), `invalid_input` (not 6 characters of the code alphabet) |
| `leaveRoom()` | `room:leave` | — | `forbidden` (not hosting an open room) |
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
| `roomCreated` | `RoomState` | To the creator, after an accepted `room:create` (R6) |
| `roomExpired` | `RoomExpiry` | To the creator, 10 minutes after `roomCreated` if no one joined. The room is gone and its code is free |
| `error` | `ApiError` | Errors outside a command ack, e.g. `empty_pool` after the flip, or `rate_limited` |

### Duel payload types

| Type | Fields |
| --- | --- |
| `QueueState` | `phase: 'queued'`, `since: epoch ms` |
| `QueueTimeout` | `phase: 'queued'`, `waitedMs: integer ≥ 0` |
| `PairedState` | `phase: 'paired'`, `opponent: DuelPlayer` |
| `FilterSubmission` | `yours: FilterSubmissionStatus`, `theirs: FilterSubmissionStatus` |
| `CoinFlipResult` | `winner: DuelActor`, `filters: Filters` (the set applied), `source: 'coin' \| 'room'` (R6). `coin` for a queue pairing; `room` for a private room, where `winner` is the creator |
| `RoomState` | `code` (6 characters, uppercase), `filters: Filters` (as applied), `expiresAt: epoch ms` |
| `RoomExpiry` | `code` |
| `RoomJoinRequest` | `code`: 6 characters of `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, any case (uppercased before the check) |
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
| `found` | `DuelNamedPlayer[]`, in the order named (R4b) |
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

### Private rooms (R6)

- **A second way to pair.** The creator sends `room:create` with their filters and gets `roomCreated` with a code. The friend sends `room:join` with it. Anyone may join, guests included.
- **Hosting needs Pro** (R10) while `PRO_ENABLED` is on: a Free `room:create` gets `forbidden`, `reason: 'pro_required'`, "Hosting a room needs Pro. Anyone can join one.", and nothing is stored. The tier is read from the database at the command, so a change applies without reconnecting. With the switch off, everyone may host. Joining is never gated, and an open room stays open if its host's tier drops while it waits.
- **On join:** `paired` to both at once, then `coinFlip` with `source: 'room'` (`winner` is the creator, `filters` are the room's), then `matchReady` 2 s later. There is no filter window and no `filtersUpdated`. Everything from `matchReady` on is the duel above.
- **The joiner names first:** the flip's loser always starts, and in a room the creator is the winner.
- **The code:** 6 characters, no `0 O 1 I L`, unique among open rooms. A room is open until someone joins, the creator leaves, the creator's socket closes or is taken over (at once, with no reconnect window), or 10 minutes pass (`roomExpired`). `expiresAt` is for showing the time left; the server decides the expiry.
- **One room at a time:** a creator can't create again, join another room or enter the queue until the room closes. A queued player can't create or join.
- **After a join** the code is gone: a second `room:join` with it is `not_found`, the same as a wrong code.
- **Empty pool after the join** (an ingest run in between): the `error` event with `empty_pool` to both, and the room closes.
- **Rate limits:** `room:join` and `room:create`, 10 a minute per user each; `room:leave` shares the default.

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
