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
