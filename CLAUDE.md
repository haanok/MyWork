# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Requires Node.js 24+ (tests rely on Node's built-in TypeScript stripping).

```sh
npm ci && npm run dev        # Vite dev server on :5173 (data in localStorage)
npm run build                # tsc --noEmit (typecheck) + vite build → dist/
npm test                     # frontend logic tests: test/*.test.mjs
cd server && npm ci && npm test   # API + MCP end-to-end tests
```

Run a single test file / test by name:

```sh
node --test test/planning.test.mjs
node --test --test-name-pattern="Today separates" test/planning.test.mjs
cd server && node --test --test-name-pattern="412" test/api.test.mjs
```

There is no linter; `npm run build` (strict tsc with `noUnusedLocals`/`noUnusedParameters`) is the type gate. Build the container locally with `docker compose -f compose.yaml -f compose.build.yaml up -d --build`.

## Architecture

Two independent npm packages: the Vite/React/TS frontend at the root (`src/`) and a plain-ESM Node server in `server/` (no build step, own `package.json`/lockfile). `Dockerfile.selfhost` builds the frontend and ships it with the server as one image; GitHub Actions publishes it to `ghcr.io/haanok/mywork-selfhost` on pushes to `main`.

**Data model.** The whole board is one JSON document (`AppData` in `src/types.ts`: `customers`, `tasks`, `deletedTaskIds`, `version: 1`). The browser always loads and saves the entire document. Server-side it lives at `/data/<sub>/data.json` per Pocket ID user.

**Frontend state flow.** `src/store.ts` (`useBoard`) is a reducer over `AppData` that persists through a `StorageAdapter` (`src/storage.ts`). `App.tsx` picks `localStorageAdapter` when `import.meta.env.DEV`, otherwise `serverStorageAdapter` (`src/api.ts` → `GET/PUT /api/data`). So `npm run dev` never talks to the server.

**Concurrency (important when touching saves).** `GET /api/data` returns an ETag; saves send `If-Match`; the server replies `412` if the document changed (e.g. Claude edited via MCP). The client then throws `DataConflictError`, refetches, and runs a three-way merge in `src/merge.ts` (base = last loaded, local, remote; per record by id, field by field, local wins on the same field). Deletions propagate via `deletedTaskIds`. The tab also refreshes on focus when it has no unsaved changes. Tests for this live in `test/planning.test.mjs`.

**Server (`server/server.mjs`).** Single `http` server: serves `dist/`, `/healthz`, `/api/data`, `/api/mcp` (tells the UI whether MCP is on), `/mcp`, and `/.well-known/oauth-protected-resource`. It verifies JWTs itself with `jose` against `POCKET_ID_URL`'s discovery/JWKS — web ID tokens (aud `OIDC_CLIENT_ID`) are accepted only on `/api/data`, Claude access tokens (aud `MCP_CLIENT_ID` or `${PUBLIC_URL}/mcp`) only on `/mcp`. Optional `ALLOWED_GROUPS` check. `server/storage.mjs` handles the per-user file + ETag. `server/mcp.mjs` defines the MCP tools (zod schemas) that read/modify the same document. Auth in production is fronted by oauth2-proxy (see `compose.yaml` for the skip-auth routes and header settings that `/mcp` depends on). Server tests spawn `server.mjs` against a local fake OIDC/JWKS server with `OIDC_DISCOVERY_URL` (refused when `NODE_ENV=production`).

**Adding a task/customer field** usually touches: `src/types.ts`, the UI (`TaskEntry.tsx` / `CustomerWorkspace.tsx`), `src/api.ts` normalization if needed, and the MCP tool schemas + serializers in `server/mcp.mjs`. Fields must stay optional — older boards are loaded without migration, and JSON import/export (`parseImport`) uses the same shape.

**UI structure.** Home is either the orb map (`OrbMap.tsx` + `useOrbLayout.ts`, d3-force layout) or Today (`TodayView.tsx`, grouping logic in `src/taskPlanning.ts`). Clicking an orb opens `CustomerWorkspace.tsx` (list or `KanbanBoard.tsx` layout). Quick add (⌘K) parses `shortName: text` syntax in `src/quickAddParse.ts`. Time tracking is `timeTracking.ts` + `TimeTracker.tsx`/`DynamicIsland.tsx`.

**Theming.** Home themes (`HOME_THEMES` in `App.tsx`: spacewave, drift, paper, vivicta, vivicta-pixel, porcelain, porcelain-dark) are applied via `data-home-theme` on `.app`; `src/spacewave.css` is the base design and `src/themes.css` holds per-theme overrides keyed on that attribute. Some themes have canvas/animated surfaces (`AuroraSurface.tsx`, `DriftSurface.tsx`, `pixelScene.ts`). `DESIGN.md` and `PRODUCT.md` describe the design system and product intent (used by the impeccable design tooling in `.impeccable/`).

## Conventions

- Demo/test data must be clearly synthetic (see `src/sample.ts`, tests); there is no real customer data in the repo.
- Dates are local `YYYY-MM-DD` strings (`src/dates.ts`); `plannedFor`, `due`, and `followUp` are independent of each other.
- Keep orbs keyboard-reachable with text alternatives and respect `prefers-reduced-motion`.
- `.env` and `current.json` are excluded from Git and the Docker build context. Full self-hosting/MCP setup docs are in `README.md` and `docs/self-hosting.md`.
