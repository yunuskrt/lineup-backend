# Phase B03b — OpenAPI & Envelope

## Status

Not Started

## Goals

- Add `@nestjs/swagger`
- `src/contract/openapi.ts`: build the OpenAPI components from the registry of `.meta({ id })` schemas, via `z.toJSONSchema(..., { target: 'openapi-3.0' })`
- `src/main.ts` / `src/docs/`: serve Swagger UI at `/docs` and the raw document at `/docs/openapi.json`, with every contract schema under `components.schemas`
- `src/common/zod-validation.pipe.ts`: validates a body, query or param against a contract schema. Failure → `invalid_input`, message safe to show, no Zod internals
- `src/common/contract-response.ts`: a decorator that declares a route's response schema, plus an interceptor that parses the return value against it and wraps it as `{ success: true, data }`
- `src/common/envelope-exception.filter.ts`: global filter that maps every thrown error to `{ success: false, error: ApiError }`. Known errors carry their code; anything unexpected becomes `server_error`
- `test/contract.e2e-spec.ts`: a test-only controller proving success wrapping, validation failure, an unknown throw and the docs routes

## Open Questions

1. **Native `z.toJSONSchema` or `@asteasolutions/zod-to-openapi` v9?** `nestjs-zod` is out: its peers stop at Nest 11. Recommendation: native. Zod 4.6 emits OpenAPI 3.0 directly, it needs no extra dependency, and routes reference components with `@ApiBody`/`@ApiResponse` and `$ref`.
2. **Docs in production?** Recommendation: yes. Clients may generate types from `/docs/openapi.json` as a build step (`coding-standards.md` § The Contract). The document holds shapes, never data.

## Out of Scope

- Real routes. Each feature phase decorates its own, starting at B10 and B14.
- Socket ack envelopes and the protocol gate: B36.
- Rate-limit `retryAfterMs` population: B35. The filter only passes it through.
- JSON body parsing. It stays off until B10 (`bodyParser: false`), so the e2e test exercises the pipe through query parameters.

## Notes

- Scope: delivering the B03a contract over HTTP. The document, input validation, output parsing and the error envelope.
- Depends on: B03a.
- Carried over from B03a:
  - Components come from `contractRegistry` in `src/contract/registry.ts`, not Zod's global registry.
  - `z.toJSONSchema` adds a `$id` to each component; strip it before merging into `components.schemas`.
  - A route that returns nothing responds `{ success: true, data: null }` (`EmptyResult`).
  - `HistoryQuery` coerces `limit` from the query string, so input schemas need the `io: 'input'` view when emitted.
- Constraints:
  - Controllers stay thin: validate, call one service, return. The pipe, interceptor and filter are what make that possible (`coding-standards-backend.md`).
  - **Never leak** a stack trace, Zod issue dump, SQL or provider text to a client. `server_error` carries a fixed message. Details go to the server log only, and never with the response payload, since that payload could hold a squad.
  - A response that fails its schema is a server bug. It goes out as `server_error`, never as the unparsed value.
  - `retryAfterMs` is `null` on every code but `rate_limited`. `emptyBecause` is present only with `empty_pool` (`api-contract.md` §2).
  - The filter never emits `network`; that code is client-only.
- Verification:
  - Call `GET /docs/openapi.json` over HTTP. It's valid OpenAPI 3.0 and lists `MatchInPlay`, `SoloSession`, `DuelSession` and `ApiError` under `components.schemas`.
  - `GET /docs` serves the UI.
  - `npm run test:e2e`:
    - a valid query comes back wrapped in `{ success: true }`
    - a bad query → `invalid_input`
    - an undeclared output field is stripped
    - a thrown `Error` → `server_error` with no stack in the body
  - `npm test`, `npm run build` and `npm run lint` pass.

## History
