# Current Feature

## Status

Not Started

## Goals

## Notes

## History

<!-- Keep this updated. Earliest to latest -->

- B01 Repo & Scaffold: bodyParser off, port 8080, @/ alias, oxlint no-any
- B02 Config Module: Zod env schema, fail-fast boot, ENV token, .env load
- B03a Contract Schemas: 53 Zod schemas, id registry, PROTOCOL_VERSION 1
- B03b OpenAPI & Envelope: /docs, envelope filter, fail-closed responses
- B04 Prisma & Neon: Prisma 7.10 + adapter-pg, startup probe, db:* scripts
- B05 Club & Competition Schema: 4 tables, first migration, 7 CHECKs
- B06 Player & Alias Schema: raw+normalized aliases, pg_trgm, unaccent
- B07 Match & Lineup Schema: matches, sides, XIs, events, 8 CHECKs
- B08 Scoring & Session Schema: 6 tables, 2 migrations, 17 CHECKs
- B09 Seed Script: web mock fixtures, idempotent diff-sync, db:seed
- B10a Better Auth Core: auth tables, uuid(7) users, handle rule, user FKs
- B10b Auth Endpoints: /auth session, sign-up/in/out, cookies, safe errors
- B11a Guest & Upgrade: anonymous plugin, in-place upgrade, 30-day sessions
- B11b Email Verification: Resend mailer, soft verify, emailVerified in User
- B12a Session Guard: global deny-by-default, @Public, @CurrentUser
- B12b Gateway JWT: GET /auth/token, 5-min sub-only JWT, auth_jwks table
- B13a CORS & Origin Check: own CORS, origin-checked writes, COOKIE_DOMAIN
- B13b Bearer for Mobile: signed bearer tokens, set-auth-token header
- B14a Profile & Stats: GET /profile, users module, zero stats when no row
- B14b Profile History: GET /profile/history, keyset cursor, MatchIdentity
- B25 Match Selector: sqrt-stratified pool, dev unscored flag, empty blame
- B25b Catalog Endpoint: public filter options from the pool, name-sorted
- B27 Name Normalization: NFKD ASCII normalizeName, seed uses it, CHECK
- B28 Alias Matching: exact + Damerau-Levenshtein 0.82, seeded-XI tuning
- B29 Squad Collision Rules: hybrid surname rule, classifyGuess verdicts
- B30 Rules Engine: pure seat-based state machine, effects in contract order
- B31 Server Timer Model: 15s+400ms deadlines, catch-up clock, late guess off
- B32 Team Side Selection: neutral 50/50 until signals.sides, 30-70% tilt
- B33a Solo Session Core: squad loader, in-memory runs, views, run figures
- B33b Solo Endpoints: 6 /solo/sessions routes, CLOCK, one open run a user
- B34 Solo Persistence: one-tx save at run end, stats upsert, minute sweep
- B35 REST Rate Limiting: throttler, user/IP/email keys, 429 with the wait
- B36 Socket Gateway: JWT + version gate, origin check, one socket a user
- B37 FIFO Matchmaking: queue:enter/leave, in-memory rooms, 60s timeout
- B38a Filters & Coin Flip: submit + pool check, 30s window, 2s reveal
