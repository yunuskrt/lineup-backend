# Lineup — Backend

Know the XI. Beat the Clock.

## Architecture

Three separate repositories, one backend:

| Repo             | Stack             | Role                                                   | Deploys to        |
| ---------------- | ----------------- | ------------------------------------------------------ | ----------------- |
| `lineup-backend` | NestJS            | REST, auth, Socket.IO, Prisma, rules engine, ingestion | Railway / Fly.io  |
| `lineup-web`     | Next.js           | Browser client — renders and transmits input           | Vercel            |
| `lineup-mobile`  | Expo React Native | iOS + Android client — renders and transmits input     | EAS → both stores |

**This repo.** It owns the API contract, documented via OpenAPI. The clients transcribe it by hand.

**No code is shared between repos.** No package, no submodule, no cross-repo import. This repo must build with the other two deleted.

## Context Files

- @context/project-overview.md
- @context/coding-standards.md
- @context/coding-standards-backend.md
- @context/ai-interaction.md
- @context/current-feature.md
- @context/mock-to-backend-map.md
- @context/api-contract.md
- @context/monetization.md

`project-overview.md` is the shared spec and must stay identical in all three repos.

@context/todo.md is for developer-side use. **Do not modify the project context based on this file.**

## Commands

Port is fixed so the web app (3000) and the backend (3001) run side by side.

- **Dev server**: `npm run start:dev` (http://localhost:3001)
- **Build**: `npm run build`
- **Test**: `npm test`
- **Lint**: `npm run lint`
- **Migrate**: `npx prisma migrate dev`

**IMPORTANT:**

- **Do not add 'co-authored by Claude'** to any commit message
- History entries in `current-feature.md` must not exceed 75 characters
- Do not edit `todo.md` unless told to via prompt or skill
- When a phase completes, ask to tick it in `todo.md` in the same commit
- No game logic outside `src/game/` — it is pure and imports nothing from NestJS or Prisma
- The squad is never sent to a client, logged, or put in an error message
- Never trust a client-supplied user id, tier, life count or elapsed time
