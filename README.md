# Voltra

Host game servers on your own hardware and play with friends.

Voltra is built for home servers, personal computers and small friend groups. You supply the hardware and game licences; Voltra helps you install and manage the servers. This project does not provide rented servers or a public hosting service. An optional VPS can relay traffic to your hardware when you do not want router port forwarding.

Run the panel on your server, then connect through the browser or Windows desktop app. Friends see only the servers their accounts can access. The desktop app connects to your panel; installing it alone does not create or host game servers.

The panel uses Go, PostgreSQL and React/TypeScript, and manages game processes through Wings.

This repository is the Go rewrite and derivative of Pterodactyl Panel developed as Voltra. It preserves Pterodactyl-compatible APIs, egg formats, and Wings protocols where needed for interoperability. It is an independent project, not an official Pterodactyl release. Compatibility does not imply complete parity or verified gameplay for every game recipe.

## Build and run locally

Use the Go version declared in [go.mod](go.mod), Node.js with npm, and Docker Desktop for the Windows development helper. Run these commands from the repository root:

```powershell
npm ci --prefix web
npm run build --prefix web
.\start-local.ps1
```

Open <http://127.0.0.1:8088> and complete first-run administrator setup. The helper creates a separate local PostgreSQL instance and stores generated credentials in ignored `.local/runtime.env`. Keep that file and the database volume together. Losing the encryption key makes stored integration credentials unreadable.

For frontend development, run `npm run dev --prefix web` in another terminal. Vite uses <http://127.0.0.1:5180> and proxies API requests to the Go panel.

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
go test ./...
npm run check --prefix web
npm run test:editor --prefix web
```

Database integration tests require an isolated PostgreSQL database through `TEST_DATABASE_URL`. Runtime acceptance tools under `tools/` can install software and create game servers. Read their prerequisites and use isolated resources. A successful build or unit test does not prove a game client can join.

## Documentation

- [Game setup](GAME_SETUP.md), [Minecraft](MINECRAFT_SETUP.md), and [Steam](STEAM.md)
- [File manager](FILE_MANAGER.md) and [proxy gateways](FRP_PROXY.md)
- [Desktop build and pairing](desktop/README.md)
- [Brand assets](branding/README.md)

Some engineering documents refer to local acceptance receipts under `artifacts/` or an adjacent reference checkout. Those private development files are excluded from this source repository and are not required for the normal panel build.

## License and provenance

The panel code is distributed under the [MIT license](LICENSE.md), with the original Pterodactyl copyright and permission notice retained. Upstream project: <https://github.com/pterodactyl/panel>. Wings remains a separate upstream component: <https://github.com/pterodactyl/wings>.

Retain [third-party notices](THIRD_PARTY_NOTICES.txt) and component license files when redistributing source or binaries. Vendored recipes, libraries, fonts, and embedded runtime helpers retain their own notices. Game downloads, publisher artwork, and trademarks are governed by their owners' terms and are not relicensed by the panel's MIT license. Upstream names in protocols, source URLs, container image references, schemas, and attribution are preserved for compatibility and provenance.
