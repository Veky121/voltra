# Voltra

Host game servers on your own hardware and play with friends.

Voltra is built for home servers, personal computers and small friend groups. You supply the hardware and game licences; Voltra helps you install and manage the servers. This project does not provide rented servers or a public hosting service. An optional VPS can relay traffic to your hardware when you do not want router port forwarding.

Run the panel on your server, then connect through the browser or Windows desktop app. Friends see only the servers their accounts can access. The desktop app connects to your panel; installing it alone does not create or host game servers.

The panel uses Go, PostgreSQL and React/TypeScript, and manages game processes through Wings.

This repository is the Go rewrite and derivative of Pterodactyl Panel developed as Voltra. It preserves Pterodactyl-compatible APIs, egg formats, and Wings protocols where needed for interoperability. It is an independent project, not an official Pterodactyl release. Compatibility does not imply complete parity or verified gameplay for every game recipe.

## Build and run locally

Use the Go version declared in [go.mod](go.mod), Node.js with npm, Git, and Docker Desktop with Linux containers. Run from the repository root:

```powershell
.\dev.ps1 start
```

Open <http://127.0.0.1:5181>. Local credentials are in `.local/dev/login.txt`. This runs the real app with a dedicated PostgreSQL database, patched Wings, two local accounts and three game records. Files, console output and backups come from actual local games; installation and game agreements remain explicit.

Any agent or terminal can run `.\dev.ps1 restart backend`, `status`, `logs backend`, or `stop`. Processes persist independently of the starting agent, and ordinary starts preserve your edits. Frontend source changes reload through Vite. See [local development](docs/LOCAL_DEVELOPMENT.md) for service boundaries, production inventory refresh and verification.

## Build without the Windows helper

Provision PostgreSQL and supply `DATABASE_URL` and a persistent `ENCRYPTION_KEY` through your private runtime configuration. Build the web UI, then build the panel:

```sh
npm ci --prefix web
npm run build --prefix web
go build -o voltra ./cmd/panel
```

Run `./voltra` from the repository root. `LISTEN` defaults to `127.0.0.1:8088`, `PUBLIC_URL` defaults to `http://127.0.0.1:8088`, and `WEB_DIR` defaults to `web/dist`. Set `PUBLIC_URL` to the deployed HTTPS address. `DAEMON_URL` supplies a separate callback address reachable by Wings when required. Configure nodes in Administration after completing setup. See [operations](OPERATIONS.txt) for configuration, node installation, HTTPS, and recovery details.

Complete setup over a direct loopback connection before exposing the installation. `DEV_MODE=true` enables a local development identity before setup; completed installations require authentication. This repository does not ship game server downloads, Steam credentials, database contents, or a configured production installation.

## Development checks

```sh
go test ./cmd/... ./internal/...
npm run check --prefix web
npm run test:editor --prefix web
```

For the managed Windows dev environment, `.\test-local.ps1` configures the isolated database tests and runs the frontend typecheck. Otherwise supply `TEST_DATABASE_URL` for database integration tests. The explicit Go package paths exclude generated acceptance overlays under `artifacts/`; those are not standalone production packages. Runtime acceptance tools under `tools/` can install software and create game servers. Read their prerequisites and use isolated resources. A successful build or unit test does not prove a game client can join.

## Documentation

Start with the [documentation index](docs/README.md). It separates setup and operations, implementation contracts, verification tools and historical evidence.

Some engineering notes refer to private receipts under `artifacts/` or an adjacent reference checkout. Those files are excluded from the public source repository and are not needed for the normal build.

## License and provenance

The panel code is distributed under the [MIT license](LICENSE.md), with the original Pterodactyl copyright and permission notice retained. Upstream project: <https://github.com/pterodactyl/panel>. Wings remains a separate upstream component: <https://github.com/pterodactyl/wings>.

Retain [third-party notices](THIRD_PARTY_NOTICES.txt) and component license files when redistributing source or binaries. Vendored recipes, libraries, fonts, and embedded runtime helpers retain their own notices. Game downloads, publisher artwork, and trademarks are governed by their owners' terms and are not relicensed by the panel's MIT license. Upstream names in protocols, source URLs, container image references, schemas, and attribution are preserved for compatibility and provenance.
