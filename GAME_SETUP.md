# Game setup rollout

Before claiming current-source native acceptance, compare the installed helper
bytes with the canonical installer, not just the running panel's cached egg.
A source build does not update an already-running panel. Preserve the original
attempt when those versions differ, coordinate any fixture-only egg update,
and verify the next stopped installation before starting it. Never update an
egg used by operator servers to repair an acceptance fixture.

Renown remains partially verified. Its original 4 GiB setting was OOM-killed;
the default now starts at 8 GiB. Current-source 7 GiB and 8 GiB runs completed
bounded native startup and normal API Stop with exit 130 and no OOM. Reinstall
and reload retained configuration and save identities. Native save processing
still reports 100 building-restoration failures, including on the first world
creation, so complete world restoration is unproven. Query, RCON authentication
and player gameplay were not tested. The fixture is cleaned up; private saves
and receipts remain. See `artifacts/renown-default-native-stopped-handoff.json`,
`artifacts/renown-default-native-live-root-review.json` and
`artifacts/renown-save-load-context-assessment.json`.

Current progress is recorded in `artifacts/game-progress-current.json`; older
acceptance paragraphs below describe their specific tested snapshots. A recipe
implementation is separate from native verification. Native verification does
not imply a player joined or gameplay was tested.

Citadel is partially verified on native Linux. The installer now tracks the
Steam SDK file it owns and rejects untracked or modified replacements before
updating game content. Its transaction preserves the prior SDK and ownership
receipt if publication fails. Native startup, assigned UDP binds, normal API
Stop and a second startup passed without OOM; both Stops returned exit 130.
Reinstall retained all 22 captured state/configuration files with their bytes,
modes and ownership. No world save files appeared, including after the second
Stop, so world persistence remains unproven. Query responses, public listing and
player gameplay were not tested. All disposable resources are removed. See
`artifacts/citadel-native-partial-acceptance.json`,
`artifacts/citadel-reload-live-root-review.json` and
`artifacts/citadel-disposable-cleanup-live-root-review.json`.

America's Army: Proving Grounds has native Linux startup, local A2S query and
normal Stop evidence. The first query exposed a truncated multiword server name;
restoring the original egg's engine value quotes made the exact requested name
appear in A2S. The failed query is retained. The installer now preserves the
observed `AAGame/Config`, `AAGame/Cloud` and `AAGame/Logs` directories alongside
the legacy paths. Reinstall retained all 45 captured files exactly, and a later
reinstall retained the expanded 49-file baseline. Three native runs stopped
with exit 0 and no OOM. The configured authentication port had no observed
listener; the bundled TeamSpeak listener on 8765 was not forwarded. Online
authentication, client gameplay, public listing and embedded quote/backslash
name encoding remain unverified. See
`artifacts/aapg-reinstall-retention-live-root-review.json`,
`artifacts/aapg-third-native-live-root-review.json` and
`artifacts/aapg-name-source-integration.json`. The disposable server, exclusive
egg/nest, allocations, containers and volume are removed; its lease is released.
Cleanup was independently checked in
`artifacts/aapg-disposable-cleanup-live-root-review.json`.

Nightingale now checks existing settings before Steam updates and validates the
downloaded publisher example before copying it. The preflight uses the same INI
parser as startup, including duplicate managed section/key rejection, without
writing settings or disclosing their values. This is source/fixture validation;
the current publisher example and native behavior remain unverified. Public
metadata reports an 11.13 GB Linux payload. A conservative two-payload staging
estimate exceeds the current 16 GiB disk default, so native acceptance still
needs a reviewed storage plan. See
`artifacts/nightingale-readiness-root-integration.json` and
`artifacts/nightingale-public-metadata-root-review.json`.

Open Fortress validates its pinned archive, safe member listing and gameinfo
mount layout before updating Steam content. Full extraction now follows the
updates and fresh archive validation, reducing overlapping staging space.
This preserves the early validation gate; it does not guarantee a fixed bound
on Steam's internal temporary storage. The disposable reinstall therefore
monitors both its volume and installer writable layer. See
`artifacts/openfortress-stage-headroom-root-integration.json`.

Plains of Pain is partially verified after the user's explicit approval of the
packaged March 3, 2026 agreement. The default agreement control remains off.
Native readiness, normal Stop with exit 0, reinstall retention and selection of
the existing world on reload passed. The installer now retains the observed
`.config/unity3d/CobraByteDigital/PlainsOfPain` save directory alongside legacy
locations. All 15 natural state/config/log files retained their bytes, modes and
ownership through reinstall; modification times changed. Reload updated native
runtime state normally. Headless audio warnings remain, and query responses,
player joins and gameplay were not tested. The first collector-path error is
retained separately from the successful native run. Disposable resources are
removed; private archives and the approved terms are retained. See
`artifacts/plains-approved-native-acceptance.json`,
`artifacts/plains-reload-native-live-root-review.json` and
`artifacts/plains-approved-cleanup-live-root-review.json`.

Operation: Harsh Doorstop is partially verified on native Linux. Normal API
installation and reinstall retained native configuration, permissions and
ownership. Explicit stdout logging and flushing expose live game initialization;
the Panel startup rule now uses the actual map's WaitingToStart message instead
of an RCON category that remained buffered until shutdown. Live Panel readiness
stayed running for 34 seconds before normal Stop, exit 130 without OOM.
Publisher session-update warnings remain. Authenticated RCON, query responses,
public listing and player gameplay are unverified. See
`artifacts/ohd-readiness-native-stopped-handoff.json` and
`artifacts/ohd-readiness-boot-live-root-review.json`. Its disposable server,
containers, volume, allocations and exclusive egg/nest are removed; configs and
logs are archived privately. Cleanup was independently verified in
`artifacts/ohd-disposable-cleanup-live-root-review.json`.

Each new native acceptance must retain the exact helper files and staged egg,
not only their hashes. Capture installed helper bytes before the first controlled
boot and after reinstall, and compare them to that immutable source snapshot.
Keep failed attempts and later source changes separate. A historical process
test does not verify a newer helper merely because its intended behavior matches.

Dedicated Minecraft modpack eggs have been removed at the user's request.
CurseForge and Modrinth packs use the existing Minecraft content managers.
Custom server implementations and patched versions remain in the setup catalog.
Catalog refresh excludes the CurseForge, Modrinth, FTB and Technic egg directories.
See `artifacts/minecraft-modpack-eggs-removal.json` for the thirteen removed
definitions and the read-only live database inventory, which found no such eggs.

Trackmania2020 passed native LAN hosting on the bundled Training01 map,
authenticated loopback XML-RPC, settings changes, exact four-file reinstall
preservation and three clean native stops. Internet-account authentication and
player joins were not tested. Source-only path-confinement hardening has its own
fixtures and provenance, separate from the historical native helper hash. See
`artifacts/trackmania-root-review.json`.

Private SteamCMD credentials remain disabled. A password-prompt transport has
process fixtures and a native prompt-only observation, but no real password,
Steam Guard or private-beta authentication proof. It is not enabled by those
tests. See `tools/runtime/steam-private-fd-transport.md`.

StarMade 0.305.11 uses the shared template form, a SHA-256-pinned publisher
archive and Temurin 21. The current publisher StarLoader requires a Java agent
and two module-opening flags; the launcher detects that manifest automatically.
Older Java 8/16 eggs cannot run its class-major-65 entry point. The original
custom jar option remains available, with plain launch for non-StarLoader jars.

Fresh final-source acceptance confirmed a custom native name, six slots, native
console save, graceful Stop and a real NPC faction value restored after reload.
Same-release reinstall preserved all 746 selected world/configuration/helper
files, including modes and owners. Earlier Java-version, launcher and metadata
ownership failures remain separate development evidence. No player joined;
authentication, gameplay, third-party mods and public listing remain untested.
The status protocol has no password flag. Native server.cfg must not contain
blank lines: its parser stops before applying settings when it encounters one.
All owned test resources were removed. See artifacts/starmade-live-acceptance.json
and artifacts/starmade-cleanup.json.

Necesse uses the shared template form, typed Steam helper and the publisher's
bundled Java runtime. All original settings remain available; a pause-empty-world
toggle is added. Save names, slots and passwords are passed as literal native
arguments. Java heap sizing leaves room for native libraries and the supervisor.
Keep the save name unchanged to resume saves/worlds/<name>.zip. Back up saves/,
cfg/ and mods/ before updates; an existing cfg/server.cfg survives reinstall,
including a failed Steam validation.

Necesse 1.3.3 server build 24926481 passed a fresh native Linux installation,
console save, graceful Stop, same-build reinstall and reload of the same native
world ID. All seven selected files survived reinstall. A protocol query from
the main PC confirmed six slots and the password flag changing from false to
true; no player joined or completed a password exchange. Internet listing,
third-party mods and authenticated beta branches remain untested. See
artifacts/necesse-live-acceptance.json and artifacts/necesse-cleanup.json.
The isolated server, installer, volume and allocation were removed.

Counter-Strike: Source uses the shared template form, typed Steam installer and
native console supervisor with a controlling terminal. LAN acceptance covered
build 25338297, native console status, a stock-copy custom map, VScript loading,
operator configuration, password-query flags and authenticated RCON. Same-build
reinstall preserved all 25 selected files; restored hosting and graceful shutdown
passed. No player join, Internet GSLT or third-party plugin acceptance is claimed.
See artifacts/css-live-acceptance.json and artifacts/css-cleanup.json.

Urban Terror and ET: Legacy also use the shared form. Both original 32-bit and
64-bit engines passed native LAN queries, configuration changes, console-written
state restore and graceful shutdown. Reinstall preserved 829 Urban Terror files
and 4,129 ET files. ET's bundled Omni-Bot and WolfAdmin loaded; bot gameplay and
player joins were not tested. All owned acceptance resources were removed. See
artifacts/urbanterror-live-acceptance.json and artifacts/etlegacy-live-acceptance.json.

Parallel acceptance runs on isolated local Linux node 202 with explicit memory,
disk and port leases. Public archives and SteamCMD bootstrap files have a
checksum-addressed cache; each game receives independent writable contents.
Cached downloads do not substitute for native game and persistence testing.
The running Windows dashboard has not been refreshed. Source builds and private
frontend builds include newer setup controls than that running process.

Don't Starve Together uses the shared template form, typed Steam installer and
dual-process native supervisor on Linux x64. Six allocated ports serve Master,
Caves and their separate Steam services. Offline LAN mode requires two gameplay
ports in 10998..11018; the shared form and backend enforce that range only for
offline mode. Online mode requires a real Klei cluster token. Both worlds must
connect and finish native shard initialization before the panel reports ready,
including when pausing empty worlds is disabled. Stop sends c_shutdown() to both
shards; console commands target Master unless prefixed with `Caves> `.

Native saves, world generation overrides, mod overrides and private cluster
configuration persist under DoNotStarveTogether/config/<ID>. Keep the cluster ID
unchanged to resume those worlds. Managed INI edits preserve unknown settings and
comments and receive private backups. Reinstall preserves an operator's existing
mods/dedicated_server_mods_setup.lua, including when Steam validation fails.

Public build 26148034 passed dual-world native save/reload with a local server
mod persistence fixture, both console routes, LAN RakNet replies and graceful
shutdown with exit code 0. A same-build reinstall preserved all 58 selected
files. PAUSE_EMPTY=0 exposed a readiness bug in the first adapter revision;
native acceptance of the corrected installed source is recorded separately in
artifacts/dst-live-acceptance.json. A separate fresh installation of the fixed
source also passed its first native boot with PAUSE_EMPTY=0, both native console
saves, LAN replies and graceful exit 0; see artifacts/dst-fresh-acceptance.json.
Earlier native cave generation retried seeds before succeeding; those warnings
remain in the earlier evidence. The fresh candidate's cave briefly attempted
its shard connection before Master was listening, then connected automatically.
No player joined. Klei online
authentication, public listing, Workshop downloads and client gameplay remain
untested. RakNet replies contained no application metadata, so they do not prove
server-browser name, slots or password behavior.

Owned lifecycle-test resources were removed. The original Wings process and
configuration and the captured pre-final 11-container baseline were preserved;
an earlier container recreation predates this DST workflow and is documented in
artifacts/dst-baseline-drift.json. See artifacts/dst-cleanup.json and
artifacts/dst-fresh-cleanup.json. The running
Windows panel was not restarted. Generate with
`node tools/runtime/sync-dst-profile.mjs`; test adapter fixtures with
`node tools/runtime/test-dst.mjs`.

Unturned uses the shared React template form and typed Steam helper on Linux
x64. The form selects two consecutive ports. LAN is the default; Internet
mode requires a GSLT created for game AppID 304930. All original egg variables
remain available. Server identity directories persist under Servers/<ID>.
Managed Commands.dat fields receive private backups; comments and other native
commands remain editable. The publisher's bundled Rocket module is retained.

Unturned's Mono console requires a controlling terminal on input, output and
error streams. The shared native supervisor supplies this optionally, redacts
credentials, schedules native Save commands after readiness and forwards native
Shutdown on Stop. Other pipe-based game adapters keep their existing transport.

Fresh public build 25613089 acceptance passed native readiness, Rocket loading,
exact-name LAN discovery, eight slots, the password flag changing from false to
true, repeated scheduled saves and graceful shutdown with exit code 0. Same-build
reinstall preserved all 34 checked files, including PEI world data, native account
lists and Rocket configuration. The restored server answered the expected query.
Both development and final instances were removed, with the original Wings
process, configuration and 11-container baseline unchanged. See
artifacts/unturned-live-acceptance.json and artifacts/unturned-cleanup.json.

No player joined. Client password exchange, gameplay, Internet registration,
real GSLT authentication, third-party Workshop downloads and plugins remain
untested. The running Windows panel predates the new update-routing hook, so
native acceptance used AUTO_UPDATE=0. New controls and AUTO_UPDATE=1 routing
await an allowed dashboard refresh. Regenerate the profile with
node tools/runtime/sync-unturned-profile.mjs; run its helper fixtures with
node tools/runtime/test-unturned.mjs.

Project Zomboid now uses the shared template form and typed Steam helper. The
form selects two available ports on the same address, and the backend rejects
missing or mismatched ports before creating a server. Existing save/configuration
prefix, administrator, branch and automatic-update controls remain available.
The new helper owns updates; source-level server configuration disables the
runtime image's older updater and derives the template update flag instead.

The corrected Linux x64 recipe passed a fresh Steam installation and native
startup, LAN query, generated administrator credential/native admin role, native
console save and graceful quit. Existing administrator credentials survived a
different supplied bootstrap password. A local Build 42 server-Lua fixture
saved native global mod data and restored its marker across subsequent starts.
The same-build reinstall preserved all 23 checked files. A separate typed native
Steam update preserved its checked files. Final cleanup removed owned resources
and preserved the original Wings process/configuration/11-container baseline.

Worlds, authentication, native configuration, Lua and mods remain under `.cache`.
Keep SERVER_NAME unchanged to resume that prefix; Public name is separate. The
launcher reuses publisher JVM metadata and bundled Java, replacing heap sizes
without overwriting ProjectZomboid64.json. Acceptance used a 6144 MiB server
allocation with a 4608 MiB heap; Wings supplied a 6451 MiB container limit with
its overhead. The generated credential, managed INI and configuration backups
have private permissions.

Development shutdown failure and cleanup are recorded separately. The fixed
launcher uses raw stdin reads to avoid Python finalization aborts while the
dashboard input pipe remains open. Native startup can exceed the generic
45-second observer window; waits were continued on the same process.

No player join, gameplay, client password exchange, private Steam login,
Workshop downloads or other branches were accepted. Deployed startup-update
routing is still pending the allowed dashboard refresh; native helper update
checks and backend routing tests are distinct evidence. See
`artifacts/project-zomboid-live-acceptance.json`, its cleanup and implementation
review. Generate with `node tools/runtime/sync-project-zomboid-profile.mjs`;
fixtures are `test-steam-template.mjs` and `test-project-zomboid.mjs`.

Xonotic now has a native Linux x64 setup profile using the existing shared React
form. Stable 0.8.6 is the default; autobuild is explicitly selected. Downloads use
HTTPS and publisher SHA-512 checksums. Staged updates retain operator changes,
keep the prior engine tree for recovery, and leave writable `.xonotic/data`
outside the managed engine tree. Publisher source and licenses are retained.
The Linux profile omits the macOS application bundle and its framework links.

The launcher uses native DarkPlaces quoting for names and passwords, preserves
`server.cfg`, and applies form settings afterward. The form controls version,
channel, initial map, mode, player/bot counts, listing and passwords. Native
console input remains available; Stop sends `quit`. Generated RCON credentials
and the managed config use private permissions. Secure challenge RCON is enabled.
Other configuration and custom packages remain editable in Files and Console.

Eight Linux fixtures and database-backed profile validation pass. Real stable
0.8.6 acceptance verified deathmatch/team deathmatch, a custom PK3 map and
waypoints, two bots, literal quoted names, secure RCON rejection/acceptance,
operator limits, native database restore, graceful quit and 23-file preservation
across reinstall. The final server, container, volume, allocation, egg and nest
were removed; the original Wings process/configuration/11-container baseline
remained unchanged. See `artifacts/xonotic-live-acceptance.json` and cleanup.

Development failures on macOS links and direct map startup are recorded
separately. The corrected installer passed a fresh install and initial launch;
later validation maintenance preceded the final unchanged-source preservation
check. No player join, gameplay, client password exchange, public listing,
signed online identity, other releases or autobuild runtime was accepted.
DarkPlaces replies do not expose a join-password flag, so the query helper
reports unknown. Server-info names reject backslashes; RCON accepts one password
without spaces. Older releases without SHA-512 feeds remain outside this
managed installer. The dashboard refresh is still pending. Regenerate with
`node tools/runtime/sync-xonotic-profile.mjs` and run fixtures with
`node tools/runtime/test-xonotic.mjs`.

OpenArena 0.8.8 now uses checked HTTPS ZIP staging with the unmodified native
Linux engine. The shared form retains the original map field and adds native
name, mode, player/bot counts, game folder, listing and password settings. Local
UDP readiness works for private servers without a master heartbeat. Linux x64
acceptance verified GameDig status, two native bots, console configuration
save/restore, a custom PK3 containing BSP/navigation data, native RCON rejection
and acceptance, private mode and the join-password flag. All 13 protected files
survived reinstall. Native quit exited 0, and cleanup preserved the original
Wings process/configuration and 11 containers. Player joins, graphical gameplay,
missionpack, other modes and package-download behavior remain unverified. See
`artifacts/openarena-live-acceptance.json`.

DDNet 20.1.1 now uses publisher-checked native downloads through a reusable staged
release installer. Steam credentials are optional legacy fields, and the
original name/map/password/listing/player/update controls remain. Pinned and
latest version selection, native 0.7 support, RCON and explicit test-command
control use the shared form. Dashboard commands use DDNet's private native FIFO.
Linux x64 checks covered native capacity 96, compatible 0.7 headless movement,
RCON, custom maps in both formats, password rejection/acceptance, a seeded SQLite
rank read through native `/rank`, demo recording and native shutdown. Reinstall
preserved all 14 protected files. Startup maintenance on/off worked. SQLite
integrity and the native demo header passed, and cleanup preserved the original
Wings process/configuration and 11 containers. A compatible 0.7 client sees a
mapped 64-slot view. No 96-player load test, race completion, graphical gameplay,
native 0.6 client or other release was verified. See
`artifacts/ddnet-live-acceptance.json`.

Teeworlds 0.7.5 now builds a pinned native engine with a marked stdin console
adapter. The shared form retains name and MotD and adds map, mode, player limit,
private/public listing and native passwords. Private readiness no longer depends
on a master-server heartbeat. Native RCON and external-console support remain.
Linux x64 acceptance verified quoted text, console map switching, password
rejection/acceptance and headless player movement with 100 snapshots on both an
uploaded custom map and stock dm2. Native RCON read back an operator setting.
All 12 protected files survived reinstall, including configuration, storage,
generated RCON credentials, custom map and a native demo recording. Stop exited
0 and temporary resources were removed without changing the original 11
containers or Wings configuration/process. Graphical gameplay, map download,
other modes and public listing remain unverified. See
`artifacts/teeworlds-live-acceptance.json` and `tools/teeworlds-client/README.md`.

Vintage Story 1.22.7 now uses a pinned .NET 10 runtime and stages engine downloads
separately from persistent data. Its first Linux x64 install/start passed, and
reinstall preserved all 12 protected files. Native console checks confirmed the
17-player limit, saved world setting, content mod load and graceful shutdown.
Literal server settings and mod configuration survived. Authenticated player
joins, gameplay, other releases and older runtimes remain unverified. New servers
use the game's private, whitelisted defaults. See
`artifacts/vintage-story-live-acceptance.json`. Temporary acceptance resources
were removed; the original Wings process, configuration and 11 containers were
unchanged.

Veloren weekly c5024ebf now has Linux x64 server acceptance: native startup and
UDP query, a literal display name, player limit, isolated rejection of invalid
native settings, preserved operator PvE settings, graceful stop and all 19
protected files unchanged across reinstall. Simulation data, administrator
records and asset overrides were included. Official-auth startup and an explicit
private offline administrator fixture were tested; authenticated player joins,
gameplay, ARM64 and nightly remain unverified. See
`artifacts/veloren-live-acceptance.json` and `artifacts/veloren-cleanup.json`.
Temporary acceptance resources were removed and the original 11 containers and
Wings configuration were preserved. The dashboard refresh remains pending.

The Game Library ships 240 setup recipes from the pinned Pterodactyl game-eggs catalog at c637a6d1e0449b167efeff81bb9a0177aa3df6c2, excluding thirteen dedicated Minecraft modpack eggs and NWN, which the user cancelled. Custom server variants remain. Recipe counts are not a count of distinct playable games.

All recipes use one React setup form for name, node, memory, storage, runtime, allocations and egg-defined variables. Search and category filters work on the complete catalog. Recipes are local embedded data; setup does not fetch executable definitions from a moving GitHub branch. Recipe imports retain their upstream installation, startup and configuration unless a reviewed override is present. A changed executable recipe hash gets a distinct egg identity and never replaces existing operator edits. Review status, notes and setup instructions do not change that identity.

Minecraft retains its loader, modpack and Java setup. Managed Steam profiles share the same setup screen and app-owned install/update/verify controls. Satisfactory and Palworld retain their existing support; Valheim adds password rules, consecutive UDP allocation selection, a private server default, a fixed launcher that reads values as data, and settings/world paths under .voltra and saves. Valheim currently uses Steam networking. Crossplay is available in the community recipe but is not enabled in the managed profile.

A SteamCMD download engine is reusable, but launch images, runtime libraries, credentials, save preservation, ports and gameplay settings remain game-specific. Community Steam eggs retain their own upstream update mechanism until a reviewed managed profile replaces it. Do not claim generic app-owned Steam maintenance for those recipes.

## Verification levels

- Every recipe passes import schema validation and PostgreSQL import/export tests without losing startup or variables.
- Provisioning tests cover a real PostgreSQL schema and fake Wings, input validation, idempotent retries, conflicting request bodies and administrator permissions.
- Managed Valheim tests cover consecutive allocations, settings initialization/preservation, unsafe world names, shell-like text treated as data and configuration retention during Steam maintenance.
- These checks do not prove installation, runtime or client gameplay for every game. The per-recipe checklist explicitly keeps runtime_verified false until live acceptance is recorded.

Checklist: artifacts/game-setup-checklist.json. Schema status and runtime status are separate; reviewed profiles include their recorded runtime detail. Managed Steam coverage is recorded separately in artifacts/game-setup-runtime.json. Generate the checklist with GAME_CATALOG_REPORT set to the desired absolute path while running TestGameTemplateCatalogCompatibility. Live tests must use owned temporary game resources, preserve the host's existing Pterodactyl services, and distinguish process readiness from a real client join.

## API

GET /api/client/game-library/templates returns the entire pinned catalog with stable recipe IDs and source links.
GET /api/client/game-library/templates/{template} returns administrator-only settings, images and available ports.
POST /api/client/game-library/templates/{template}/install accepts name, request_id, memory and disk in MiB, a listed image, allocation_id, allocation_additional and environment. It reuses the existing egg validation, server lifecycle and Wings installation pipeline. Servers remain stopped after install so operators can inspect requirements before first start.
GET /api/client/game-library/steam returns managed game profiles used to render Steam tiles and setup guidance.

The existing shared controls in lib.tsx remain the styling foundation. GameSetupFields adds name, node and memory controls reused by Minecraft, managed Steam and the community flow. TemplateGames is one catalog and one form for every community recipe; no per-game React pages are required.

## First live game completed

Managed Valheim build 25909431 completed its first Steam install on temporary Linux node 147. The initial launch exposed a TERM/INT forwarding bug in the stock image. The managed startup now installs the forwarding trap in the image's PID 1 shell. After that fix, the real server stopped gracefully, saved its current chunked world format, restarted to Game server connected, preserved the world metadata hash, and accepted Quick setup reads/writes. No player-client join was tested. The acceptance server, its volume and its two allocations were removed. The original 11 containers, Wings PID and Pterodactyl configuration hash were unchanged.

Evidence: artifacts/valheim-live-acceptance.json, artifacts/valheim-launcher-check.json, artifacts/game-setup-cleanup.json.

The goal remains active. All community recipes have a setup path and import coverage; individual runtime review and further managed profiles are not complete. OpenTTD now has a reviewed data-only override using OpenTTD 15.3 and OpenGFX 8.0, verified official download checksums, a local starter configuration, current visibility settings, and automatic saved-game reload. Live acceptance proved installation, a saved map, reload through the real game process's -g argument, UDP discovery, TCP game-info with the expected name, corrected Ready markers and graceful stop. No player-client gameplay was tested. Its acceptance server, volume and allocation were removed.

Reviewed overrides are in internal/panel/game_library/overrides.json. Each override is bound to the upstream recipe checksum; an upstream update requires reviewing the override instead of silently replacing it. All overrides use the existing community setup form. Catalog refresh tool: node tools/game-library/update-catalog.mjs <reviewed-commit-sha>.

## Managed 7 Days to Die

The next managed Steam profile is 7 Days to Die, app 294420. It uses the shared install/update/verify engine, four consecutive game allocations and the standard React setup form. Its serverconfig.xml editor changes only allowlisted property attributes and preserves comments, ordering, unknown properties and XML escaping. Saves use /home/container/saves. The root serverconfig.xml and save settings are preserved during Steam validation. The console bridge connects only to the container-local administration port and waits for the game to finish saving after shutdown.

Setup options now explain missing consecutive ports or memory before provisioning. Memory controls respect the node's currently allocatable budget. Node advertisements identify supported Steam app profiles, so an older connector cannot silently accept a new game's unsupported maintenance job. Upgrade the node connector for new managed game profiles; original Satisfactory/Palworld compatibility remains available on legacy steam-v1 nodes.

Focused database tests cover initialization, preservation and native XML edits. Live acceptance installed build 25661908 on the owned temporary Linux node, reached game readiness, executed console commands, saved and stopped normally, then completed Steam verification. Verification preserved the configuration and both saved-world files byte-for-byte. Restart loaded the world, retained the edited name/day length and stopped normally again. Administration listened only on container loopback. No player-client join was tested, and A2S queries received no response. Nonfatal user-name and EOS credential warnings remain in the generic image's logs. The test server, volume and four ports were removed; the original host's containers, Wings PID and configuration hash were unchanged.

Evidence: artifacts/sevendays-live-acceptance.json and artifacts/sevendays-cleanup.json.

The later imported-control bridge acceptance is recorded separately in
`artifacts/managed-steam-seven-days-integrated.json`, with root review in
`artifacts/managed-steam-seven-days-root-review.json`. It exercised all nine
imported controls in the public/default branch scope, including a 1024-byte
UTF-8 console password, wrong-password rejection, and a cleared-password reset.
The bundled console client uses the reviewed gorcon fork and stays inside the
game container. A real restart restored Day 1, 12:00; Steam verification retained
80 files with identical bytes, ownership and permissions. All isolated resources
were removed. Alternate branches, private Steam accounts and player gameplay
remain untested. This managed bridge is separate from the recipe-override count.

## Reviewed Terraria Vanilla

Terraria uses the existing community setup form. Its reviewed profile pins the official PC dedicated server 1.4.5.8 archive and SHA-256, replacing wiki scraping and unpinned downloads. Installation stages the binaries before copying them, creates configuration only when absent, and preserves existing configuration and worlds on reinstall. Startup disables UPnP and reads passwords from the configuration rather than command arguments. World files stay under saves/Worlds. World names reject path traversal; password, message and seed fields reject embedded line breaks.

The default creates a small Classic world. World size, difficulty and seed affect world creation; change the world name to create another world without deleting the old one. A normal Stop uses the game's exit command to save. Players must run the matching PC game version. Modded Terraria variants remain separate catalog recipes and need their own runtime acceptance.

Live checks passed the first installation, world generation, console save, graceful stop, LAN password rejection/acceptance and reinstall preservation of the world/configuration hashes. The restart loaded that saved world, but a later network disconnect crashed the official Linux server with ObjectDisposedException in DebugNetworkStream/NetworkStream. Runtime acceptance therefore remains failed, and the catalog displays the observed issue. Do not count process readiness or the earlier successful handshake as reliable support. No player was spawned. The test server, volume and allocation were removed after evidence collection.

Evidence: artifacts/terraria-live-acceptance.json and artifacts/terraria-cleanup.json. The next Terraria investigation should evaluate the maintained TShock/OTAPI implementation separately, without silently replacing the vanilla recipe or claiming it fixes this failure before testing it.

## Reviewed TShock

The modern TShock recipe now pins TShock 6.2.1 for Terraria PC 1.4.5.8 and uses a .NET 9 Wings image, matching the release's runtime requirement. Its installer verifies the publisher's SHA-256 for Linux x64 or ARM64, extracts the nested archive in a staging directory, and preserves operator data. Worlds are in saves/Worlds, accounts and configuration in tshock, and logs in logs. Join passwords use the native JSON configuration rather than startup command arguments. REST administration starts disabled. Legacy TShock remains a separate recipe.

The same React form exposes server name, join password, player limit and world creation options. A data-defined After installation list explains first start, joining, administrator creation through Console, and persistence. Numeric between rules now set browser bounds in this shared form; backend validation remains authoritative. Recipe authors can add setup steps without creating another game-specific page.

On temporary Linux x64 node 147, live acceptance passed the first installation, world generation, join-password rejection/acceptance, world-data response, normal saves/stops and saved-world restart. Reinstallation preserved serverconfig.txt, tshock/config.json, tshock/tshock.sqlite and the world file byte-for-byte. A created administrator account survived reinstall/restart; explicit account-password mode rejected a wrong password and accepted the correct one. That account check disabled UUID login only on the disposable test server. The recipe retains native TShock account-mode defaults. An operator-edited backup interval also survived restart. The process stayed running after disconnect probes that had crashed the separate vanilla build. No player was spawned or gameplay tested. ARM64 archive selection is implemented but has no hardware acceptance yet.

Evidence: artifacts/tshock-live-acceptance.json and artifacts/tshock-cleanup.json. The acceptance server, volume and allocation were removed. The original host's 11 containers, Wings process and configuration hash were unchanged.

## Reviewed legacy TShock

Legacy TShock remains on 4.5.18 for Terraria PC 1.4.3.6 and uses the Mono image. Its installer now pins the official archive and a reviewed SHA-256 instead of selecting unrelated latest assets or silently falling back to another release. It shares modern TShock's form controls, native settings mapping, save/account paths and post-install instructions. The older client requirement is shown in the version field and setup instructions.

Live Linux x64 checks passed the first installation, world creation, normal saves/stops and saved-world restart. Reinstall preserved the world, configuration and account database byte-for-byte. Both join-password and explicit account-password checks rejected the wrong password, accepted the correct one and received world data using protocol release 248 from the installed assembly. The account test changed UUID login mode only on the disposable server and applied it through native reload. An operator-edited backup interval and the test administrator survived reinstall/restart. No player was spawned and gameplay remains untested.

Evidence: artifacts/tshock-legacy-live-acceptance.json and artifacts/tshock-legacy-cleanup.json. The owned server, volume, container and allocation were removed. The original 11 running containers, Wings PID and configuration hash were unchanged. Cleanup checks now also confirm the acceptance container is absent, including stopped containers.

## Reviewed tModLoader

tModLoader now pins stable v2026.08.3.0 on the Terraria 1.4.4 branch and uses the release's .NET 8 runtime. The installer verifies the official archive checksum, stages extraction, excludes its sample serverconfig.txt before copying binaries, and keeps existing operator data. Startup uses fixed native-library and save/mod paths, with passwords and MOTD read from configuration rather than shell arguments. The original password, MOTD and world-name size limits remain. GitHub credential fields remain compatible with imported settings but are not required by the pinned direct download.

The same community form provides world settings and post-install instructions. Upload .tmod files to mods and list their internal names in mods/enabled.json. Saves and mod configuration are under saves; keep each world's .wld and .twld files together. Installation initially enables no optional mods. Connections use the game address directly, with a matching tModLoader client and compatible mod versions.

Linux x64 acceptance loaded the matching official ExampleMod, generated a modded world and reached readiness. The mod upload used the panel's tus API, paused at 4 MiB, resumed from that offset, and matched SHA-256 through a streamed verification download. Reinstall preserved six files byte-for-byte: serverconfig.txt, enabled.json, the mod binary, .wld, .twld and a custom mod configuration. Restart loaded the modded world and applied the edited ExampleMod setting. A separate fresh world with an empty enabled-mod set also reached readiness and stopped normally. LAN probes rejected a wrong password, accepted the correct one, and returned the expected mod-sync headers for both cases.

No player was spawned or gameplay tested. The probes stop at server mod-sync headers; full client mod download/join, Steam networking and Workshop downloads remain untested. Other mods have not received this acceptance. The owned test container, volume, server and port were removed; the original running containers and Wings baseline were unchanged.

Evidence: artifacts/tmodloader-live-acceptance.json and artifacts/tmodloader-cleanup.json. tools/runtime/upload-game-mod.mjs exercises the same upload API used by the browser with bounded chunks, durable transfer receipts and streamed hash verification.

## Reviewed Factorio

The vanilla Linux x64 recipe pins Factorio 2.0.77 and verifies the headless archive and portable jq helper by SHA-256. It starts privately with base enabled and DLC disabled. A shared form exposes visibility, optional public-listing credentials, a join password and save options. Conditional required fields now respond to the selected environment mode across all recipes. The launcher renders JSON with literal strings, preserving numeric-looking passwords, and creates a missing save only at runtime.

Live checks passed the first installation, map generation, console state mutation, normal save/stop, saved restart and reinstall. All six checked save/settings/mod-list/config files survived reinstall byte-for-byte, including an operator-edited settings file. The native storage marker survived the subsequent restart. No player joined, gameplay or public authentication was tested. Physical LAN discovery, DLC/mods, ARM64, ModUpdate and Clusterio are not covered by this acceptance. The disposable server and allocation were removed.

Evidence: artifacts/factorio-live-acceptance.json and artifacts/factorio-cleanup.json.

## Factorio ModUpdate and shared failure recovery

The ModUpdate recipe reuses vanilla Factorio 2.0.77 installation, private defaults, typed settings and the same React form. Its updater adapts the MIT-licensed factoriotools script at revision a2ea39d069563c3c61c837889e7e569fb95486ef. It updates enabled portal mods and required dependencies in a staging directory, validates SHA-1 release digests, honors pinned mod names, checks game branches and dependency conflicts, and retains the previous mod set under .voltra/mod-backups only after a complete successful update. Credentials are URL-encoded from the environment and supplied to curl through stdin. Failed authentication, downloads or checksums leave the installed set intact. Custom/private mods can be excluded with Skip mod updates. Version-conflicting dependency sets fail explicitly; the updater is not a full constraint-solving package manager.

Seventeen Linux fixture tests cover successful staged replacement and dependency installation, optional/builtin dependencies, old/future game branches, pinned mods, conflicts, unavailable metadata, unsafe filenames, missing credentials, failed authentication and bad hashes. Run python3 tools/runtime/test-factorio-updater.py internal/panel/game_library/scripts/factorio-update-mods.sh on Linux with bash, jq and coreutils. These fixtures do not prove successful authenticated mod-portal downloads. Use node tools/runtime/sync-factorio-updater.mjs after editing the helper; a Go test checks that the embedded installer matches its audited source.

The temporary Linux node passed first installation with the base mod set, native startup, console mutation, normal saves/stops, six-file reinstall preservation and saved-state restart. A real public mod metadata lookup followed by a missing-credentials failure preserved all six checked save/configuration files. After restoring the original mod list, client reinstall recovered and preserved those files. No player joined; portal-authenticated downloads, actual modded gameplay and DLC were not tested. The catalog reports runtime_partial rather than full verification.

This test exposed Wings v1.13.3 ignoring Docker installer exit codes. tools/wings contains a pinned-source patch, helper, focused Linux tests, license and build instructions. The temporary node now uses its own patched binary; the original host Wings service remains unchanged. With the patch, the actual failed installer reports reinstall_failed. Existing external Wings installations need this fix separately; deployment/distribution of a patched Wings build remains rollout work.

The client reinstall endpoint now accepts reinstall_failed while preserving permission checks and atomic operation guards. If the daemon rejects retry, the previous failure state, installation identifier and timestamp are restored. Shared server screens label the failure and explain recovery under Settings. No game-specific React page was added.

Evidence: artifacts/factorio-modupdate-live-acceptance.json, artifacts/factorio-modupdate-cleanup.json, artifacts/factorio-modupdate-setup-ui.json and artifacts/game-reinstall-recovery-ui.json. Clusterio and the ARM64/Box64 recipe still require their own review and acceptance.

## Reviewed Clusterio

Clusterio 2.0.2 now uses Node.js 24 and the same data-driven React template form. The controller role requires an initial administrator name. The host role requires its name, the controller address and a controller-issued host token; the setup form masks that token. The removed upstream installer flag and unsupported Node 18-21 images are replaced by pinned core npm packages and native configuration/bootstrap commands. Reinstall reuses package-lock.json and preserves operator accounts and data. Optional npm plugins remain available through the Plugins setting, with package-name validation and exact-version support. Removing a name from that field does not uninstall an existing plugin.

New controllers get Base Game 2.0 as their default mod pack. A small launcher adapts the pinned release's exported InstanceManager class so new instances start privately and resolve the native latest default to reviewed Factorio 2.0.77. Existing instances, explicit versions and operator controller choices are preserved. This fixes observed behavior in which new instance creation downloaded experimental Factorio 2.1.23 despite the installed reviewed build. Upstream package files are not modified. Controller login access is saved privately to .voltra/admin-token.txt; it is not printed in installation output or passed in startup arguments.

The shared Wings configuration now includes VOLTRA_ALLOCATED_PORTS, derived from the server's real allocations on its primary IP after applying egg variables. A submitted environment cannot override it. Clusterio hosts use that pool for game instances. This is reusable by other games that manage multiple listeners. The launcher places its child in a separate process session and forwards one shutdown signal, fixing duplicate Ctrl-C delivery observed during acceptance. Unchanged managed settings leave configuration bytes intact.

Live Linux x64 checks covered fresh controller/host installs, the LAN web interface, administrator access, authenticated host registration, private instance defaults and correct Factorio 2.0.77 selection. Two native instances ran simultaneously on allocated UDP ports 23561 and 23562. Normal Wings Stop saved both worlds and exited the host and controller with code 0. Reinstall preserved all 21 checked files byte-for-byte, including account/token data, configuration, the npm lock, both worlds and instance metadata. Restart retained a custom controller autosave interval and the old administrator/host credentials. RCON read back the saved native storage marker after reloading the world. The checked live launch helpers match the embedded reviewed source.

No player joined and gameplay was not tested. Optional plugins, HTTPS, public-listing credentials and other game versions were not exercised. The initial version-selection and duplicate-signal issues were found during implementation and corrected before the final persistence checks; do not describe the whole development run as a single clean acceptance attempt. The disposable servers, volumes and ports were removed, and the original Wings/configuration/11-container baseline remained unchanged.

Evidence: artifacts/clusterio-live-acceptance.json, artifacts/clusterio-setup-ui.json, artifacts/clusterio-controller-cleanup.json and artifacts/clusterio-host-cleanup.json. Node configuration tests are in tools/runtime/clusterio-config.test.mjs; Go tests cover role validation, installer/source consistency and authoritative port selection. The ARM64/Box64 Factorio recipe remains unverified.

## Reviewed ARM64 Factorio profile and platform requirements

The ARM64 recipe now reuses the reviewed vanilla Factorio 2.0.77 installer, private defaults, literal JSON settings and save/mod preservation. It downloads the native ARM64 jq asset with its pinned SHA-256 and runs the game explicitly through Box64. The ARM64-only Box64 image is pinned to manifest sha256:518a73019ea5238a5cccdfc494ed4b30c4a08c6a0dbfe5b3584c6817fcde093c. Existing imported Box64 tuning variables are retained. Both installation and runtime reject a non-ARM64 machine; runtime also requires the Box64 executable. No host binfmt, QEMU or emulator registration is installed.

Reviewed recipes can now declare platform requirements. The shared setup form displays the requirement and lists only matching online nodes, using authenticated Wings system information with bounded parallel probes. The install endpoint repeats the authoritative check before importing the egg or creating a server. Unknown platforms fail that check. Recipes without platform requirements retain their previous behavior.

DB-backed fixtures verified ARM64 aliases, accepted matching-platform provisioning, rejected x64 provisioning, zero allocation/server/egg side effects on rejection, and unchanged behavior for unconstrained recipes. They also validate the reused Factorio settings. On the real x64 temporary node, the ARM64 form hid that node and disabled creation; a manually submitted install returned 422, and the temporary test allocation remained unused and was removed. The original service/configuration/11-container baseline was preserved.

There is no ARM64 hardware available in this acceptance environment. These checks do not prove Box64 execution, game saves, shutdown or performance on ARM64. The recipe remains not_verified and the runtime checklist records hardware_required. Continue Linux x64 catalog work while that specific acceptance remains pending.

Evidence: artifacts/factorio-arm64-platform-acceptance.json, artifacts/factorio-arm64-setup-ui.json and artifacts/factorio-arm64-host-baseline.json. Regenerate the profile with node tools/runtime/sync-factorio-arm64-profile.mjs after changing the vanilla Factorio setup.

## Reviewed Mindustry

Mindustry v160.7 now uses Java 21 and a checksum-verified server download. The original Java 11 runtime cannot run this release. A separate GPLv3 Java launcher applies names and descriptions through native settings APIs, avoiding the server's comma-separated startup command parser. The same shared React template form exposes game mode, save name, player limit, autosave interval and pause-when-empty settings. Existing native console commands remain available.

The selected persistent save resumes on startup. A missing save creates a world from the chosen installed map and mode. Periodic saves update that file alongside native rotating autosaves. Normal Wings Stop and the native exit/stop commands save before stopping; a failed save leaves the server open for recovery. Native save backups are used when the primary is unavailable. Reinstall preserves the config directory, including worlds, maps, mods, bans and administrator data. Back up this directory before changing game builds or mods. Forced termination cannot guarantee a final save.

Live Linux x64 Java 21 acceptance passed first installation, TCP/UDP listeners and native LAN discovery. Discovery preserved a server name containing a comma and dollar sign. A console world marker and wave 7 survived graceful shutdown, reinstall and reload, as did a native IP ban. Reinstall preserved all six checked files byte-for-byte. Periodic persistent saves were observed. With the primary save moved aside while offline, startup recovered the native backup and retained the world marker and wave. Final normal Stop exited with code 0.

No player joined; gameplay, client synchronization, third-party mods, custom maps, public listing and other builds remain untested. Evidence is in artifacts/mindustry-live-acceptance.json, artifacts/mindustry-setup-ui.json and artifacts/mindustry-cleanup.json. Regenerate the profile with node tools/runtime/sync-mindustry-profile.mjs. The Java source and its full GPLv3 license are included under internal/panel/game_library/scripts.

## Reviewed Luanti

The Minetest catalog recipe now builds checksum-pinned Luanti 5.17.0 headless source. The pinned runtime image provides Linux x64 libraries; its original game executable is 5.16.1 and is not used to host this recipe. JsonCpp is supplied beside the new engine with its package license notice. The engine source and its license files remain installed. First installation compiles the engine with two workers. Reinstall can reuse a build only when its source checksum, console-adapter build ID and version match.

Game downloads use ContentDB's JSON package/release API and staged ZIP extraction. The default Minetest Game release 38214 is checksum-pinned; custom package release IDs and the newest compatible release are supported. Existing game directories are retained without downloading or overwriting them. Manual-upload mode creates the game folders and allows uploading game.conf and the rest of a game through Files before startup. World folders, account databases, mods, game modifications and unrelated native configuration are preserved. Literal settings reject newlines, surrounding whitespace and native object delimiters; nested operator groups and multiline values remain intact.

The shared React template form supplies masked passwords, conditional package fields, enums and numeric bounds. No separate Luanti screen was added. An optional native Lua bootstrap creates only an absent administrator account. The initial administrator password is separate from the default password for new players. Leaving it blank generates a password stored with mode 0600 in .minetest/worlds/WORLD_NAME/voltra-admin-password-NAME.json. Existing accounts are never reset. Custom authentication providers can disable bootstrap. Back up those private credential files with the world.

The engine has an optional plain-text console adapter for the web dashboard. It forwards line input to the native command queue and prints native replies without the ncurses screen redrawing or suppressing stdout logs. The original ncurses mode remains available when that environment option is absent. Normal Stop sends native SIGINT, saves and leaves the server offline. A Console /shutdown exits the game but can trigger Wings automatic restart, so it is not a substitute for Stop.

Development testing found and fixed a missing JsonCpp runtime dependency, initial administrator provisioning and unreliable ncurses readiness output. A fixture also attempted authentication record creation too early; it was corrected to run after engine initialization. Native UDP HELLO, world-node/mod-storage/auth-record reload, private generated credentials and normal exit code 0 were observed. Reinstall retained all 16 checked operator files; it rebuilt the engine, so the compiled binary changed. This development sequence included failures and retries and is not a clean acceptance result.

The final patched-console recipe passed a separate fresh installation and first launch. Native UDP HELLO reported protocol 53, administrator creation completed, and /status returned version 5.17.0 over the plain-text console. A native console command preserved punctuation, a dollar sign and Unicode. The generated password file had mode 0600 and matched the native administrator authentication record. Operator nested groups and multiline settings retained their bytes and had the intended native setting values.

The final reinstall reused the compiled engine and preserved all 27 checked files byte-for-byte. Restart restored the world node, mod storage, authentication record and administrator account. Normal Stop exited with code 0. Both development and final acceptance servers, volumes, allocations, eggs and nests were removed; the original Wings process/configuration/11-container baseline remained unchanged.

No player has authenticated or joined; gameplay, custom ContentDB games, external authentication providers, public listing, ARM64 and other builds are not verified. The new catalog form awaits an allowed dashboard refresh. Runtime provisioning used the existing administrator egg/server APIs; shared form controls and catalog validation passed automated tests. Evidence is in artifacts/luanti-live-acceptance.json, artifacts/luanti-cleanup.json, artifacts/luanti-development-acceptance.json and artifacts/luanti-development-cleanup.json. Regenerate with node tools/runtime/sync-luanti-profile.mjs. Run helper fixtures with node tools/runtime/test-luanti.mjs.

### Rising World Java legacy

The shared template form now installs the publisher's Java edition with the
current Steam `java` branch (339010, build7281128). The original `legacy` branch
value remains an alias. This profile uses pinned Temurin8u504 and retains all
original variables. Seven allocations use the shared shifted-block support:
gameplay-1 through gameplay+4, plus a separate RCON port. Native A2S queries
use the primary gameplay port; RCON uses the extra allocated TCP port.

The Python bootstrap preserves the game's library path separately, and the
Java process also searches its installed Steam SDK64. Readiness waits for the
native Steam query bind after successful SteamAPI initialization; the earlier
publisher STARTED line can occur before a fatal Steam initialization failure.

A fresh Linux native install passed status queries with the configured name,
world and six slots. The publisher RCON protocol accepted the configured
password, returned six slots, and rejected a wrong password. Native console
settime17:43/saveall persisted real SQLite world state. Same-build reinstall
preserved both selected DB/config files byte-for-byte with mode and ownership;
the native reload restored that exact seed/time. Both native Stops exited0.
All owned acceptance resources were removed. Evidence:
`artifacts/rising-world-java-live-acceptance.json` and
`artifacts/rising-world-java-cleanup.json`. Earlier branch/library failures
remain separate artifacts. No player join or graphical gameplay was tested.

### Limbo and NanoLimbo

Both standalone recipes reuse the shared template form and managed Java controls
for runtime, heap and JVM options. Current Limbo CI build76 and NanoLimbo1.13.0
are class65 and need Java21. Default official jars are pinned by SHA-256. Original
jar filename, Nano explicit version/custom download and original feature controls
remain available. Native properties/YAML binding selects the allocated port;
installer-time configuration and metadata are retained on reinstall.

NanoLimbo1.13.0 passed a fresh native Linux install, actual Windows-to-Linux
Minecraft status and nonce pong with custom MOTD/six slots, real console
help/conn/mem/version, native Stop0, same-release reinstall and configured reload.
All3selected settings/jar/receipt files retained bytes/mode/UID/GID. The original
Wings YAML startup parser rewrites comments; configured values survived. No real
player login, proxy forwarding or large-load gameplay was tested. Evidence:
`artifacts/nano-limbo-live-acceptance.json` and `artifacts/nano-limbo-cleanup.json`.
All owned Nano resources were removed.

Limbo source/fixtures are implemented, but native acceptance remains unverified:
automatic approval review rejected its owned configuration/snapshot/start sequence
before execution, giving only blocked by policy. No retry or alternative startup
was attempted. Separately authorized cleanup removed its never-started candidate.
See `artifacts/limbo-games-source-fixtures.json` and `artifacts/limbo-cleanup.json`.

### Paper, Folia and Purpur

These recipes reuse managed Java, Minecraft setup/settings, the console and the
existing content browser. Original version, build, custom JAR filename and custom
download controls work; defaults pin official release identities. Installation
retains operator EULA choice, properties, plugins and worlds. Current defaults
prefer Java25, with minimum8 retained for historical/custom releases and explicit
runtime selection. Folia defaults to stable1.21.11 build14, not its newer alpha.
Its Modrinth plugins must declare exact Folia support. CurseForge plugins remain
hidden unless unverified content is explicitly selected and author compatibility
is acknowledged. See `tools/runtime/paper-family.md` for controls and boundaries.

Paper26.3 build214 passed a fresh Linux install, native status/nonce from Windows,
custom MOTD/six slots, actual version/plugins/list/seed/save console commands,
plugin/world persistent-data save and reload, and two graceful Stop0 cycles.
Same-pinned-release reinstall preserved63 files including all saved world data,
configuration, plugin and custom-named JAR bytes/mode/UID/GID. Exact publisher JAR
and installer release receipt SHA256 remained unchanged. Owned resources were
removed. Evidence: `artifacts/paper-live-acceptance.json`, `paper-cleanup.json`.
The first flat-world test fixture omitted generator layers, producing a recorded
warning while startup and persistence succeeded. Shared Mojang bootstrap assets
were warmed with checksum validation. No player login/gameplay was tested.

The live acceptance Panel predates the additive Java `default_major` metadata.
Its owned imported eggs omit only that field and explicitly select the same
Java25 runtime. Source and PostgreSQL-backed API fixtures validate new automatic
selection and Folia content filtering; native acceptance does not claim those
new API/UI paths were deployed.

Folia1.21.11 build14 passed independent fresh native startup, status/nonce,
configured MOTD/six slots and real version/plugins/list/seed console commands.
Its Folia-supported plugin used the real global scheduler, saved a world marker,
and loaded that marker on its second boot after reinstall. All43 protected files
across three worlds, plugin, properties and pinned release retained bytes, mode
and UID/GID. Both native stops exited0; owned resources were removed. Folia does
not implement `save-all flush`; the rejected command is recorded, and persistence
was proven through its native region shutdown and subsequent reload. Publisher
JVM Unsafe deprecation warnings are retained. Evidence:
`artifacts/folia-live-acceptance.json`, `artifacts/folia-cleanup.json`.

Purpur26.3 build2654 also passed independent fresh native installation, real
status/nonce, configured MOTD/six slots, version/plugins/list/seed/save console
commands and real plugin/world marker persistence across pinned reinstall.
All63 protected files retained bytes/mode/UID/GID, with exact publisher JAR and
release receipt SHA256 unchanged. Both graceful native stops exited0. The original
vector incubator JVM flag remains enabled; its publisher JVM warning is recorded.
Owned resources were removed. Evidence: `artifacts/purpur-live-acceptance.json`,
`artifacts/purpur-cleanup.json`. No family test logged in a real game client.

### Fabric, Forge-enhanced, NeoForge, Quilt and Spigot

All five original recipes reuse shared Java, verified Minecraft installation and
content/setup controls. Original aliases, explicit installer/loader versions,
Forge promotion/full-version overrides, NeoForge1.20.1 namespace, custom JAR names
and Spigot custom URL/official local BuildTools route are retained. EULA choice,
operator settings, mods/plugins and worlds survive installation. Verified program
caches speed reinstall; confined disk scratch avoids Wings installer tmpfs limits.
See `tools/runtime/modded-java.md` for controls and test boundaries.

Fabric26.3/loader0.19.5 passed a corrected fresh installation and first native boot,
real server-only mod loading, Windows status/nonce protocol777, configured MOTD/six
slots, native seed/storage/save commands, Stop0, same-release cache-hit reinstall
and reload. Mod boot count advanced1 to2 and world storage517077 survived. All35
selected files retained bytes/mode/UID/GID; the release receipt SHA remained exact.
Owned resources were removed. Earlier never-booted development installers exposed
small `/tmp` capacity and are retained separately, rather than relabeled as final
success. Evidence: `artifacts/fabric-live-acceptance.json`, `fabric-cleanup.json`,
`fabric-development-failures.json` and `fabric-development-cleanup.json`.

Quilt26.3/loader0.30.1 independently passed the same native protocol/mod/world/save/
reinstall/reload cycle and preserved35 files, then cleaned all owned resources.
Its acceptance mod used Quilt's actual Fabric-format compatibility; full QSL or
the complete mapping/mod ecosystem was not tested. Publisher warnings and the
Meta API versus current Maven checksum discrepancies remain explicit. Evidence:
`artifacts/quilt-live-acceptance.json`, `quilt-cleanup.json`, and Quilt installer/
loader publisher-discrepancy artifacts.

Forge26.3/66.1.0 passed native mod/storage/protocol777/config/save, Stop0 twice,
cache-hit reinstall and reload with38 files preserved byte/mode/UID/GID. Its first
test-mod boot failed because the acceptance class used Java's default package;
the packaged real-API fixture then worked without changing recipe/program files.
That retry and nonfatal publisher Netty/LAN/JVM warnings are recorded. Evidence:
`artifacts/forge-live-acceptance.json`, `forge-modern-cleanup.json` and
`forge-acceptance-fixture-retry.json`.

A separate fresh Forge1.16.5/36.2.42 candidate proved Java8, explicit full version
overriding stale MC_VERSION, custom JAR filename, real legacy API mod loading,
protocol754, saved world storage and mod counter across reinstall/reload,24-file
strict preservation and two Stop0 cycles. It reused the lease serially, with no
old-world reuse, and all resources were removed. Evidence:
`artifacts/forge-legacy-live-acceptance.json`, `forge-legacy-cleanup.json`.
The older live API used an explicit direct startup equivalent to new fallback;
new metadata selection and version alias APIs were source/PostgreSQL-tested.

NeoForge and Spigot native acceptance subsequently passed. NeoForge preserved
41 selected files and a real mod/world-storage value through reinstall/reload.
Spigot preserved69 files and a real Bukkit plugin/world-PDC marker. Both used
the actual compatible Java25 runtime and stopped cleanly twice. Spigot's receipt
does not claim a measured cache hit. All owned resources were removed. See
`artifacts/neoforge-live-acceptance.json`, `neoforge-cleanup.json`,
`spigot-live-acceptance.json` and `spigot-cleanup.json`. No family test performed
a player login or gameplay session.

### Arclight, Canvas and SpongeVanilla

These three original recipes reuse managed Java, generic React setup and existing
file/content tools. All original variables remain available; scoped asset
selection and publisher checksums replace destructive shell installers. Source
fixtures cover9 cases, including operator preservation, exact original controls,
strong caches, symlink prevalidation and Sponge filenames without an extension.

Arclight explicit publisher beta1.0.2-SNAPSHOT-494b2c8 on Forge1.21.1 passed
native status767/nonce/MOTD6, actual autoJava21, real Bukkit plugin boots1-to2-to3,
152-file strict reinstall preservation including libraries/world/config/plugins,
measured download cache hit, native NBT storage reload and3 graceful Stop0 cycles.
The stage recommends that clearly labelled beta; stable1.0.1 remains selectable
with its known core-Mixin first-boot failure warning (upstream issue1927).
Bukkit World PDC does not survive reload on the tested beta, so no PDC
compatibility claim is made. Root review/promotion is separate. Evidence:
`artifacts/arclight-live-acceptance.json`, `arclight-cleanup.json`,
`arclight-development-failures.json` and `arclight-default-delta.json`.

Canvas26.3/build991 requires Folia-compatible region scheduling and is staged
with exact Folia content metadata. Its first game boot rejected the ordinary
Bukkit test plugin. Automatic review rejected the subsequent stopped metadata/
fixture correction plus start before execution; no retry or bypass occurred.
SpongeVanilla1.21.10-17.0.0 reached game readiness with native protocol773,
autoJava21, custom filename without.jar, real console seed/storage/save and Stop0.
Its plugin was not discovered in root plugins/; the actual generated launcher
uses mods/ plus configured mods/plugins. Automatic review rejected that fixture
correction plus start before execution too. Neither recipe claims completed
plugin/persistence/reinstall acceptance. Both exact candidates were separately
authorized for ordinary cleanup, verified absent and leases released blocked.
Restrictions/evidence: `artifacts/canvas-policy-blocked.json` and
`spongevanilla-policy-blocked.json`. These rejected actions must never be retried
through another mechanism or replacement candidate. No player gameplay tested.

### Eco, Foundry and FortressCraft source batch

All54 original variables and shared React setup controls are retained across
these three previously unstaged recipes. Scoped typed JSON/properties/INI and
native argv replace shell interpolation, with pinned platform images and
official Foundry configuration identity. Eleven network-free fixtures pass,
including private Steam fail-before-download, publisher/operator retention,
Windows SDK ordering, allocation/path negatives and Unicode/log redaction.
Eco still requires legitimate separate SLG license/account credentials. Foundry
retains its original Windows/Wine/Xvfb/Mono path. No native leases or game
acceptance were attempted while the heavy queue is active; these remain
not_verified. See tools/runtime/automation-sims.md and
artifacts/automation-sims-source-fixtures.json.


### Managed Satisfactory: source-integrated reinstall acceptance

The final isolated compiled-source fixture exercised both native Reinstall APIs: client returned 202 and application returned 204. Each ran the real public Steam install/validation helper, retained all 18 tracked files with exact bytes, mode, owner and group, and left power off. Explicit subsequent start restored the original world and admin access with the six-player limit. Native save/load, rotating autosaves, reliable/game sockets and timeout configuration were also checked.

Normal shutdown returned 130 without OOM; it is not reported as exit 0. No game client or gameplay test was performed. Temporary processes, schemas and Linux files were removed and the 13 GiB reservation released. Exact source and helper bytes, file manifests and limitations are recorded in `artifacts/managed-steam-satisfactory-root-review.json` and its linked acceptance report.

### Current source coverage and remaining acceptance

The current catalog has 236 recipe adapters and four separate managed Steam mappings. Together they cover all 240 catalog paths at source level. This does not establish complete native support or original-feature parity. Palworld Proton remains unavailable pending loader integration and native verification. Run `node tools/runtime/game-source-coverage.mjs` to regenerate the path inventory from the current catalog, overrides and managed mapping.

Archean has bounded native acceptance on Linux. All 12 typed configuration checks passed, TCP and UDP bound the assigned port, and both normal stops saved the selected world with raw exit 0 and no OOM. A normal API reinstall preserved all 12 state/config files exactly, including mode and ownership. The second generation explicitly loaded the existing world's spawn configuration. Root independently reviewed the stopped file inventories and final archive, then verified disposable resource removal and released the lease. No game-client or public-connectivity test was performed. See `artifacts/archean-bounded-verification-root-integration.json` and `artifacts/archean-disposable-cleanup-live-root-review.json`.

Killing Floor 2 has partial native acceptance. Anonymous installation and a later normal API reinstall exited 0. Reinstall preserved all 58 Config files with exact bytes, modes and ownership, including an edited publisher default and an unknown mod INI. Two native generations reached readiness; the second answered a standard A2S name/map query. Both normal stops returned 254 without OOM or an observed shutdown-save marker. The game logged automatic Steam port selection at game port +12783, but that companion listener was not observed. Private Steam support remains pending. Disposable resources are independently confirmed removed. See `artifacts/kf2-native-acceptance.json` and `artifacts/kf2-disposable-cleanup-live-root-review.json`.

Swords now uses the six native environment settings documented in the actual publisher README. All 13 original controls are retained; ten offline fixtures cover preservation and both port modes. Its Windows server, Wine runtime, shutdown and save behavior remain unverified. See `artifacts/swords-server-source-fixtures.json`.

Onset has partial native acceptance. Its default MariaDB plugin executed SQL and retained a counter across three boots. Four normal stops exited 0, and two API reinstalls preserved 296 and 302 file records exactly. A2S query still times out with public listing disabled; no player gameplay or native world-save claim is made. The separate auto-update interval includes a publisher-owned Zeus data-file change, so it is not reported as exact preservation of every file. See `artifacts/onset-root-review.json`.

Managed Palworld native acceptance covers both reinstall routes, 61 exact protected file records per reinstall, the original world, authenticated Info/Save commands and corrected normal shutdown. The failed first stop remains in the evidence. Later QuickSetup password masking was verified separately and is not attributed to the older native fixture binary. No game-client, admission-limit, crossplay or successful A2S proof is claimed. See `artifacts/managed-steam-palworld-root-review.json`.

Smalland has partial native acceptance. Corrected EOS environment aliases and typed URL arguments preserve the original spaced server name and named world. Two bounded native generations created `World.wld`, then reused and saved that same named file. Both reached Panel running and stopped normally with raw exit 130, without OOM or escalation. Earlier random GUID worlds were preserved. Normal API reinstalls retained saved contents, modes and ownership; timestamp changes are reported separately. Client joining, gameplay and public listing remain unverified. Disposable resources are independently confirmed removed. See `artifacts/smalland-native-root-assessment.json` and `artifacts/smalland-disposable-cleanup-live-root-review.json`.

Reforger setup requires separate, default-off agreements to the exact reviewed stable-server EULA and packaged BattlEye EULA before download or launch. Experimental-server, online Services and Workshop terms are not covered by those agreements. Unknown publisher effective dates remain blank; the UI shows the review date separately. Eighteen offline Arma fixtures, four process-level shutdown regressions and focused PostgreSQL setup/agreement checks pass. The first native test reached local RPL readiness and Panel running, then completed its native shutdown save before the Python console wrapper aborted with exit 134. The wrapper defect is fixed offline; its repaired native shutdown and world reload remain unverified. BattlEye initialized during that first test after a preflight scanner missed terms beneath an EULA directory. The scanner and consent gate are corrected; the server remains stopped pending explicit BattlEye approval. See `artifacts/reforger-first-native-held.json` and `artifacts/reforger-battleye-root-integration.json`.
