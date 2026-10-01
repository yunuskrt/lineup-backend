# Phase B02 — Config Module

## Status

Complete

## Goals

- Add `zod` (v4) as a dependency
- `src/config/env.schema.ts`: Zod schema for the environment, with `Env` derived from it via `z.infer`
  - `NODE_ENV`: `development` | `test` | `production`, default `development`
  - `PORT`: coerced integer 1–65535, default `8080`. An empty string is rejected, not defaulted
- `src/config/parse-env.ts`: pure `parseEnv(raw)` returning `{ success, data, error }`. The error lists every bad key with a reason and **never the value**
- `src/config/config.module.ts`: global `ConfigModule` that provides the parsed `Env` through an injection token, so nothing outside `src/config/` reads `process.env`
- `src/main.ts`: validate the environment once, before `NestFactory.create`. On failure, print the bad keys and exit non-zero; on success, listen on `env.PORT`
- Load `.env` in development with Node's built-in loader (`--env-file-if-exists` or `process.loadEnvFile`). No dotenv package
- `.env.example` listing every key in the schema, with safe placeholder values
- `src/config/parse-env.spec.ts`: unit tests for defaults, coercion, rejection and the no-values-in-errors rule
- `vitest.config.ts`: remove `passWithNoTests`, added in B01 as a stopgap

## Open Questions

Both settled before `/feature start`.

1. **`@nestjs/config` or a hand-rolled module?** `@nestjs/config` adds dotenv loading and a `validate` hook, but `ConfigService.get` is stringly typed. **Decided: hand-rolled.** It's one small module with a typed token, and Node 22 already loads `.env` files.
2. **Declare future keys now?** For example `DATABASE_URL` (B04) and `BETTER_AUTH_SECRET` (B10). **Decided: no.** Each phase adds its own keys to the schema and `.env.example` when it first reads them. A required key nothing uses would block boot for no reason.

## Out of Scope

- Database, auth, CORS, Sentry and bucket variables: each owning phase (B04, B10, B13, B23, B44) adds its own
- Secret managers, or per-environment files beyond `.env` / `.env.example`
- Deployment environment setup (B45)

## Notes

- Scope: environment parsing and its delivery to the app. This phase only covers the keys the app reads today: `NODE_ENV` and `PORT`.
- Depends on: B01. `@/` alias, `bodyParser: false` and port 8080 are already in place.
- Constraints:
  - Secrets live in environment variables, validated at boot. Never in the repo, never in an error message or a log (`coding-standards.md` § Security). The failure output names keys, never values.
  - Fail fast: an invalid environment stops the process before Nest starts and before it listens.
  - `src/config/` is the only place that reads `process.env` (`coding-standards-backend.md` § Layout).
  - Types come from `z.infer`, never written by hand alongside the schema.
  - Return a structured result from `parseEnv`. `main.ts` decides to exit; the parser never calls `process.exit`.
  - `.env` stays git-ignored. `.env.example` is tracked (`!.env.example` is already in `.gitignore`).
- Verification:
  - `npm test`: the `parse-env` specs pass with `passWithNoTests` removed. The flag would otherwise hide a broken include pattern.
  - `PORT=abc node dist/main.js` exits non-zero and names `PORT`. Its output doesn't contain `abc`.
  - `PORT= node dist/main.js` (empty) is rejected, which fixes the B01 review finding.
  - `env -u PORT node dist/main.js` listens on 8080. `PORT=8090` listens on 8090.
  - `npm run start:dev` picks up a local `.env` without extra flags typed by hand.
  - `npm run build`, `npm run lint` and `npm run test:e2e` pass.

**Deviations recorded during implementation**

- Added `src/config/load-env.ts`, a cached `loadEnv()`, so `main.ts` and `ConfigModule` share one parse of `process.env`.
- `.env` loads through `nest start --exec "node --env-file-if-exists=.env"` in `start`, `start:dev` and `start:debug`. `--debug` still attaches. `start:prod` loads no `.env`; production gets its variables from the host.
- `main.ts` logs through Nest's `Logger` and sets `process.exitCode = 1` instead of calling `process.exit`, so the error output flushes before the process ends.
- `ConfigModule` throws the same formatted error if it's built with a bad environment, for test setups that skip `main.ts`.

## History
