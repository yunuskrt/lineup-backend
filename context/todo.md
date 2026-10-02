# Lineup — Backend Build Phases

Phase IDs use the `B` prefix. Line order is build order; the current phase is the first `- [ ]` line.

Workflow per phase: `/todo current` → `/todo spec` → `/feature load <spec>` → `/feature start` → `/feature review` → `/feature test` → `/todo done` → `/feature complete`.

This todo file is for developer-side use.

## Backend (NestJS)

- [x] **Phase B01 — Repo & Scaffold**: NestJS, strict TS, eslint and prettier, `bodyParser: false` at bootstrap.
- [x] **Phase B02 — Config Module**: Zod-validated environment schema parsed at boot, failing fast on gaps.
- [x] **Phase B03 — Contract & OpenAPI**: Zod schema conventions, `PROTOCOL_VERSION`, Swagger doc at a fixed path.
- [x] **Phase B04 — Prisma & Neon**: Prisma 7 with the Neon adapter, `PrismaService`, migration workflow.
- [x] **Phase B05 — Club & Competition Schema**: competitions, seasons, clubs and club_aliases with migration.
- [x] **Phase B06 — Player & Alias Schema**: players and player_aliases, plus `pg_trgm` and `unaccent`.
- [ ] **Phase B07 — Match & Lineup Schema**: matches, match_teams, match_events and lineups with migration.
- [ ] **Phase B08 — Scoring & Session Schema**: memorability_scores, game_sessions, game_rounds, guesses, stats.
- [ ] **Phase B09 — Seed Script**: Idempotent seed loading the web mock fixtures into a Neon dev branch.
- [ ] **Phase B10 — Auth Module**: Better Auth in NestJS with email/password, Google and Apple providers.
- [ ] **Phase B11 — Guest & Linking**: Anonymous plugin, trusted-provider linking, email verification.
- [ ] **Phase B12 — Guards & JWT**: Route guards, session resolution and JWT issuance for the gateway.
- [ ] **Phase B13 — CORS & Cookies**: Credentialed CORS, parent-domain cookie scope, bearer for mobile.
- [ ] **Phase B14 — Users Module**: Profile, stats and guest-upgrade endpoints over the users schema.
- [ ] **Phase B15 — Ingestion Harness**: Rerunnable runner with provider client, disk cache and rate limits.
- [ ] **Phase B16 — Match Metadata Ingest**: Fixtures, scores, dates and competitions across 2000–2026.
- [ ] **Phase B17 — Entity Resolution**: Normalize and dedupe clubs and players, then build base alias sets.
- [ ] **Phase B18 — Cultural Footprint Signal**: Wikipedia and Wikidata article, pageview and nickname signals.
- [ ] **Phase B19 — Memorability Engine**: Signal scoring with era-bucket normalization, pure and unit tested.
- [ ] **Phase B20 — Lineup Ingest**: Pull full starting XIs for the shortlisted matches only.
- [ ] **Phase B21 — Guessability Gate**: Hard filter requiring all 11 starters to resolve with alias sets.
- [ ] **Phase B22 — Pool QA Report**: Script reporting pool size and coverage gaps per league, era and club.
- [ ] **Phase B23 — Storage Module**: Bucket client behind an interface; Postgres holds keys, never binaries.
- [ ] **Phase B24 — Image Ingest**: Player and crest images with licence checks and attribution recorded.
- [ ] **Phase B25 — Match Selector**: Stratified sampling across league, era and club for filtered retrieval.
- [ ] **Phase B25b — Catalog Endpoint**: Filter options (competitions, clubs, era range) from the pool.
- [ ] **Phase B26 — Indexes & Performance**: Index the alias, match and lineup hot paths; measure trigram cost.
- [ ] **Phase B27 — Name Normalization**: Unicode pipeline in `game/` with Turkish and diacritic handling.
- [ ] **Phase B28 — Alias Matching**: Exact and fuzzy resolution with a tuned threshold, fully unit tested.
- [ ] **Phase B29 — Squad Collision Rules**: Resolve ambiguous bare surnames within the current XI only.
- [ ] **Phase B30 — Rules Engine**: Lives, turn order and round resolution state machine, pure and tested.
- [ ] **Phase B31 — Server Timer Model**: Server-owned 15s rounds with timestamps and a fixed grace window.
- [ ] **Phase B32 — Team Side Selection**: Server-weighted home/away pick by guessability and star power.
- [ ] **Phase B33 — Solo Endpoints**: Start, guess and end-run REST endpoints validating server-side only.
- [ ] **Phase B34 — Solo Persistence**: Persist sessions, rounds, guesses and the derived per-user stats.
- [ ] **Phase B35 — REST Rate Limiting**: Throttler on guess and auth routes with an explained lockout.
- [ ] **Phase B36 — Socket Gateway**: Socket.IO gateway with a JWT handshake and protocol version gate.
- [ ] **Phase B37 — FIFO Matchmaking**: In-memory queue pairing the first two waiting clients into a room.
- [ ] **Phase B38 — Duel Orchestration**: Filter coin flip, squad resolution and the alternating round loop.
- [ ] **Phase B39 — Duel Events**: Typed emit and ack payloads for every state the duel screen can be in.
- [ ] **Phase B40 — Disconnect Handling**: 20s reconnect window, running clock, forfeit and result routing.
- [ ] **Phase B41 — Duel Persistence**: Write duel sessions, rounds, guesses and results from the gateway.
- [ ] **Phase B42 — Socket Rate Limiting**: Per-connection guess throttling outside the HTTP pipeline.
- [ ] **Phase B43 — Duel Integration Harness**: Two simulated clients covering win, loss, draw and forfeit.
- [ ] **Phase B44 — Observability**: Sentry, structured logs, health checks and draw-rate instrumentation.
- [ ] **Phase B45 — Deployment**: Railway or Fly with `migrate deploy` before start, plus a staging env.
- [ ] **Phase B46 — Redis Swap**: Move queue, sessions and rate limits to Upstash behind the same interfaces.

---

## Prerequisite

- [ ] **Phase P01 — Data Provider Trial**: Validate lineup coverage on 20 matches from 2001, 2006, 2011, 2019.

Not blocking the web build, but it must resolve before **B20 (Lineup Ingest)** — its answer decides whether the 2000–2026 season range in the spec is honest, or whether the 2000s ship later as a curated Classics pack.

---

## Deferred

Not phases yet — promoted into a part above only when scoped.

- Monetization: Pro subscription, remove-ads IAP, rewarded video, interstitials, RevenueCat entitlements
- Compliance for ads: consent platform, App Tracking Transparency, minors and COPPA decision
- Leaderboards, friend invites and private lobbies, ranked ELO, daily challenge, achievements
- Pro solo features: exact match selection, archive browse, filter presets, practice mode, full post-game review
- Social sharing, push notifications, spectating, new league and season packs
