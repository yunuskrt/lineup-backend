## Lineup Project Specifications

⚽ **Know the XI. Beat the Clock.**

---

## 📌 Core Idea

A cross-platform football trivia game built on **real historical match squads**. Players are shown a real match — one team from it — and take turns naming players from its **starting XI** — exactly eleven answers — against a 15-second clock.

Coverage: **2000–01 through 2025–26**, restricted to a curated set of elite clubs and major international tournaments, and further narrowed to **memorable matches only** via a scoring algorithm.

Playable **solo** or as a **live 1v1 duel**. Duels are cross-platform by design — a browser player, an iOS player and an Android player all sit in the same matchmaking pool.

Feel: pub quiz recall + speed chess clock + football nostalgia.

> "I named nine of Milan's XI from Istanbul 2005 before my opponent ran out of lives."

The 15-second clock, the shared found-players pool, and the fact that a correct answer _ends your turn_ are what make this a duel rather than a quiz — you are not just recalling, you are spending the easy names before your opponent does and leaving them the hard ones.

---

## 🎮 Game Flow

```text
Home → Sign in / Continue as Guest → Mode Select

  SOLO:
  Filters → Match Retrieved → Pick Home or Away → Guessing Loop (15s rounds)
  → Lives = 0 or Quit → Summary

  DUEL:
  Enter Lobby → FIFO Matchmaking → Filter Coin-Flip → Match Retrieved
  → Team Selected → Alternating Rounds (15s each, shared found-pool, 3 lives each)
  → Opponent at 0 lives or leaves → Win
  → All 11 starters named → Draw
```

---

## ✨ Core Features

### A) Match Pool & Memorability Engine

The single biggest quality lever in the product. A random Premier League fixture from October 2013 is not a game — a scoreless mid-table draw kills the session. Every candidate match gets a stored `memorability_score` (0–100) computed once at ingestion, never at runtime.

**Scoring signals**

| Signal                 | Examples                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Stage weight**       | Final > semi > quarter > knockout > group > league fixture                                                                                                         |
| **Rivalry**            | El Clásico, Manchester derby, Derby della Madonnina, Kıtalar Arası Derbi, Le Classique, O Clássico                                                                 |
| **Drama**              | Goal count, comeback from HT deficit, extra time, penalties, 90'+ winner, red cards, hat-tricks                                                                    |
| **Stakes**             | Title-deciders, relegation-irrelevant filtered out, aggregate-overturning legs, qualification-on-the-line                                                          |
| **Star power**         | Aggregate fame of both XIs (Ballon d'Or shortlists, international caps, era-normalized profile)                                                                    |
| **Cultural footprint** | Does the match have its own Wikipedia article? Pageviews? A nickname ("Miracle of Istanbul", "Remontada")? — the strongest single proxy for "people remember this" |

**Rules that matter**

- **Era normalization.** Scores are normalized _within_ era buckets (2000–07 / 2008–15 / 2016–26). Raw signals are biased toward recent, better-documented matches; without this, the 2000s effectively disappear from the pool.
- **Stratified sampling on retrieval.** The selector samples across league × era × club so a filter like "Premier League" never degenerates into ten consecutive Manchester City matches from 2023.
- **Tournament matches get a lower threshold** than league matches — a World Cup group game is inherently more memorable than a league fixture of the same drama score, so a higher proportion of the tournament universe is admitted.
- **Guessability guard.** A high-drama match is unusable if its XI can't be resolved. A match only enters the pool if **all 11 starters** map to complete player records with alias sets. This is a separate gate from memorability, and it is a hard filter, not a weight.

### B) Filters & Match Selection

- Filters: competition (league / UCL / UEL / World Cup / Euro), club, era range.
- **No player-facing difficulty selector.** `memorability_score` is an internal quality gate — it decides what enters the pool, never what the player chooses. Exposing it would turn a curation signal into a promise the data can't keep.
- **Solo:** filters are the player's own.
- **Duel:** both players submit preferences after matching; the server picks **one of the two filter sets at random** and applies it whole, then tells both players whose was used. Chosen over an intersection because it can never collapse to an empty pool, needs no fallback threshold to tune, and is fair by construction — across a session each player gets their own filters half the time.
- Team selection (home or away) is server-side and weighted by guessability and star power, not a coin flip — the goal is a squad that is _hard but fair_.
- **Solo lets the player pick the side; duel does not** — in a duel the same squad must be shared, so the server decides.

### C) Guess Matching

Underestimating this will sink the game. "Ibrahimovic", "Zlatan", "İbrahimović" and "ibrahimovic" are one answer.

- Normalization pipeline: Unicode NFD → strip diacritics (with explicit Turkish handling for `İ/ı/ş/ğ/ç`, plus `ñ`, `č`, `ø`) → lowercase → collapse whitespace and punctuation.
- **Alias table per player:** full name, common name, surname-only, mononym, nickname (Ronaldinho, Chicharito, Xavi, Hulk, Pelé), transliteration variants, and known misspellings collected from live play.
- Fuzzy fallback via Postgres `pg_trgm` + `unaccent` with a tuned similarity threshold — generous enough for typos, tight enough that "Ronaldo" never resolves to "Ronaldinho".
- **Surname collisions are explicit, not fuzzy.** Two Silvas, two Ronaldos, two Nevilles in one era: if a bare surname is ambiguous _within the current squad_, resolve it; if ambiguous against a player not in the squad, still accept it. Ambiguity only matters inside the XI.
- Matching runs **server-side only**, against a precomputed alias set for the current match. The client never receives the squad.

### D) Multiplayer Duel

- Two users match from a lobby. 3 lives each.
- **Matchmaking is FIFO.** The first two waiting clients are paired — no skill rating, no ELO, no bracketing at MVP. A pairing algorithm needs a player base before it's worth building.
- Alternating rounds, **15 seconds** per round, timer reset on each turn handover.
- **Shared found-pool.** Both players guess from the same XI and see the same list of already-revealed players.
- Round resolution:
  - **Correct + not yet found** → round ends, no life lost, turn passes to the opponent.
  - **Correct but already found** → timer does _not_ reset, round continues, "already found" feedback.
  - **Not in this XI** → no penalty, no life lost, no turn change, timer keeps running. Unrecognised input and real-but-wrong players are treated identically; the burnt seconds are the entire cost.
  - **Timer expires with no new player named** → that player loses a life, turn passes.
- Game ends when a player hits 0 lives or leaves — the other player wins — **or when all 11 starters have been named, which is an instant draw.** Lives remaining are not a tiebreak: the shared pool is exhausted and there is nothing left to play for.
- **Server-authoritative timer.** The 15 seconds is owned by the server; clients render a countdown derived from a server timestamp in the round-start event. A small grace window (~400ms, measured on server receipt) absorbs network latency so a 3G player isn't systematically robbed.
- Disconnect handling: a short reconnect window (~20s) before a leave is treated as a forfeit; the timer keeps running during it.

### E) Singleplayer

- Same core loop, no opponent, no turn handover.
- Player picks home or away.
- Timer expiry costs a life; a correct new answer starts the next round immediately. A name that isn't in the XI costs nothing but time.
- Naming all 11 ends the run as a **perfect clear** — the solo counterpart of the duel draw — and goes straight to the summary with lives remaining recorded.
- Quit at any time.
- End-of-run summary: match identity revealed in full, players named vs. players missed, time per round, accuracy, streak.

### F) Accounts, Guests & Progression

- **Guest play is first-class** — no signup wall in front of the first game, including duels.
- A guest is a real, persisted anonymous identity bound to a device, upgradeable to a full account **without losing history**. This is one migration path, not two account systems.
- Auth methods: **email + password** and **continue as guest**. No social sign-in (Google, Apple) — no third-party account, and App Store Guideline 4.8 does not apply to an app that only uses its own accounts.
- Stored per user: match history, win / loss / draw, accuracy, favourite-club stats, best streaks, perfect clears.

### G) Cross-Platform Parity & Anti-Cheat

This is the constraint that shapes the entire architecture: browser, iOS and Android players share one pool, so **no game logic may live on any client**.

- Clients render and transmit input. The server owns the squad, the timer, the lives, the turn order and every answer validation.
- The squad is never sent to the client — not even partially, not even encrypted. Only revealed players are pushed, as they're revealed.
- **Protocol versioning.** Web deploys instantly; mobile users sit on old binaries for weeks. Every socket handshake carries a `protocolVersion`; the server supports N and N-1 and refuses older builds with an upgrade prompt rather than desyncing.
- **The rules engine exists in exactly one place: the backend's `game` module.** Neither client carries a copy, so there is nothing to drift. Three repos make this easier to hold than a monorepo did — the clients have no import path to game logic even if someone reaches for one.
- **Both clients speak the same two protocols**: REST for solo, profile and auth; Socket.IO for duels. A browser player and an Expo player are indistinguishable to the backend, which is what puts them in one matchmaking pool.
- Server-side rate limiting on guesses to blunt dictionary-spam bots — on the HTTP path and the socket path alike, since the duel guess never touches HTTP.
- **The web client is cross-origin with the API**, which the earlier single-app design hid. Cookies must survive that: host the API and the web app on one parent domain (`api.lineup.gg` / `app.lineup.gg`) and scope the session cookie to it, rather than relying on `SameSite=None` third-party cookies that Safari and Chrome increasingly refuse. Mobile sidesteps this entirely with a bearer token.
- **No code is shared between the three repos.** Each owns its validations, components, types and tokens outright and builds with the other two deleted. What they agree on is the backend's API contract — defined by the backend, documented via OpenAPI, transcribed by hand into each client. Keeping those transcriptions in step is manual work, and `PROTOCOL_VERSION` is what turns a missed one into a refused connection instead of a broken duel.

---

## 🗄️ Data Architecture

**PostgreSQL (Neon) is the system of record.** Redis holds only ephemeral realtime state. External providers are used for **one-time, offline ingestion** — the app never calls a third-party football API during gameplay.

```text
Providers (API + open data + curation)
   → Normalize & entity-resolve (clubs, players, aliases)
   → Score memorability
   → Guessability gate + manual QA
   → Postgres (Neon)  +  Bucket (images)
   → NestJS backend — REST + Socket.IO + auth + rules engine
   → Browser (Next.js) / iOS / Android (Expo)
```

**Persistent (Postgres):** competitions, seasons, clubs, club_aliases, matches, match_teams, match_events, players, player_aliases, lineups, memorability_scores, users, guest_identities, game_sessions, game_rounds, guesses, stats.

**Object storage (bucket):** player images and club crests. Postgres holds the object key; the binary never touches the database or the API response. Clients fetch images straight from the CDN URL — the backend does not proxy them.

> ⚠️ **Images carry a licensing risk that the rest of the data does not.** Press photographs of players are copyrighted and club crests are trademarks; neither is covered by the football data licences. At MVP, prefer generated silhouettes or initials, or Wikimedia Commons images with their required attribution. Do not bulk-upload provider images without checking the terms.

Images are never on the critical path: a player image appears only **after** a name is revealed, or on profile and archive surfaces. Nothing about a round depends on one loading.

**Ephemeral (Redis, or in-memory at MVP):** matchmaking queue, live session state, round timers, socket-room mapping, rate-limit counters.

### Ingestion strategy

The naive approach — ingest 26 seasons × 24 clubs × ~50 matches — is roughly 30,000 matches with lineups, most of which will never be served. **Invert it: score first, ingest lineups second.**

1. Ingest cheap match _metadata_ (fixtures, scores, competitions, dates) across the full range — widely available and free.
2. Score memorability on metadata + cultural signals alone.
3. Acquire **full lineups only for the shortlist** — realistically 1,500–3,000 matches.
   This turns the expensive part of the dataset into something a paid API tier or partial manual curation can actually cover.

### Sources

| Source                                      | Role                                                                                                                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API-Football** (api-sports.io)            | **Primary** for lineups; strong coverage roughly 2010→present across all target leagues and UEFA competitions                                                                            |
| **Sportmonks**                              | Candidate for the pre-2010 lineup gap; deeper historical archive, paid                                                                                                                   |
| **StatsBomb Open Data**                     | Free, event-level, limited competitions — excellent for validation and World Cup / Euro spot-filling                                                                                     |
| **Wikipedia / Wikidata**                    | Cultural-footprint signal (article existence, pageviews, named matches) **and** starting XIs for famous fixtures, which are near-universally documented. CC BY-SA — attribution required |
| **openfootball / football.db**              | Free fixture and result skeleton for the full 2000→2026 range                                                                                                                            |
| **Transfermarkt, FBref, worldfootball.net** | Manual spot-checking only — never scraped programmatically (ToS)                                                                                                                         |
| **LLMs**                                    | **Not a data source.** Never the origin of a lineup, score, date, or player name                                                                                                         |

> ⚠️ **Known risk:** lineup coverage for **2000–2010** is the hardest part of this project and should be validated with a real provider trial before committing to the full season range. If it proves unworkable, the honest fallback is to launch at 2008–09 onward and backfill the 2000s as a curated "Classics" pack.

---

## 🧱 Tech Stack

| Category               | Choice                                                                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo                   | **Three separate repositories** — `lineup-backend`, `lineup-web`, `lineup-mobile`. Each is app-scoped and deploys independently                                                                                                                                              |
| Framework (backend)    | **NestJS** — modules, DI and a first-class Socket.IO gateway in one long-running process. Owns the API, auth, the rules engine, the database and ingestion                                                                                                                   |
| Framework (web)        | **Next.js (App Router) + React** — a pure client of the backend. No database access, no game logic. RSC still suits the marketing surfaces                                                                                                                                   |
| Framework (mobile)     | **Expo (React Native) + Expo Router** — file-based routing that mirrors Next, one TypeScript codebase for iOS and Android, EAS Build/Submit for store delivery. Not a webview wrapper                                                                                        |
| Language               | **TypeScript**, strict, in all three repos                                                                                                                                                                                                                                   |
| Realtime               | **Socket.IO** — your instinct is right. Rooms, ack callbacks, buffered reconnection and HTTP long-poll fallback come free; `socket.io-client` works unmodified in React Native. Raw `ws` means rebuilding all of it                                                          |
| Realtime host          | **The NestJS backend itself**, via `@nestjs/websockets` + `@nestjs/platform-socket.io`. One long-running process serves REST and sockets. Vercel cannot hold persistent WebSocket connections, which is why the backend is not on Vercel                                     |
| Object storage         | **A bucket with a free tier** (Cloudflare R2, Supabase Storage or Backblaze B2 — decided later) for player images and club crests. Postgres stores the object key, never the binary. Uploaded during ingestion, served to clients directly from CDN                          |
| Database               | **PostgreSQL (Neon)** — relational by nature; `pg_trgm` + `unaccent` do fuzzy name matching in-engine; branching makes the ingestion work safe to iterate                                                                                                                    |
| ORM                    | **Prisma** — declarative schema, real migrations, and `prisma studio` for eyeballing 3,000 ingested lineups by hand, which you will do a lot of                                                                                                                              |
| Cache / ephemeral      | **Redis (Upstash)** — matchmaking queue, live sessions, `@socket.io/redis-adapter` for multi-instance scaling, rate limiting. **Deferred:** MVP runs single-instance in-memory; add Redis at the first horizontal scale or when reconnect-resume matters                     |
| Auth                   | **Better Auth**, mounted in NestJS via `@thallesp/nestjs-better-auth` — TypeScript-native, runs on your own Postgres, first-class Expo support, an anonymous/guest plugin with account linking, and a JWT plugin the socket gateway validates. Requires `bodyParser: false`  |
| State (client)         | **Zustand** for the live session store + **TanStack Query** for server data. Unlike a turn-free single-player app, realtime events fan out to many components here — a store is justified. Both work identically in React Native                                             |
| Validation / contracts | **Zod**, defined separately in each repo. No shared package — the backend owns the contract and documents it with **OpenAPI** (`@nestjs/swagger`); each client holds its own transcription of the payload shapes                                                             |
| Data ingestion         | One-time, rerunnable, **idempotent** TypeScript scripts in the backend repo under `scripts/ingest`. Never a runtime dependency                                                                                                                                               |
| Styling/CSS (web)      | **Tailwind + shadcn/ui** — unstyled Radix primitives, lives in-repo, no fight with a themed library for a custom look                                                                                                                                                        |
| Styling (mobile)       | **NativeWind** + a design-token file local to the repo, transcribed from `theme.md`. Port tokens and logic across platforms by hand, **never components** — attempting one component tree for web and native is a well-known way to get an app that feels wrong on all three |
| UI components          | shadcn/ui for scaffolding (dialogs, tabs, sliders, toasts); bespoke for the signature pieces — the pitch/formation view, the countdown ring, the lives display, the reveal cards                                                                                             |
| Motion/transitions     | **Framer Motion** (web) / **Reanimated** (mobile) — same design intent, native-appropriate runtimes. The countdown and reveal animations carry most of the game's tension                                                                                                    |
| Testing                | **Jest or Vitest** on the backend `game` module (timer, lives, turn passing, alias matching — these must be tested), **Playwright** for web flows, plus a two-simulated-client socket harness for duel integration                                                           |
| Observability          | Sentry on all three repos; structured logging + health checks on the backend                                                                                                                                                                                                 |
| Deployment             | **Railway, Fly.io or Render** (NestJS — needs a persistent process and sticky sessions if scaled) · **Vercel** (Next.js) · **Neon** (DB) · **Upstash** (Redis) · **EAS** (App Store + Play Store)                                                                            |

---

## 🧭 Route Architecture

```text
/                     Home — what the game is, Play CTA, sign in / continue as guest
/sign-in              Sign in, sign up, continue as guest
/play                 Mode select + filter preferences
/play/solo            Filters → match → guessing loop → summary
/play/duel            Lobby → matchmaking → live duel → result
/profile              History, stats, guest → account upgrade
/leaderboard          Post-MVP
```

`/play/duel` is **one route for the entire realtime session**. A route transition mid-duel risks tearing down the socket connection and the React tree holding session state — matchmaking, gameplay and result all render as phases inside it.

Expo Router mirrors these paths on mobile so deep links and analytics events are shared across platforms.

---

## 🎯 MVP Scope

- **Data:** metadata for the full 2000–2026 range across target clubs and tournaments; memorability scores; full lineups + alias sets for the shortlisted pool
- **Game:** guest + account auth, filters, solo mode, live 1v1 duel with FIFO matchmaking, 3 lives, 15s server-authoritative rounds, starting XI only, shared found-pool, fuzzy answer matching, win / loss / draw results, end-of-game summary
- **Platforms:** **web first**, fully playable and deployed. Mobile follows on the same backend and the same protocol
- **UI:** Home, Mode/Filters, Solo game, Duel lobby, Duel game, Result, Profile
- **Postponed:** leaderboards, friend invites / private lobbies, ranked ELO, daily challenge, tournaments-within-the-app, achievements, social sharing, push notifications, spectating

---

## 🔒 Hard Constraints

1. **The server is authoritative.** Timer, lives, turn order and validation live on the server. Clients render and transmit input, nothing more.
2. **The squad is never sent to the client.** Only revealed players are pushed, at reveal time.
3. **No football API is called during gameplay.** All match and lineup data is pre-ingested into Postgres.
4. **No LLM is a source of truth** for lineups, scores, dates or player identities.
5. **No scraping of Transfermarkt/FBref/Wikipedia at runtime.** Ingestion is offline, controlled and rerunnable.
6. Postgres is the system of record; Redis holds **only** ephemeral state that is safe to lose.
7. **The rules engine lives only in the backend** (`src/game/`), and no client ever contains game logic. The clients render state the backend sends and transmit input. There is no second implementation to keep in sync.
8. **Every socket handshake is version-checked.** Server supports protocol N and N-1; older clients are refused with an upgrade prompt, never allowed to desync.
9. Exactly **3 lives** per player per game; a life is lost **only** on timer expiry, never on a wrong answer.
10. A correct, not-yet-found answer **ends the turn**. An already-found answer and a name that isn't in the XI both leave the timer running and the turn unchanged.
11. Rounds are exactly **15 seconds**, server-timed, with a fixed latency grace window applied equally to all platforms.
12. **Guest play requires no signup**, and upgrading a guest to an account never destroys history.
13. A match enters the pool only if it passes **both** the memorability threshold and the guessability gate.
14. Avoid unnecessary infrastructure — no Kubernetes, no microservices, no message broker. **One backend**, two clients, a database and a bucket. The backend stays a single NestJS service; REST and sockets are modules within it, never separate deployables.
15. **Nothing purchasable may affect a duel.** No bought lives, hints, time extensions, easier opponents or restricted match pools. Two players in a duel face identical rules regardless of tier.
16. **Pro status is resolved server-side and is platform-agnostic** — bought on any platform, honoured on all of them. The client never asserts its own tier.
17. **The answerable squad is the starting XI — exactly 11 players.** Substitutes are never answers, never revealed, never scored.
18. **A duel in which all 11 starters are named ends in a draw.** No sudden death, no replacement match, no tiebreak on lives.
19. **Duel filter conflicts are settled by a coin flip** — one player's set is applied whole, and both players are told whose. Never merged, never intersected.
20. **`memorability_score` is never exposed to players.** No difficulty selector, no score display, no sorting by it.

---

## ✅ Resolved Decisions

Previously open; now settled, and the spec above reflects them.

| #   | Question                                | Decision                                                                                                                              |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Starting XI only, or XI + substitutes?  | **Starting XI only.** Matches the product name, keeps difficulty consistent, and sidesteps thin substitute data pre-2010              |
| 2   | A guess that isn't in the squad at all? | **No penalty, no turn change, timer keeps running.** A life is lost only to the clock, never to a wrong name                          |
| 3   | What if all 11 are named?               | **Instant draw** (solo: perfect clear). A clean terminal state — no carried-over lives, no second match loaded mid-session            |
| 4   | Duel filter conflict?                   | **Random pick — one player's set applied whole.** No empty-pool edge case, no threshold to tune, fair across a session                |
| 5   | Difficulty banding?                     | **Internal only.** `memorability_score` gates the pool and is never shown. No skill-based matchmaking either — pairing is FIFO at MVP |

**Worth instrumenting:** if draws turn out to be common, that is a signal the memorability threshold is admitting squads that are too famous — a data-tuning problem, not a rules problem. Track draw rate per era and per competition from day one.

---

## 📌 Status

- **Specification stage.** No code written.
- **Immediate next step is not scaffolding — it's data validation.** Trial an API-Football / Sportmonks tier and confirm real lineup coverage for a 20-match sample spread across 2001, 2006, 2011 and 2019. The answer determines whether the season range in this document is honest.
- Build order is **web → backend → mobile**, in three repositories.
- **The web app is built first and in full against a mock API adapter**, before the backend exists. Layout, the countdown ring and the reveal are the parts most likely to be wrong, and they are cheapest to fix while nothing is wired to them.
- This only works because the web client is written against an **API client interface** from its first commit, with a mock implementation behind it. Going live is swapping the implementation, not rewriting screens. A web app that reaches into mock fixtures directly cannot be wired up later without being taken apart.
- Two browser players duelling each other is the milestone that proves the backend; mobile then joins the same pool by speaking the same two protocols, with no backend change.

---

## 💎 Free vs Pro

Pro sells **depth and convenience in solo play**. It never sells advantage in duels — see Hard Constraint 15.

| Feature                                              | Free               | Pro                                                 |
| ---------------------------------------------------- | ------------------ | --------------------------------------------------- |
| 1v1 duels                                            | Unlimited          | Unlimited                                           |
| Solo runs                                            | Daily cap          | Unlimited                                           |
| **Exact match selection** (pick the precise fixture) | ✗                  | ✓                                                   |
| Archive browse & search                              | ✗                  | ✓                                                   |
| Saved filter presets                                 | ✗                  | ✓                                                   |
| Practice mode (no lives, no timer)                   | ✗                  | ✓                                                   |
| Post-game review                                     | Missed count only  | Full XI + every player missed                       |
| Stats                                                | Win/loss, accuracy | Per-club and per-era breakdown, most-missed players |
| Private lobbies                                      | Join only          | Host + join                                         |
| New league / season packs                            | On release         | Early access                                        |
| Cosmetics (badges, club flair, frames)               | Defaults           | Full set                                            |
| Ads                                                  | Yes                | None                                                |

**Free duels are never capped.** Free users are the matchmaking pool — throttling them starves paying players of opponents. Cap solo instead.

---

⚽ **Lineup — Know the XI. Beat the Clock.**
