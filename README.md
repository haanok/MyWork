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

Two images are published, each tagged `latest` for `main` and
`sha-<commit>` for each published build:

- `ghcr.io/haanok/mywork` from `Dockerfile` (frontend only, nginx).
- `ghcr.io/haanok/mywork-selfhost` from `Dockerfile.selfhost` (frontend
  and API, used by `compose.yaml`; see the self-hosted section below). New GHCR packages are private
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
## Self-hosted (Docker Compose + Pocket ID)

`compose.yaml` runs MyWork on your own server without Azure:

```
Internet → host nginx (TLS) → oauth2-proxy :4180 → app :7071
                                   │
                                   └── OIDC with Pocket ID
```

- **app** (`ghcr.io/haanok/mywork-selfhost`, built from
  `Dockerfile.selfhost` with code in `server/`): one Node process that
  serves the built frontend and implements `GET/PUT /api/data`. It verifies
  the Pocket ID ID token that oauth2-proxy forwards in
  `Authorization: Bearer …` (issuer = `POCKET_ID_URL`, audience =
  `OIDC_CLIENT_ID`, keys from the issuer's discovery document) and stores
  each user's data in the `mywork-data` volume at `/data/<sub>/data.json`.
  `/.auth/login/aad` and `/.auth/logout` redirect to oauth2-proxy, so the
  frontend is unchanged and still deploys to Azure Static Web Apps.
- **oauth2-proxy** handles login and is the only service published on the
  host, on `${BIND_ADDRESS:-127.0.0.1}:${PORT:-4180}`. The stack contains no nginx; the
  host's existing nginx proxies to it.

The original `Dockerfile`/`nginx.conf` image and the GHCR workflow are not
affected.

### 1. Create the OIDC client in Pocket ID

In Pocket ID, go to **Administration → OIDC Clients → Add OIDC Client**:

- **Callback URL:** `${PUBLIC_URL}/oauth2/callback`, for example
  `https://mywork.example.com/oauth2/callback`.
- **PKCE:** enabled (oauth2-proxy uses `S256`). Keep it a confidential
  client (not *Public client*), so it has a client secret.
- **Allowed user groups:** add the group whose members may use MyWork.
  This is the primary access control; users outside it cannot sign in.

Copy the client ID and client secret.

Optionally, set `ALLOWED_GROUPS` (comma-separated group names) as a second
check: the app then also requires one of these names in the token's
`groups` claim and returns `403` otherwise.

### 2. Configure and start

On the server you only need `compose.yaml` and `.env` (plus this README
and `docs/mywork.subdomain.conf` for reference); the app image is pulled from
GHCR. The package is private, so log in once with a GitHub personal access
token (classic) that has the `read:packages` scope:

```sh
docker login ghcr.io -u <github-user>      # paste the token as password
```

```sh
cp .env.example .env
openssl rand -base64 32 | tr -- '+/' '-_'   # paste as OAUTH2_PROXY_COOKIE_SECRET
$EDITOR .env                                 # PUBLIC_URL, POCKET_ID_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET
docker compose config --quiet                # validates; fails if a required variable is missing
docker compose pull
docker compose up -d
docker compose logs -f
```

Data is stored in the named volume `mywork-data` by default. To keep it in
a host directory instead, set `DATA_PATH` in `.env`. The directory must be
writable by the user the app runs as, `APP_UID:APP_GID` (default
`1000:1000`); otherwise saving fails with `EACCES` in `docker compose logs
app`. On Unraid, use `APP_UID=99` and `APP_GID=100` (`nobody:users`) and
`chown 99:100` the directory.

To update after a new build on `main`: `docker compose pull && docker
compose up -d`. To pin a specific build, set
`MYWORK_IMAGE=ghcr.io/haanok/mywork-selfhost:sha-<commit>` in `.env`. To
build from a checkout instead of pulling, run
`docker compose -f compose.yaml -f compose.build.yaml up -d --build`.

Then add a server block to the host's nginx, based on
[docs/mywork.subdomain.conf](docs/mywork.subdomain.conf). The example uses the SWAG layout
(`/config/nginx/proxy.conf` sets `Host` and `X-Forwarded-Proto/Host/For`).
It must proxy to `BIND_ADDRESS:PORT` from `.env`; when nginx runs in its own
container, set `BIND_ADDRESS` to the host's LAN IP, since `127.0.0.1` is not
reachable from inside that container. It also needs large headers for the
split session cookies:

```nginx
large_client_header_buffers 4 32k;
proxy_buffer_size 16k;
client_max_body_size 10m;
```

Open `PUBLIC_URL`; you are sent to Pocket ID and back to the app.

Notes:

- **Session lifetime.** The session cookie lasts `COOKIE_EXPIRE` (168h) and
  oauth2-proxy refreshes the ID token every `COOKIE_REFRESH` (30m) if Pocket
  ID issued a refresh token. If it did not, an expired ID token makes the API
  return `401`; the frontend then goes through `/.auth/login/aad`, which
  starts a new login that Pocket ID completes silently while its own session
  is valid. No data is lost, since nothing is saved on a `401`.
- **Unverified email.** If login fails with `email in id_token isn't
  verified`, set `ALLOW_UNVERIFIED_EMAIL=true` in `.env` (or verify the
  user's address in Pocket ID).
- **Logout.** `/.auth/logout` clears the oauth2-proxy session only. The
  Pocket ID session remains, so the next visit signs in again without a
  prompt.
- **Obsidian plugin.** `/api/obsidian/data` is not available in the
  self-hosted setup and returns `404`. It validated Entra access tokens; a
  self-hosted version would need the plugin to obtain tokens from Pocket ID.
- **Tests.** `cd server && npm ci && npm test` runs the API tests against a
  local JWKS with self-signed tokens.

### 3. Migrate data from Azure

Azure stores data in the blob `userdata/<entra-oid>/data.json`. The
self-hosted app uses the Pocket ID user's `sub` (a UUID) instead.

1. Download the blob:

   ```sh
   az storage blob download --auth-mode login \
     --account-name <storage-account> --container-name userdata \
     --name <entra-oid>/data.json --file data.json
   ```

2. Find the user's `sub`. It is the user ID shown on the user's page under
   **Administration → Users** in Pocket ID. The app also logs it the first
   time a user without stored data signs in:

   ```sh
   docker compose logs app | grep 'No stored data for user'
   ```

3. Copy the file into the volume. Running the copy inside the container
   gives it the right owner:

   ```sh
   SUB=<pocket-id-sub>
   docker compose exec -T app sh -c "mkdir -p /data/$SUB && cat > /data/$SUB/data.json" < data.json
   ```

   (With `docker compose cp`, the file is owned by root; fix it with
   `docker compose exec -u root app chown -R 1000:1000 /data/$SUB`, using
   your `APP_UID:APP_GID` if you changed them. With `DATA_PATH` you can
   instead copy the file to `$DATA_PATH/$SUB/data.json` on the host and
   `chown` it to `APP_UID:APP_GID`.)

4. Reload the app in the browser.
