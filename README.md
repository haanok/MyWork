<div align="center">

<img src="public/favicon.svg" alt="MyWork logo" width="96" height="96">

# MyWork

[![Build and publish container](https://github.com/haanok/MyWork/actions/workflows/container.yml/badge.svg)](https://github.com/haanok/MyWork/actions/workflows/container.yml)
![Node.js 24+](https://img.shields.io/badge/node-%3E%3D24-3c873a?logo=node.js&logoColor=white)
![React 19](https://img.shields.io/badge/react-19-61dafb?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-blue?logo=typescript&logoColor=white)
[![MCP](https://img.shields.io/badge/MCP-remote%20server-8a63d2)](https://modelcontextprotocol.io)

A customer map for consultants who juggle many clients at once.

[Features](#features) · [Getting started](#getting-started) · [Daily workflow](#daily-workflow) · [Self-hosting](#self-hosting) · [Use with Claude](#use-mywork-from-claude) · [Project structure](#project-structure)

</div>

---

Each customer is an orb on a home map, and one click opens it in a helpdesk-style workspace. There you'll find a task ledger, contacts, working notes and a handover note for where you left off. Use MyWork to switch customers quickly, capture tasks in seconds and plan your day. It's single-user and self-hosted, and Claude can read and update your board over [MCP](https://modelcontextprotocol.io).

## Features

- **Customer map.** Customers are force-laid-out orbs that stay legible when there are many, can be reached by keyboard and respect reduced motion.
- **Customer workspace.** Each customer has a task ledger in a **List** or **Board** (kanban) layout, plus contacts, notes, a status and an autosaved **Continue here** handover note.
- **Quick add.** Press <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> anywhere to capture a task for any customer, with the customer, due date and priority set in one line.
- **Today view.** Today groups deadlines, planned work, waiting tasks with due follow-ups, and tasks you finished today.
- **Waiting on.** A task can wait on a person or dependency and get its own follow-up date and board column.
- **Time tracking.** An optional Dynamic Island tracker logs time per open customer and resets every day.
- **Themes.** Choose from Spacewave, Drift, Paper, Vivicta, Vivicta Pixel, Porcelain and Porcelain Dark.
- **Your data, portable.** Import and export the whole board as JSON. Each user's data is stored as a JSON file on your own server.
- **Remote MCP.** Claude (web, desktop, mobile and Claude Code) can list, search and edit customers, notes, contacts and tasks. If you edit in the browser at the same time, the changes are merged field by field.

## Getting started

You need [Node.js 24](https://nodejs.org) or later and npm.

```sh
git clone https://github.com/haanok/MyWork.git
cd MyWork
npm ci
npm run dev
```

Open the URL Vite prints, usually <http://localhost:5173>.

> [!NOTE]
> In development the board is stored in your browser's `localStorage`, and no backend or login is involved. The server API, Pocket ID login and MCP only run in the [self-hosted](#self-hosting) setup.

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check and build the frontend to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the day-planning and concurrent-merge tests |
| `cd server && npm test` | Run the API and MCP integration tests against a local JWKS |

## Daily workflow

- **Continue here.** Each customer has an autosaved handover note at the top, in both the List and Board layouts.
- **Waiting on.** Set a task's status to *Waiting*, then fill in **Waiting for** and **Follow up**. Waiting tasks get their own board column and appear under **Waiting & follow-ups** in Today when a deadline, plan or follow-up is due.
- **Plan today.** Pick tasks in Today, or use **Plan for today** on a task. **Planned for** also accepts a future workday. Plans are independent of deadlines: an unfinished plan carries forward until you complete it, reschedule it or remove it.

Quick add reads a single line:

```text
acme: call Per about the contract fri !
```

- The text before the colon picks the customer, by short name or the start of its name. Leave it out to use the open customer.
- A trailing due word sets the deadline. It can be `today`, `tomorrow`, a weekday (`fri`, `friday`, or Norwegian `fre`), `+3` or `3d`, `2026-11-12`, or `12.11`.
- A trailing `!` marks the task as high priority.

> [!TIP]
> Press <kbd>⌘F</kbd> / <kbd>Ctrl+F</kbd> to jump straight to customer search.

## Self-hosting

In production a single Node process serves the built frontend and the `/api/data` API. It sits behind oauth2-proxy, with [Pocket ID](https://pocket-id.org) as the OIDC provider:

```text
Internet → host nginx (TLS) → oauth2-proxy :4180 → app :7071
                                   │
                                   └── OIDC with Pocket ID
```

The app checks the Pocket ID token on every request and stores each user's data in `/data/<sub>/data.json`. Saves use ETags, so a save never silently overwrites an edit made in another tab or by Claude.

1. Create an OIDC client in Pocket ID. Set the callback URL to `${PUBLIC_URL}/oauth2/callback`, enable PKCE and restrict it to an allowed user group.
2. Configure and start the stack:

   ```sh
   docker login ghcr.io -u <github-user>        # token with read:packages
   cp .env.example .env
   openssl rand -base64 32 | tr -- '+/' '-_'     # paste as OAUTH2_PROXY_COOKIE_SECRET
   $EDITOR .env                                   # PUBLIC_URL, POCKET_ID_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET
   docker compose config --quiet && docker compose pull && docker compose up -d
   ```

3. Point the host's nginx at oauth2-proxy, starting from [docs/mywork.subdomain.conf](docs/mywork.subdomain.conf).

> [!IMPORTANT]
> The image `ghcr.io/haanok/mywork-selfhost` is private, so you have to log in to GHCR first. If you store data in a host directory (`DATA_PATH`), that directory must be writable by `APP_UID:APP_GID`. On Unraid, use `99:100`.

To update, run `docker compose pull && docker compose up -d`. To build from a checkout instead, add `-f compose.build.yaml`. GitHub Actions builds the image on pull requests and publishes it on pushes to `main`, tagged `latest` and `sha-<commit>`.

For the full guide, see **[docs/self-hosting.md](docs/self-hosting.md)**. It covers every environment variable, group-based access, session lifetime, nginx headers and troubleshooting.

## Use MyWork from Claude

The app can serve a remote MCP server at `${PUBLIC_URL}/mcp`. It's off until you set `MCP_CLIENT_ID`.

1. Create a second Pocket ID client for Claude. Use the callback `https://claude.ai/api/mcp/auth_callback`, enable PKCE, and add an API whose identifier is exactly `${PUBLIC_URL}/mcp`.
2. Set `MCP_CLIENT_ID` in `.env` and restart. The logs then show `MCP enabled at …/mcp`.
3. In Claude, go to **Settings → Connectors → Add custom connector**, enter the `/mcp` URL and the client ID, and sign in with Pocket ID.

The plug button in the app's header shows these values with copy buttons, along with setup steps for Claude Code, VS Code and other MCP clients.

| Read | Write |
| --- | --- |
| `list_customers`, `get_customer`, `list_tasks`, `search` | `add_customer`, `update_customer`, `append_note`, `add_contact`, `add_task`, `update_task`, `delete_task` |

> [!NOTE]
> Claude's tokens are only accepted on `/mcp`, and web tokens only on `/api/data`. For token audiences, group checks and troubleshooting, see [docs/self-hosting.md](docs/self-hosting.md#3-use-mywork-from-claude-remote-mcp).

## Project structure

```text
src/                 React frontend (map, workspace, Today, quick add, themes)
server/              Node backend: static files, /api/data, OIDC verification, MCP
test/                Frontend logic tests (planning, merge)
docs/                Self-hosting guide, nginx example, third-party licences
compose.yaml         App + oauth2-proxy stack
Dockerfile.selfhost  Image used by compose.yaml
DESIGN.md            Design system (colours, type, components)
PRODUCT.md           Product brief and principles
```
