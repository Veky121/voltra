# Citadel, Portal Knights and Solace Crafting source adapters

This batch stages only these canonical recipes in `.local/fantasy-worlds/profiles.json`:

- `citadel/egg-citadel-forged-with-fire.json`
- `portal_knights/egg-portal-knights.json`
- `solace_crafting/egg-solace-crafting.json`

All remain `not_verified`. Root owns merging the stage. This batch never edits canonical overrides, restarts services, changes live data or imports NWN or Minecraft recipes.

The adapter retains all 19 original variables and their defaults, visibility, editability and metadata. The approved exception changes the two Portal Steam credential rules to `required_if:PORTAL_INSTALL_MODE,steam`. The shared React form can therefore select an uploaded publisher payload without dummy Steam credentials. New controls select Portal installation source and Solace query allocation. Hidden fixed `XVFB=0` prevents the image-wide display launcher from running. Portal uses the existing typed-Wine feature to suppress unrelated image startup mutations.

## Installation and state

The typed Steam helper retains original AppIDs 489650, 374040 and 1086950. Branch/platform/options validation runs before preservation copies or publisher processes. Private Steam transport remains blocked. No username, password or arbitrary Steam flags enter process arguments or logs. `AUTO_UPDATE=0` skips boot-time installation, including the derived backend `VOLTRA_STEAM_AUTO_UPDATE` setting.

Portal's Steam AppID is a licensed client, not evidence of anonymous server entitlement. In `uploaded` mode, installation uses the operator's legal `dedicated_server.zip` or exact extracted `dedicated_server/pk_dedicated_server.exe`, prepares the console helper and never calls Steam. Blank original Steam fields are valid in this mode. The app does not supply game assets or bypass ownership requirements.

Protected native configuration, saves, worlds and mods are copied before publisher updates and restored even when updates fail. Copies stream to private scratch files instead of retaining whole saves in memory. File permissions/ownership and empty directories are retained. Unknown links stop installation except Citadel's exact legacy configuration aliases to volume `Config`.

Portal ZIP extraction validates all names, wrapper layout, case-insensitive collisions, expansion limits, symlinks and operator-state exclusions. Modified/unmanaged program collisions fail without overwriting them. Atomic publication failures, including failures after rename, attempt rollback of every exact owned published inode and its old receipt. New dependencies are installed only by the future installer using signed package repositories. No compiler or binary download occurred during source verification.

## Native configuration and console

Citadel keeps `Config/Game.ini`, the entire original WorldCreationSettings tuple and unknown INI keys. It updates only the SocialManager administrator password and selected UWorks ports. Engine.ini URL ports match the game port. Existing native configuration directories are never deleted. Locked original `QPORT=27015` requires a distinct matching allocation and is not silently remapped. The documented Steam SDK plugin link is replaced only when its exact target matches the original layout.

Portal preserves per-role permissions, unknown JSON settings and a confined custom save folder. Passwords stay in private configuration. The publisher documents that `hideConsoleWindow=true` prevents ordinary console closure, so the new private Xvfb driver uses false. Its MIT PE32 helper verifies the full executable path before attaching the exact private Wine PID. Input and Ctrl+C are sent through stdin. It never invokes global wineserver termination. A compile receipt binds helper source, binary, architecture and actual compiler packages. This source fixture suite does not prove Win32 compilation or native delivery.

Portal stdout and logs use separate bounded UTF-8/UTF-16 decoders and secret redactors before merging. Readiness observes private normalized native output before redaction. Previous logs are retained privately and excluded from new readiness. Invalid encodings stop that stream instead of forwarding raw possibly secret bytes. Current publisher output encodings and markers still need native acceptance.

Solace retains every original servercfg.dat field, including privacy, Steam IDs, administrator/moderator settings, world choice and restart interval. Only allocated game/query ports are managed. Worlds remain under the original Unity configuration tree. Historical publisher documentation lists several access controls as inactive. Preserving them does not claim current native support.

Native console supervision reuses the shared PTY/secret redactor. Startup, ports, process exit, save-on-stop, mod support, Steam listing and client gameplay have not been accepted for any of these recipes. RAM/disk values are initial estimates.

## Source verification

Run `node tools/runtime/prove-fantasy-worlds.mjs` from the module root. It stages only this batch, checks every original control and embedded helper, and runs 34 offline Python fixtures in an existing utility image with no network, 256 MiB memory, one CPU, a read-only filesystem and 64 MiB temporary storage. Fixtures use synthetic bytes, mocks and local temporary files, never publisher executables. The source proof also checks pinned runtime image metadata/history for Python/display prerequisites without launching that image.

`artifacts/fantasy-worlds-source-acceptance.json` records original catalog commit, exact recipe/helper/stage hashes, primary documentation links, deliberate behavior changes and remaining native gaps. Original egg licensing stays in `internal/panel/game_library/upstream/LICENSE`. Source helpers are MIT. Publisher game licenses remain separate.
