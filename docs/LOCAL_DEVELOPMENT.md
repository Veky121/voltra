# Local development

Run `./dev.ps1 start` from the ptero-go directory. Open http://127.0.0.1:5181 and sign in with the generated account in `.local/dev/login.txt`. Requires Docker Desktop Linux containers, Go from go.mod, Node/npm and Git. First startup builds the patched Wings image from pinned upstream source and installs frontend dependencies if missing.

This is the real React app, Go API, PostgreSQL and Wings. No fetch interception, fake resources or demo-only pages are involved. The code is your current working checkout, which can differ from the deployed production version.

## Commands for every agent

```powershell
.\dev.ps1 start
.\dev.ps1 status
.\dev.ps1 restart backend
.\dev.ps1 restart frontend
.\dev.ps1 logs backend
.\dev.ps1 logs wings
.\dev.ps1 doctor
.\dev.ps1 stop
```

The default app target is backend and frontend. Starting the app also ensures its database and Wings exist. Stopping/restarting the app leaves Wings, game processes, files and PostgreSQL intact. `stop all` also stops the dedicated Wings and database containers; it does not delete volumes or stop individual game containers. Use the normal panel controls to stop games first when shutting down the entire environment. Explicit `restart wings` and `restart database` act only on those containers.

Backend restart builds successfully before stopping the old binary. Vite hot reload handles frontend source edits; restart it after changing configuration or dependencies. Logs and process records are shared under `.local/dev/`. Detached hidden processes survive the terminal/agent that launched them. PID, creation time and executable checks prevent killing a reused PID. Docker labels prevent adopting resources from another workspace. Port conflicts fail instead of killing listeners. An exclusive operation handle serializes changes, and the OS releases it after a crash.

Every agent is authorized by AGENTS.md to operate these exact local services. There is no permanent owner or agent-specific lease. This does not grant production access beyond the requested task or override platform execution policy.

## Local data

First startup creates admin with password `admin`, member with password `memeber`, a local node, ten loopback game allocations, and Minecraft Paper, Terraria and Mindustry server records using the actual bundled catalog. The member has limited server permissions. Disabled backup schedules provide editable schedule data. Seed activity describes what was actually created; no completed backups or running resources are fabricated.

Seed records initially have no installed game files. Install through the real app; agreements and licenses retain their normal requirements. Fresh clones start with metadata only. Initial verification receipts under `.local/dev/evidence/` describe that run; query the current API for installed games, backups and power state.

Starting again preserves account changes, server settings and schedules. It does not silently reset data or reapply fixtures. Keep `.local/dev/environment.json` with the PostgreSQL volume: it contains the local encryption key and generated credentials. login.txt records the initial passwords; if you change passwords in the app, use the new ones. Never publish these files. No reset command is provided that could erase another agent's work accidentally.

Agent API checks should reuse `.local/dev/tooling-key.json` as a Bearer credential instead of signing in repeatedly. It is a normal administrator client API key restricted to loopback, not an authentication bypass. Do not print it. Revoking it is respected; startup will report the mismatch rather than silently restore access. Browser sign-in retains production rate limits.

## Production reference

```powershell
.\dev.ps1 refresh
```

Refresh uses the configured home-server-ai SSH alias to read a bounded inventory from the active production database. It captures names, relationships, variable definitions and resource limits with a timestamp and runtime fingerprints, saving `.local/dev/production-snapshot.json`. It does not start a production binary, migrate a database or restart a service.

The capture deliberately excludes credentials, endpoints, accounts, startup scripts, environment values, jobs, game files and backup archives. It is an inventory reference, not a restorable database clone. Refresh does not overwrite local data. See tools/dev/snapshot.md. This gives the same application behavior with a small real local dataset; it does not claim an exact production data or runtime replica.

## Resource boundaries

| Resource | Local development value |
| --- | --- |
| Browser | http://127.0.0.1:5181 |
| Go API | http://127.0.0.1:18089 |
| PostgreSQL | 127.0.0.1:55440, database voltra_dev |
| Wings / SFTP | 127.0.0.1:18085 / 12025 |
| Game allocations | 127.0.0.1:25590 through 25599 |
| Containers | voltra-dev-postgres, voltra-dev-wings |
| Game network | voltra_dev, 172.30.95.0/24 |
| Linux game files | /var/lib/voltra-dev |
| Host state | .local/dev/ |

Fresh credentials and local destinations replace production infrastructure. Game installers still need Internet downloads. Wings uses the local Docker socket; this is a trusted development environment, not a sandbox for untrusted scripts. Do not import raw production database dumps or point local records at production nodes.

The old browser demo and start-local.ps1 are removed. Old acceptance tools, evidence, frozen runtimes and databases are separate work and are retained. Never delete or stop them merely because their path contains dev, local, test or demo.

## Verification

The full backend integration suite needs a disposable PostgreSQL database named
`voltra_test` or `voltra_test_<suffix>` on loopback. Set `TEST_DATABASE_URL` to its
connection URL and run `go test -timeout=20m ./...`. The TCP port can vary. Each integration
fixture creates and removes its own schema. GitHub CI supplies a separate
PostgreSQL service and passes this URL through `tools/ci/test-linux.sh`.

Required config examples are tracked in `internal/panel/testdata/game-settings`.
Historical receipt checks are separate: `go test -tags campaign_audit ./internal/panel -run FixtureCleanup` requires the original campaign database and
logs. `go test -tags native_fixtures ./internal/panel -run TestValheimPlusAPI`
requires the retained game/plugin archive. These opt-in checks are not native
acceptance evidence unless they actually run and pass with the matching inputs.

Run `npm.cmd run check --prefix web`, focused Go tests, and `python tools/dev/snapshot_test.py`. `./test-local.ps1` creates a temporary database on the designated dev PostgreSQL server, removes it after testing, and excludes generated artifact packages. After populating Mindustry, `node tools/dev/verify-api.mjs` checks the real Vite-to-API paths, permissions and backup data. `powershell -File tools/dev/verify-runtime.ps1` exercises independent controller processes, concurrent restarts, PID/port guards and recovery after a terminated lock holder; it briefly restarts the local app. Check `dev.ps1 status` and the authenticated node system-information endpoint before calling Wings ready. A running Docker container alone is insufficient. Native gameplay/client joining remains a separate check.

`powershell -File tools/dev/verify-websocket.ps1` verifies the real Vite WebSocket upgrade, panel proxy and Wings authentication without sending game commands. Initial validation receipts are under `.local/dev/evidence/`. No visual browser interaction, gameplay joining or backup restoration is implied by these checks.
