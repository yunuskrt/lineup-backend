# Phase B01 — Repo & Scaffold

## Status

Complete

## Goals

- `src/main.ts`: create the app with `{ bodyParser: false }` and listen on `process.env.PORT ?? 8080`
- `tsconfig.json`: `@/*` → `src/*` path alias that works in `nest build` output, `vitest` and `test:e2e` under ESM `nodenext`
- Rewrite every relative internal import in `src/` and `test/` as an `@/` import
- `.oxlintrc.json`: turn `typescript/no-explicit-any` back on as an error; keep `no-floating-promises`
- Linter decision applied (see Open Questions): either keep oxlint and record the deviation, or swap to eslint + `typescript-eslint` + `eslint-config-prettier`
- Starter `AppController` / `AppService` handled per Open Questions, with `src/app.module.ts` left as the bare root module
- `npm run build`, `npm run lint`, `npm test` and `npm run test:e2e` all pass

## Already in place

From commit `bbb32a5`, so it's not rebuilt here:

- NestJS 12 on Express, ESM (`"type": "module"`, `nodenext`), TypeScript 6 with `strict: true`
- Prettier with `.prettierrc` / `.prettierignore` and a `format` script
- Vitest unit config (`*.spec.ts`) and e2e config (`*.e2e-spec.ts`) using `vite-tsconfig-paths`
- `.gitignore` covering `dist/`, `.env*`, coverage and `*.tsbuildinfo`

## Open Questions

Settle these before `/feature start`. Questions 1 and 2 are settled; 3 is worked out during implementation.

1. **eslint or oxlint?** The todo line says eslint. The scaffold ships oxlint with type-aware linting, and it already passes. **Decided: keep oxlint**, re-enable `no-explicit-any` and record the swap as a deviation.
2. **Starter files.** Do `app.controller.ts`, `app.service.ts`, `app.controller.spec.ts` and `test/app.e2e-spec.ts` get deleted? They're Nest's "Hello World" sample. **Decided: delete** the controller, the service and the unit spec. Keep a trivial e2e smoke test that boots `AppModule` and gets a 404 on `/`, so `test:e2e` stays meaningful until B44 adds health checks.
3. **How `@/` resolves at runtime.** `tsc` doesn't rewrite `paths`, and Node ESM won't resolve `@/` by itself. Check, in this order, until one works:
   - whether `nest build`'s built-in paths transformer rewrites `@/…js` correctly under `nodenext`
   - if not, `tsc-alias` as a post-build step
   - if neither works, ask before falling back to Node subpath imports (`#/`). That would break the `@/` rule, so it's not a silent choice.

## Out of Scope

- Environment schema and validation of `PORT` are B02. Read `process.env.PORT` raw for now.
- Contract, Swagger and `PROTOCOL_VERSION` are B03.
- Health endpoint, logging and Sentry are B44.
- README rewrite.

## Notes

- Scope: tooling and bootstrap only. No domain modules, no dependencies beyond what the alias or linter decision needs.
- Depends on: none.
- Constraints:
  - `bodyParser: false` is required by Better Auth (B10). Until B10, no route parses a JSON body, which is fine since none exists. B10 owns turning JSON parsing back on for non-auth routes.
  - Port 8080 is fixed so the backend runs beside the web app on 3000 (`CLAUDE.md`).
  - Strict TS and no `any` (`coding-standards.md`). Keep `strictPropertyInitialization: false`, which Nest's DI pattern needs.
  - `@/` imports only. No relative internal imports (`coding-standards.md` § Imports).
  - Deleting the starter files was confirmed (Open Questions 2). Delete nothing else without asking.
- Verification:
  - `npm run build`, then `node dist/main` starts on 8080 with no module resolution errors. This proves the alias works at runtime, not just in the type checker.
  - A `POST` with a JSON body to any route doesn't get parsed. A 404 is fine.
  - `npm run lint` flags a deliberately added `any`; remove it afterwards.
  - `npm test` and `npm run test:e2e` pass.

**Deviations recorded during implementation**

- Linter: kept oxlint instead of the eslint in todo.md, as decided in Open Questions 1.
- `@/` runtime: `nest build`'s built-in paths transformer rewrites `@/…js` to relative paths, nested files included. No `tsc-alias` needed.
- `vitest.config.ts`: added `passWithNoTests: true`. Deleting the starter spec left `npm test` with no files, so it failed.
- e2e smoke test builds the app with `bodyParser: false` to match `main.ts`.
- Body parsing: the 404 checks can't show whether a body was parsed. The proof is the `bodyParser: false` option itself; B10 tests it for real.

## History
