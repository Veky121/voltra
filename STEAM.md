# Steam games and Quick setup

The Game Library includes Satisfactory and Palworld alongside Minecraft. Steam
installation and maintenance belong to the application. The managed game
templates only prepare a Wings volume and launch the native server. Their
container entrypoint updates and validation are disabled.

Steam requires an updated, connected Voltra node agent on native Linux amd64.
The connector advertises `steam-v1` and carries maintenance on its existing
authenticated outbound connection. No extra management port is exposed. Legacy
direct Wings nodes and existing custom eggs retain their current behavior.
Rerunning the published node installer upgrades the connector while preserving
its saved pairing. Unmodified generated services migrate automatically; custom
units require operator review. Normal connector upgrades leave Wings running.

## Maintenance

The server's Steam page exposes Check now, Update, Verify and repair files,
automatic mode, check interval, job progress and collapsed logs. Updates and
repair require a stopped game. Verify uses SteamCMD validation and may also
install the current branch build. Game updates do not update Workshop mods.

Default mode is Before start, with a one-hour interval after a successful build
check. Successful installs/updates/repairs also refresh that timestamp. Failed
checks have a separate five-minute retry delay. Manual checks bypass cooldowns.
Rapid starts and restarts do not repeat Steam checks; Wings crash recovery uses
the installed files directly. Scheduled mode checks periodically, applies
updates only while the game is stopped and never stops players automatically.

Panel power APIs, schedules and proxied WebSocket controls share the same start
rules. Each server has at most one active maintenance job. Repeated compatible
requests reuse it. Stop/kill remove pending start intent. Quick setup writes,
maintenance mutations and Panel starts share a database mutation lock.

Jobs and progress logs are durable. Panel leases recover abandoned jobs. The
node keeps private phase receipts and configuration snapshots. Lost results or
interrupted mutations require repair before starting. Explicit failures that
confirm no files changed preserve an existing known-good installation. These
guards cannot prevent a root operator or unrelated external tooling from
starting containers or editing files directly.

Failed anonymous SteamCMD output is bounded to 64 KiB in a private node journal
log for operator diagnosis; browser job logs contain only safe progress messages.
Completed read-only receipts expire after seven days or above 2,048 receipts.
Mutation and recovery receipts remain protected against replay.

The fixed Steam helper runs without root privileges against the server's
validated UUID volume, with bounded resources and execution time. Initial empty
Wings directories can receive the trusted Wings user's ownership on that one
directory; existing installations are never recursively chowned. Preservation
policies protect Satisfactory/Palworld runtime configuration while allowing
shipped engine defaults to update. Other Steam games need their own reviewed
launch, port and preservation definitions before becoming supported.

## Game setup

Satisfactory allocates a TCP/UDP game port and a separate reliable TCP port.
After boot, use the in-game Server Manager to add the address, claim the server,
set passwords and create/load a session. Quick setup links the actual save and
session blueprint directories after they exist. Blueprint uploads use matching
`.sbp` and `.sbpcfg` files in the correct session folder. No mod manager is added.

Palworld exposes its name, player limit, join password and common world settings
through Quick setup. RCON and the REST API start disabled. The guided installer
uses 16 GiB by default and warns through its resource selection if reduced.

Minecraft Quick setup edits allowlisted `server.properties` fields. Native
settings editors preserve unknown fields and require a stopped game, the
appropriate file permissions and a matching revision. Concurrent or externally
changed files produce a reload conflict. Missing game defaults remain omitted
unless the user changes them. Folder shortcuts require actual safe directories.

## Verification

`go test ./...` with `TEST_DATABASE_URL` exercises isolated PostgreSQL schemas.
Steam job tests use authenticated WebSocket streams and fake Steam/Wings.
Executor tests use fake Docker plus Linux ownership/terminal/service fixtures.
The web fixture in `web/tests/browser/steam-ui.md` never contacts a real API.

`TestSteamLiveEasySetup` is an opt-in download/start test. Set
`STEAM_LIVE_ACCEPTANCE=true` and `TEST_DATABASE_URL`, build Linux node artifacts
with `tools/node/build.ps1`, and build `tools/runtime/Dockerfile.steam-node-test`
as `voltra-steam-node-test:local`. It requires the local
`pteroclone-wings:local` image, Docker Desktop host access and a free loopback
port 8091. It creates a random schema and uniquely named temporary containers
and game directories. It downloads both actual games, requires sustained running
processes, reads Quick setup and gracefully stops them. It does not establish
successful gameplay joins or production systemd enforcement.

Launch/runtime references were cross-checked against the upstream recipes:
https://github.com/pterodactyl/game-eggs/tree/main/satisfactory
https://github.com/pterodactyl/game-eggs/tree/main/palworld
Native settings/arguments also follow the game developers' documentation. In
particular, Palworld's older egg performance flags/config-parser executable and
both eggs' independent Steam update flows are not required by this managed path.
