# Coding Standards — Shared

Applies to **all three repositories**. Each repo also carries exactly one stack file:

| Repo             | Stack             | Also read                     |
| ---------------- | ----------------- | ----------------------------- |
| `lineup-backend` | NestJS            | `coding-standards-backend.md` |
| `lineup-web`     | Next.js           | `coding-standards-web.md`     |
| `lineup-mobile`  | Expo React Native | `coding-standards-mobile.md`  |

Rules live in exactly one file. If something here contradicts a stack file, the stack file wins for that repo.

## Repository Boundaries

Three repos, each app-scoped and independently deployable:

```text
lineup-backend    NestJS — REST, auth, Socket.IO, Prisma, rules engine, ingestion
lineup-web        Next.js — renders and transmits input
lineup-mobile     Expo — renders and transmits input
```

- **No repo depends on another repo.** No shared package, no submodule, no cross-repo import. Each repo defines its own validations, components, types, tokens and helpers, and a repo must build and run with the other two deleted.
- **The backend has no knowledge of its clients.** No branching on platform, no web-specific endpoint, no mobile-specific payload. If an endpoint only makes sense for one client, the design is wrong.
- **Neither client contains game logic.** No timer arithmetic that decides anything, no lives accounting, no answer validation, no turn order. Clients render what the backend sends. A countdown rendered from a server timestamp is presentation; a countdown that decides a life was lost is a bug.

## The Contract

Each repo carries its own copy of the request, response and socket payload shapes. There is no shared package. That is a deliberate trade: full independence, at the cost of keeping three copies honest.

What keeps them honest:

- **The backend defines the contract; clients conform to it.** When they disagree, the backend is right and the client is wrong. A client never gets a payload changed to suit its code.
- **The contract source of truth is documentation, not code.** The backend exposes an OpenAPI document (`@nestjs/swagger`) at a known path. A client may generate its types from it as a build step and commit the output — that is a generated artifact inside the client repo, not a dependency on the backend repo.
- **Socket payloads are not covered by OpenAPI** and are maintained by hand in each repo. They are the most likely thing to drift, which is what `PROTOCOL_VERSION` exists to catch.
- **`PROTOCOL_VERSION` is a plain constant declared independently in all three repos.** Clients send theirs on handshake; the backend accepts N and N-1 and refuses anything older. A mismatch surfaces as a refused connection, not as a desync mid-duel.
- Where Zod is used, types come from `z.infer`, never hand-written alongside a schema. Two definitions of one shape drift even inside a single repo.

A contract change is therefore three pieces of work in sequence: change the backend, update the web client, update the mobile client. Do not treat it as one task.

## Design Tokens

`theme.md` is the canonical palette, type scale, spacing and motion spec. Each client repo holds its own tokens file transcribed from it.

- **Values are copied, not imported.** The document is the single source; the files are its two transcriptions.
- Within a repo, the tokens file is the only place a hex value appears. Everything else resolves from it, so a palette swap stays a one-file change per repo.
- When `theme.md` changes, both client repos change. That is a known cost of the three-repo split.

## TypeScript

- Strict mode enabled.
- No `any` types. Use proper typing or `unknown`.
- Define types/interfaces for component props, API responses, CLI inputs/outputs, and domain data.
- Use type inference where obvious; use explicit types where it improves clarity.
- Prefer `type` for simple composition and `interface` where extension is useful.
- Use `async/await` for asynchronous operations.
- Every type lives in the repo that uses it, under its own types directory. Types describing network payloads are defined locally to match the backend contract.

## Imports

- All custom/internal imports must use the `@/` alias (e.g. `import { Button } from '@/components/ui/button'`).
- Relative imports (`./`, `../`) for internal app code are **not accepted** — rewrite them as `@/` imports.
- This applies to all internal code: components, hooks, lib/utils, types, actions, services, modules.
- `@/` is **repo-scoped** and never resolves outside the repo it is in.
- External package imports (npm packages) are unaffected and stay as normal package imports.

## Comments

- Avoid unnecessary comments; do not add comments to explain each statement written by AI.
- Do not add large block comments (e.g. `/** ... */`) that explain what the code does.
- Code should be self-explanatory through clear naming and structure — don't narrate the implementation.
- Add a comment only when it's genuinely necessary for readability (e.g. a non-obvious business rule, workaround, or edge case) — not as a default habit.
- When a comment is needed, use a short single-line `//` comment. Keep it brief — no multi-line or paragraph-style comments.
- For a single statement, a comment should not exceed one line or 50 characters.

## Naming

- Components: PascalCase (`ItemCard.tsx`)
- Component CSS modules: kebab-case (`item-card.module.css`)
- Other files: match their purpose; use kebab-case where appropriate.
- Functions: camelCase.
- Constants: SCREAMING_SNAKE_CASE.
- Types/Interfaces: PascalCase with no prefix.
- Booleans read as assertions: `isLoading`, `hasLives`, `canGuess`.

## Error Handling

- Handle expected errors explicitly.
- Use `try/catch` around filesystem, network, database and provider operations.
- Return structured results from services and shared helpers where appropriate: `{ success, data, error }`.
- Show user-friendly errors in the UI.
- Do not expose stack traces, SQL, provider responses or internal implementation details to end users.
- **Never fail silently on a game action.** A dropped guess, a lost socket event or a rejected round must surface to the player. A silent failure during a 15-second round is indistinguishable from a crash.

## Validation

- Validate every input crossing a boundary with Zod, using that repo's own schemas.
- Boundaries are: REST request bodies, REST responses, socket event payloads, client forms, and ingestion provider responses.
- **Client-side validation is a convenience, never a control.** The backend revalidates everything regardless of what the client claims to have checked.

## Testing

- Unit tests cover **services, utilities and the rules engine** — not components or pages.
- The backend `game` module is **mandatory** coverage: timer, lives, turn passing, round resolution, alias matching. It is pure, so it needs no mocks.
- Colocate tests as `*.spec.ts` (backend) or `*.test.ts` (clients) next to the code under test.
- Unit tests run in Node with no network and no database access.
- Integration and E2E suites **are** allowed network and database access, run as separate commands, and never against production data. A disposable Neon branch only.

## Code Quality

- No commented-out code unless specifically required.
- No unused imports, variables, or dead code.
- Keep functions focused and preferably under 50 lines when practical.
- Avoid unnecessary abstractions.
- Prefer composition over duplication.
- Keep UI, domain logic, persistence and transport concerns separated.

## Security

- **The backend is authoritative.** Never trust a client-supplied user id, score, tier, life count or elapsed time.
- The squad never appears in a response body, a socket payload, or a debug log — only revealed players, at reveal time.
- Secrets live in environment variables, validated at boot. Never in the repo, never in a client bundle.
- Anything in a client bundle is public. `NEXT_PUBLIC_` and `EXPO_PUBLIC_` variables are readable by anyone.
- Entitlements (free vs Pro) resolve on the backend. The client never asserts its own tier.
