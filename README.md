# Lineup — Backend

Know the XI. Beat the Clock.

The NestJS service behind Lineup: REST, auth, Socket.IO duels, Prisma, the rules engine and offline data ingestion. It owns the API contract, documented via OpenAPI; the web (`lineup-web`) and mobile (`lineup-mobile`) clients transcribe it by hand. No code is shared between the three repos.

## Setup

Requires Node v22.22.3+ (or v24.15+) and npm 11+.

```bash
npm install
```

## Commands

| Command              | What it does                                 |
| -------------------- | -------------------------------------------- |
| `npm run start:dev`  | Dev server in watch mode on port 3001        |
| `npm run build`      | Compile to `dist/`                           |
| `npm run start:prod` | Run the compiled build                       |
| `npm test`           | Unit tests (Vitest, `*.spec.ts`)             |
| `npm run test:e2e`   | E2E tests in `test/`                         |
| `npm run lint`       | Lint `src/` and `test/`                      |
| `npm run format`     | Format `src/` and `test/` with Prettier      |

## Project docs

- [`context/project-overview.md`](context/project-overview.md) — the shared product spec
- [`context/todo.md`](context/todo.md) — backend build phases, in order
- [`context/README.md`](context/README.md) — what every context file is for
