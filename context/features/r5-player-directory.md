# R5 — Player Directory

## Status

Complete

## Goals

- **Directory key**, `src/matches/directory-key.ts` (D1):
  - a pure `directoryKeyOf(secretKey, playerId)`: HMAC-SHA256 of `players.id`, the first 16 bytes as base64url, 22 characters
  - the HMAC key is derived once at boot from `BETTER_AUTH_SECRET` with HKDF-SHA256 and a fixed label (`lineup:player-directory`). No new env variable. Never logged
  - a small injectable in `MatchesModule` holds the derived key, so the squad loader and the catalog share it
- **Contract**, `src/contract/player.ts` and `src/contract/catalog.ts`:
  - `directoryKeySchema`: a string of exactly 22 base64url characters
  - `revealedPlayerSchema` gains `directoryKey`. It reaches every payload built on it: `SoloSession.found`, `correct_new.player`, `missed`, `DuelFoundPlayer`, `NamedPlayer`, `DuelNamedPlayer`
  - `directoryPlayerSchema` (`DirectoryPlayer`): `key` (`directoryKeySchema`), `name` (non-empty), `imageUrl` (`imageUrlSchema.nullable()`), `terms` (non-empty strings, at least one)
  - `playerDirectorySchema` (`PlayerDirectory`): `{ players: DirectoryPlayer[] }`
  - `src/contract/registry.spec.ts`: the id list gains both
- **Squad loader**, `toLoadedSquad`: each `RevealedPlayer` carries `directoryKey: directoryKeyOf(key, player.id)`. `players.id` stays as `RevealedPlayer.id`, so nothing else changes
- **Pure mapping**, `src/catalog/player-directory.ts`, `toPlayerDirectory(rows, assetBase, key)`:
  - one entry for each player with at least one alias. A player with none is left out
  - `terms`: the player's distinct `player_aliases.normalized` values, sorted ascending
  - `imageUrl`: `assetUrl(assetBase, imageKey)`, as for reveals
  - sorted by `key`. The order says nothing about clubs, matches or creation time
  - only the four fields. Never `id`, `slug`, `transfermarktId`, `imageKey`, the raw `alias`, lineups, matches or positions
- **Version**, in `CatalogService` (D2):
  - one `$queryRaw` per request: for `players`, the row count and the sum of `hashtextextended(id ‖ name ‖ image_key, 0)`; for `player_aliases`, the same over `player_id ‖ normalized`. Columns are joined with a separator, and a null `image_key` is an empty string
  - it covers exactly the columns the directory reads, so it changes whenever the output would. Writes that skip `updated_at` count too
  - `ETag`: a strong tag, a SHA-256 over a format constant, the version, `ASSET_BASE_URL`, and a fingerprint of the derived key. A deploy that changes the base URL or the secret changes the tag
- **In memory** (D3, D4):
  - the built directory is the envelope JSON (`{ success: true, data }`), checked once against `playerDirectorySchema` when built, plus its gzip and Brotli buffers
  - compressed with async `node:zlib`, which runs on the thread pool, so the event loop doesn't block. Gzip at level 9; the Brotli quality is picked at test and recorded
  - rebuilt only when the version changes. One build at a time: concurrent requests wait on the same build
  - the version and the rows are read in one repeatable-read transaction, so a directory is never labelled with a newer version than its rows
  - built lazily on the first request after boot. A failed build answers `server_error`, keeps no half-built state, and the next request retries
- **Endpoint**, `GET /catalog/players` in `CatalogController`:
  - not `@Public()`. The global guard answers `unauthorized` (401) with no session; a guest session gets the directory
  - `@RateLimit('catalog')` (60 a minute)
  - `If-None-Match` matching the current tag (weak comparison, a list, or `*`) → `304`, no body, with `ETag`, `Cache-Control` and `Vary`
  - otherwise `200` with the Brotli buffer if `Accept-Encoding` allows `br`, else gzip, else the raw JSON. Headers: `ETag`, `Cache-Control: private, no-cache`, `Vary: Accept-Encoding`, `Content-Encoding` when compressed, `Content-Type: application/json; charset=utf-8` and `Content-Length`
  - the route writes those buffers itself and opts out of `ContractResponseInterceptor` through a named marker (D4). OpenAPI still documents the envelope around `PlayerDirectory`, the headers and the `304`
- **CORS**, `src/config/cors.ts`: `If-None-Match` added to `allowedHeaders` and `ETag` to `exposedHeaders`, so the web can revalidate either through the browser cache or by hand
- **Unit tests:**
  - `directory-key.spec.ts`: 22 base64url characters, the same for the same id and key, different for another id or another key
  - `player-directory.spec.ts`: distinct and sorted `terms`; `imageUrl: null` without an image or without `ASSET_BASE_URL`; a player without aliases is left out; the order is by `key`; no field outside the four
  - the ETag builder: the same inputs give the same tag; a change in any part changes it
  - `If-None-Match` matching: exact, weak `W/`, a list, `*`, a stale tag, no header
  - encoding choice: `br`, `gzip`, both (`br` wins), `q=0`, none
  - `CatalogService`: one build for concurrent requests; no rebuild while the version holds; a rebuild when it changes; a failed build leaves nothing cached
  - `squad-loader` and the contract fixtures: `RevealedPlayer.directoryKey` present and equal to the directory's `key` for the same player
- **E2E** (`test/catalog/`, on `dev`):
  - no session → 401; a guest → 200 with an `ETag`, `Cache-Control: private, no-cache` and a body that passes `playerDirectorySchema`
  - the same `If-None-Match` → 304 with no body
  - `Accept-Encoding: br` and `gzip` → those encodings, and the body unzips to the same JSON
  - version: the tag changes after a temporary player and alias are added, after the alias's `normalized` is edited, and after the player is deleted; it stays the same after a solo run, a guest sign-up, and an edit to a column the directory doesn't read (`slug`). The test removes its rows
  - a revealed player's `directoryKey` from a solo guess equals that player's `key` in the directory
- **Docs:**
  - `context/api-contract.md`: row 16 in §4, the `PlayerDirectory` and `DirectoryPlayer` tables, the caching and `304` behaviour, and `RevealedPlayer.directoryKey`
  - the OpenAPI document gains `PlayerDirectory` and `DirectoryPlayer`, and `RevealedPlayer` shows `directoryKey`. The socket catalogue (`x-socket`) follows by itself

## Your part

1. **At `/feature load`:** confirm the proposed decisions D4 and D5, or change them (done 2026-11-07)
2. **At `/feature test`:**
   - point `.env` at `dev` for the unit and e2e runs
   - then at `ingest` for the size and timing measurements. Only `GET` calls run there, and never an e2e suite
   - you edit `.env` yourself
3. **At `/feature complete`:** approve the commit, the merge into `main` and the push

## Decisions

Decided 2026-11-07, before load:

- **D1. Each directory entry has an opaque `key` instead of `players.id`, and `RevealedPlayer` gains a matching `directoryKey`**
  - `players.id` is uuid(7), so it sorts by creation time. Players created together, a seeded match's two XIs or a scraper load of a few new matches, get neighbouring ids
  - measured on `dev`: 6.33 of a starter's 10 nearest ids are XI teammates (0.60 if ids were random), and 97.3% of starters have at least one such teammate
  - measured on `ingest`: 0.08 (random 0.026), and 7.1% of starters. The first load created every player in one batch; later small loads would group as `dev` does
  - with every id in the directory, a client could take one revealed id and read likely teammates off its neighbours, whatever order the server sends. That breaks HC 2's "not even partially"
  - rejected: the real id as R5 asked, with the leak recorded as a risk; no id at all, which would leave the web matching by name
- **D2. The version is a content hash** over exactly the columns the directory reads, not counts plus `max(updated_at)`
  - it costs the same full scan, and it catches writes that skip `updated_at` (SQL in the Neon console, a skewed clock)
  - it changes only when the output would, and every instance computes the same tag (B46)
  - rejected: counts plus `max(updated_at)`, as R5 suggested
- **D3. The response is precompressed once per version, on this route only**, with `node:zlib`
  - no new dependency, and Socket.IO and Better Auth stay untouched by construction
  - a `200` costs no compression CPU
  - rejected: the global `compression` middleware

Approved at `/feature load` (2026-11-07), both as proposed:

- **D4. The route writes its own bytes and opts out of `ContractResponseInterceptor`; the contract check runs once per build, not per request.** The interceptor would re-parse about 3,800 players and serialise ~600 KB on every `200`, and it has no `304` path. It still fails closed: a directory that fails `playerDirectorySchema` is never cached or sent
  - alternative: keep the interceptor and let it parse every `200`
- **D5. The existing `catalog` limit (60 a minute) covers the route, and the directory is built on the first request, not at boot.** A player makes one call per match, and a `304` costs one aggregate query. Building lazily keeps boot time unchanged
  - alternative: a new, tighter limit, or a build at boot

## Notes

- **Why:** while a player types a guess, the web shows matching players above the input, each with a photo and a name. Typing must never send a request, so the web downloads the directory once per match, before the clock starts, and filters it in the browser. Asked in `lineup-web/context/docs/backend-requests.md` § R5 (2026-11-06); web specs `context/features/guess-suggestions-a-mock.md` and `guess-suggestions-b-wiring.md`
- **Numbering:** web request R5. Not a `todo.md` phase. Don't edit `todo.md`
- **HC 2 holds because the directory is the whole table:**
  - the 11 answers sit among about 3,800 players, and nothing marks them
  - it is never narrowed to a match, its clubs, a season, a competition, the player's filters, the pool or a session
  - neither the order (by `key`) nor the ids (D1) carry a signal
  - image keys are `players/<slug>/…`, so `imageUrl` follows the name, not a squad
- **No game logic moves.** The web only suggests. It still sends the typed or picked text as a guess, and the server's matching decides, as today
- **Version and raw aliases:** the scraper's alias update rewrites the raw `alias` only (`normalized` is the key). With D2, that leaves the tag unchanged, which is right, because `terms` doesn't change. R5's test list asks that an edited alias change the version; the e2e covers that by editing `normalized`
- **Size on `ingest` today:** 3,787 players with aliases, 9,517 aliases. R5 expects about 600 KB raw and about 150 KB gzipped
- **Additive contract change:**
  - a new route, plus a new field on `RevealedPlayer`. Nothing removed or renamed
  - a web build from before R5 drops `directoryKey`
  - `RevealedPlayer` is in socket payloads, but it only gains a field, so no `PROTOCOL_VERSION` bump
  - no migration
- **The web's R5 transcription changes with D1:** `DirectoryPlayer.key` in place of `id`, and the web marks named players by `RevealedPlayer.directoryKey`, not `RevealedPlayer.id`
- Constraints:
  - comments single-line, at most 50 characters
  - `@/` imports
  - types from `z.infer`
  - the squad is never logged; neither are the derived key or a directory body
  - never touch `production`
  - **never run the e2e suites while `.env` points at `ingest`**
- Verification:
  - `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`
  - `npm run test:e2e` on `dev`
  - `/docs/openapi.json`: `PlayerDirectory` and `DirectoryPlayer` listed; `RevealedPlayer` has `directoryKey`; the route documents `200` and `304`
  - measured on `ingest` (GET only), for the web's Built note: player count; raw, gzip and Brotli sizes; the time of the first build, a warm `200` and a `304`; the version query's time
- Afterwards, in the web: mark R5 done in `backend-requests.md`, with the measurements and the D1 change; Guess Suggestions B transcribes `PlayerDirectory`, `DirectoryPlayer` and `RevealedPlayer.directoryKey`

**Deviations recorded during implementation**

- The version, build and cache live in a new `PlayerDirectoryService` (`src/catalog/player-directory.service.ts`), not in `CatalogService`, so the filter-options code and its tests stay untouched
- The players half of the version counts only players with at least one alias: exactly the rows the directory reads. A player with no alias (the history e2e suite commits one) leaves the tag unchanged
- Each row is hashed from its record text, `(id, name, image_key)::text` and `(player_id, normalized)::text`, not from columns joined by a separator. Record text quotes its fields, so two rows can't run together, and a null `image_key` differs from an empty one
- D4's marker is a `DirectResponse(schema, { headers })` decorator in `src/common/contract-response.ts`. It documents the envelope and the `304`, and the interceptor passes such a route through. Added: `contract-response.spec.ts`, the interceptor's first unit spec (checked, direct, and unmarked routes)
- `SquadLoaderService` takes `PlayerKeysService` as a third constructor argument, and `toLoadedSquad` takes a `keyOf` function
- Added: `src/contract/catalog.spec.ts` (directory schema bounds) and `src/catalog/directory-response.spec.ts` (headers, encodings, `304`)
- The CORS spec's "exposes no response headers" case became "exposes only the directory ETag"
- Added at `/feature review` (2026-11-08): `@DocumentsSession()` on `GET /catalog/players`, so OpenAPI shows cookie and bearer auth and the `401`, as on the other session routes
- Added at `/feature review` (2026-11-08): one log line per build, `Directory built: N players, raw/gzip/br bytes, T ms`, with counts and sizes only. It gives `BuiltDirectory.playerCount` a production reader; `BROTLI_QUALITY` is no longer exported
- Accepted edge, noted at review: a request that arrives during a build gets that build's result, which can be one version behind if the data changed again mid-build. The body and its ETag always match, and the next request sees the new version and rebuilds
- `test/http/cors.e2e-spec.ts` updated to the new header lists: preflight allows `Content-Type,Authorization,If-None-Match`, and a credentialed read exposes `ETag`. Its three cases asserted the old CORS policy, which R5 changes on purpose

**Test results (2026-11-08)**

- `npm test` 1230 passed (+62); lint, build and `npx tsc --noEmit` clean
- Coverage of the new code: 97% of lines, every R5 function. Uncovered: two defensive branches (an empty version row, equal keys) and the interceptor's off-contract path from before R5
- `npm run test:e2e` on `dev` (`ASSET_BASE_URL` unset): 457 passed (450 + 7 in `test/catalog/player-directory.e2e-spec.ts`), after the CORS suite's update
- `/docs/openapi.json`: `PlayerDirectory` and `DirectoryPlayer` listed, with exactly the four fields; `RevealedPlayer.directoryKey` required; `GET /catalog/players` documents `200` (envelope around `PlayerDirectory`, `ETag` and `Cache-Control` headers), `304` and `401`, with session and bearer security; `x-socket` follows
- Live on `dev` with curl, as a guest: `200` with an `ETag` and `Content-Encoding: br` (or `gzip`); `304` with a 0-byte body to that `ETag`; `401` with no session; 167 players, 18,291 bytes raw, 6,706 gzip, 6,162 Brotli; every entry exactly `imageUrl, key, name, terms`; no uuid in the body. The check left one guest user on `dev`
- Measured on `ingest` (2026-11-08), in process with the built `PlayerDirectoryService` and SELECTs only (no HTTP, no session, so no guest row is written there). `ASSET_BASE_URL` set:
  - 3,787 players; raw 883,841 bytes, gzip 228,960 (0.26), Brotli 193,083 (0.22). Larger than R5's estimate (~600 KB raw, ~150 KB gzip): `imageUrl` is 49% of the raw body (3,620 players have a photo, about 119 bytes a URL), `terms` 18% (9,517 terms)
  - first build 2.4 s (log line: 2,265 ms), of which Brotli is about 1.2 s; a warm `current()`, the server side of every `200` and `304`, 65 ms median, all of it the round trip to Neon (`SELECT 1` 56 ms); the version query itself 10.0 ms of server execution
  - Brotli quality, same body: 5 → 215,747 B in 15 ms; 9 → 211,528 B in 35 ms; 10 → 197,459 B in 394 ms; 11 → 193,083 B in 1,188 ms. **Kept at 11**: it runs once per data change, off the event loop, and it is the smallest download for every player after that. Gzip stays at level 9 (16 ms)
  - over HTTP on `dev`, a warm `200` and a `304` each took about 0.17 s from this machine, the same round trip plus the session lookup

## History
