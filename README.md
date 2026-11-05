# MyWork

React/Vite customer workspace with an Electron desktop wrapper and an Azure
Functions API.

## Development

Requires Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Build the web app with `npm run build`, or start the desktop app with
`npm run desktop:dev`.

The API in `api/` requires its own `npm ci`, Azure Functions Core Tools,
local configuration in `api/local.settings.json`, and Azure credentials.
Local settings, environment files, and `current.json` are intentionally
excluded from Git and the container build context.

## Container Registry

GitHub Actions builds the web container on pull requests and publishes it
on pushes to `main` or manual workflow runs. Publishing uses the built-in
`GITHUB_TOKEN`; no registry password needs to be added to the repository.

Images are published to `ghcr.io/haanok/mywork`, tagged `latest` for `main`
and `sha-<commit>` for each published build. New GHCR packages are private
by default; retain private visibility in the package settings.

For local builds:

```sh
docker build -t mywork .
docker run --rm -p 8080:8080 mywork
```

The web frontend is then available at http://localhost:8080.

## Hosting Requirements

The container serves only the compiled frontend, using unprivileged Nginx.
It does not include Electron, Azure Functions, or Azure Static Web Apps
authentication. The existing app depends on same-origin `/api/` and
`/.auth/` routes provided by Azure Static Web Apps. Nginx returns 404 for
these routes rather than serving HTML in place of API responses.

A standalone container deployment therefore needs a separately configured,
authenticated gateway and API before login and cloud data synchronization
can work. `staticwebapp.config.json` is enforced only by Azure Static Web
Apps, not by Nginx. Do not expose the Azure Functions `data` endpoint directly
without trusted authentication middleware: it relies on identity headers
from Static Web Apps.

Publishing the image does not deploy the app or provision Azure resources.