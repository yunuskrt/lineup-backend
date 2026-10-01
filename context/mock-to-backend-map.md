# Mock → Backend Replacement Map

Every behaviour the web app's mock fakes today, and the backend phase that makes it real. Phase IDs are from `context/todo.md`.

## How the mock is wired

- The screens call two interfaces: `ApiClient` (REST: auth, catalog, solo, profile) in `src/lib/api/client.ts`, and `DuelClient` (Socket.IO events) in `src/lib/api/duel-client.ts`.
- `src/lib/api/register.ts` plugs in the mock implementations from `src/lib/api/mock/`. `NEXT_PUBLIC_API_MODE=real` throws until W27.
- One in-memory store backs both mocks, so a reload resets everything.
- **The contract the backend must match** is the web's Zod schemas in `src/lib/api/schemas/` plus `DuelEventMap`. Transcribe them by hand; never import them.

## Replacement map

### Data

| Mock today | Real backend | Web wiring |
| --- | --- | --- |
| 10 fictional fixtures, 167 players with aliases (`mock/data/*.ts`) | B05–B08 schema; **B09 seeds these same fixtures** into a Neon dev branch | W27 |
| Fixtures validated by Zod at load (`mock/types.ts`) | Prisma schema and constraints (B04–B08) | — |
| Placeholder SVG crests and headshots in `public/mock/`, root-relative URLs | B23 bucket, B24 image ingest: absolute CDN URLs | W27: tighten `imageUrlSchema` |
| No real data at all | B15–B22 ingestion, memorability, guessability gate, pool QA | — |

### Auth and session

| Mock today | Real backend | Web wiring |
| --- | --- | --- |
| `getSession`, `signIn`, `signUp`, `signOut` | B10 Better Auth | W28 |
| `continueAsGuest`, `upgradeGuest` (history kept) | B11 anonymous plugin and linking | W28 |
| Fixed rejections: password `wrong-password`, handle `taken` | Real auth errors | W28 |
| No cookies; the session lives in memory | B12 guards and JWT, B13 credentialed CORS and parent-domain cookie | W27, W28 |
| Every user is `tier: 'free'` | Server-resolved entitlements (monetization is Deferred) | — |

### Catalog

| Mock today | Real backend | Web wiring |
| --- | --- | --- |
| `getFilterOptions`, derived from the fixtures (`pool.filterOptionsFrom`) | B25b catalog endpoint, from the gated pool | W27 |

### Solo

| Mock today | Real backend | Web wiring |
| --- | --- | --- |
| `findMatch`: filter, random pick, empty-pool reason (`pool.ts`) | B25 stratified selector on the scored, gated pool (B19, B21) | W29 |
| `chooseSide`, then a `MatchInPlay` with the full match | B33 (sends `matchInPlaySchema`) | W29 |
| `guess`, `syncSession`, `quit`, `getSummary` | B33 endpoints | W29 |
| Summary `missed` list only for Pro | B33, with tier from entitlements | W29 |

### Rules engine (`mock/engine.ts`, `clock.ts`, `matcher.ts`, `normalize.ts`)

| Mock today | Real backend |
| --- | --- |
| Unicode and Turkish name normalisation | B27 |
| Fuzzy match: Damerau-Levenshtein, threshold 0.82 | **B28 uses `pg_trgm` and `unaccent`.** It's a different mechanism, so the threshold must be retuned |
| Surname collisions inside the XI | B29 |
| 3 lives, turn order, round outcomes, draw on 11, perfect clear | B30 |
| 15s rounds, 400ms grace window | B31 |
| Home/away weighted pick (duel) | B32 |

### Duel

| Mock today | Real backend | Web wiring |
| --- | --- | --- |
| `connect`/`disconnect`, all on a local emitter | B36 Socket.IO gateway, JWT handshake | W30 |
| `protocolRefused` scenario | B36 version gate (N and N-1). **`PROTOCOL_VERSION` doesn't exist in web yet** | W30 |
| Queue pairs after 2s; `queueTimeout` scenario | B37 FIFO matchmaking, including a queue timeout | W31 |
| Scripted opponent filters, coin flip, 2s flip reveal | B38 | W31 |
| **Scripted opponent: 6s think time, 65% hit rate** | A real second player | W31 |
| Round, turn, reveal, life-lost and finish events | B38 orchestration, B39 typed events | W31 |
| Disconnect and reconnect scenarios, 20s window, forfeit | B40 | W31 |
| Finished duel written to the shared store | B41 duel persistence | W31, W32 |

### Profile and persistence

| Mock today | Real backend | Web wiring |
| --- | --- | --- |
| `getProfile`: record, accuracy, streaks, favourite club, computed in memory (`store.ts`) | B14 users module, B34 solo stats | W32 |
| `getHistory`: cursor paging over an in-memory list | B14, B34, B41 | W32 |
| A reload wipes everything | Postgres (B04, B08); live state in memory, then Redis (B46) | — |

### Limits

| Mock today | Real backend | Web wiring |
| --- | --- | --- |
| 12 guesses per 3s per session (2 per 3s in the `rateLimited` scenario) | B35 REST throttler, B42 socket throttler | W29, W31 |

## Backend phases with no mock counterpart

These have nothing to replace on the web side, but they are still in the build order:

- **Setup:** B01 scaffold, B02 config, B03 contract and OpenAPI.
- **Performance:** B26 indexes.
- **Testing:** B43 two-client duel harness.
- **Ops:** B44 observability, B45 deployment.
- **Prerequisite:** P01 data provider trial. It must finish before B20.

Web phases W33 (observability) and W34–W35 (E2E, deployment) follow once B45 is done.

## What stays in the web app

- **Dev-only tooling:** `?state=`, `?scenario=`, `/dev/*` and `src/lib/dev/samples.ts`. None of it calls the backend.
- **The mock adapter itself:** decide at W27 whether to keep it for tests and offline dev behind `NEXT_PUBLIC_API_MODE=mock`.

## Watch-outs

1. **Catalog endpoint.** `getFilterOptions` is owned by B25b, added after B25 in the backend `todo.md`.
2. **Matcher.** Copy the mock's matcher test cases into B28, since `pg_trgm` scores differently. One example: "Ronaldo" must never resolve to "Ronaldinho".
3. **In-play match.** B33 and B38 must send the full match, crests and scores included, during play. That's a recent web change.
4. **Image URLs.** Real image URLs are absolute. The root-relative branch of `imageUrlSchema` exists only for the mock.
5. **Queue timeout.** B37 must emit `queueTimedOut`. Today only a scenario reaches it.
6. **Entitlements.** Pro-only behaviour (the missed list) needs a server-resolved tier, even though monetization is Deferred.
