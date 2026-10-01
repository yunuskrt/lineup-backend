# Coding Standards — Backend (NestJS)

For `lineup-backend`. Read alongside `coding-standards.md`, which always applies.

## Layout

- One NestJS module per domain under `src/` (`auth`, `users`, `catalog`, `matches`, `solo`, `duel`, `storage`).
- `src/game/` is the rules engine: pure TypeScript, **no NestJS, no Prisma, no I/O**. Every function is unit tested.
- `src/contract/` holds the Zod schemas for every request, response and socket payload, plus `PROTOCOL_VERSION`.
- `src/config/` parses the environment with Zod at boot and fails fast.
- `scripts/ingest/` is offline tooling. `src/` never imports it.

## Controllers and services

- Controllers stay thin: validate, call one service, return.
- Every response uses the result envelope the clients expect: `{ success: true, data }` or `{ success: false, error: { code, message, retryAfterMs, emptyBecause? } }`. The error codes are listed in `api-contract.md`.
- Validate every body, query and socket payload with the `src/contract/` Zod schemas. Types come from `z.infer`.

## Data

- Prisma is the only database access, through `PrismaService`.
- Migrations only through `prisma migrate`. Never edit an applied migration.
- Postgres is the record. Redis or in-memory state is only what is safe to lose.

## Realtime

- One Socket.IO gateway. Every handshake checks a JWT and `PROTOCOL_VERSION` (N and N-1).
- The server owns the clock: payloads carry `startedAt` and `endsAt` timestamps.

## Testing

- Vitest. Tests sit next to the code as `*.spec.ts`.
- `src/game/` must be covered: timer, lives, turns, round resolution, normalisation, matching, collisions.
- Unit tests touch no network and no database. E2E and the two-client harness live in `test/` and run as separate commands.

## Errors and logs

- Never leak a stack trace, SQL or provider response to a client.
- Never log the squad.
