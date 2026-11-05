# FS25 DLC update behavior

The maintained runtime scripts are embedded from `internal/panel/game_library/fs25`
by `game_fs25.go`, including the new `lib/dlc-update.mjs` helper. Deploy them as a
set through the existing template installation path. Editing source does not
change an existing container's `.voltra/fs25` files.

The scripts contain no third-party author payment gate. The upstream MIT notice
in `fs25/LICENSE` remains with the derived source. GIANTS download authorization
and game/DLC activation remain required.

## Update and recovery

- Select the numerically highest downloaded version of each product once per
  startup. Names must match `FarmingSimulator25_PRODUCT_A_B_C_D_ESD.exe`.
- Refuse installation while a game/server process is running. Startup and DLC
  installation have file locks to prevent overlapping runs.
- Move the previous product payload to `pdlc/.voltra-update` on the same filesystem
  before launching the installer. This avoids the existing-file overwrite prompt.
- On failure, restore the old payload. An interrupted transaction is recovered on
  the next startup even if its installer has been removed. Recovery errors block
  game startup and preserve the transaction for inspection.
- On installer exit 0 or Wine exit 1, require a nonempty replacement, record its
  SHA-256, and leave it pending. A matching version in a fresh game log, DLC load,
  and entry into gameplay are required before removing the backup.
- Existing legacy markers without checksum metadata are not sufficient to skip
  installation. The first run of this code can therefore reinstall existing DLCs.

## Console output

Downloads report authorization, cache checking, connection, received bytes,
percentage and ETA when Content-Length is available, verification, and completion.
Measured transfer updates appear every five seconds while bytes arrive. A transfer
with no data for 60 seconds fails; the overall request limit is two hours.
Existing downloads without a checksum receipt are fetched again once. Failed
downloads preserve the prior file and remove partial output. Receipts detect
subsequent local corruption; they are not publisher signatures.

Installation reports the selected file, activation detection, elapsed seconds,
replacement payload bytes, actual exit status, and pending game validation.
There is no invented installation percentage. Timeouts write a secret-free
`.last-failure-PRODUCT.txt` in the DLC directory. Raw Wine output stays in the
private `/tmp/fs25-dlc-PRODUCT.log`; it is not echoed into the console.

## Limits and follow-up

The Wine GUI still uses the known 1280x720 activation and success-dialog coordinates.
Late activation dialogs are detected throughout the run, but a changed/localized
dialog or unexpected error can still time out. This patch avoids the update's
overwrite prompt; it does not claim general GUI automation. Inspect a real failed
dialog before extending its handling. Never blindly accept arbitrary prompts.

A payload that installs but fails game validation remains pending with its backup
retained. Do not replace or restore it while a game session is running. Disk usage
temporarily includes both old and new payloads. No base-game updater, automatic
retry loop, or automatic downgrade is added. Recorded staged/installed versions
prevent a leftover older installer from being selected after the newest is removed.

Validation uses Node regression tests and an isolated shell fixture with fake
Wine. These tests prove selection, rollback, recovery, progress, cache integrity,
and version gates. They do not prove a native GIANTS install or live deployment.

## Live deployment, 2026-11-03

The six-file runtime bundle was deployed directly to the existing FS25 server on
the home server. It includes `scripts/operation-report.mjs`, which was absent from
the earlier runtime. Source hashes were read back after deployment. This was a
server-scoped deployment, not a panel release or an update to other containers.

Live GIANTS downloads completed with byte progress and checksum receipts. The
Pumps and Hoses 1.2.1.0 installer displayed: "This product needs the game version
1.25.1 or higher. Download update now?" The engine reports Game-Version 1.25.0.0.
The prompt was dismissed manually with No. The installer exited 1 without a new
payload; rollback restored Pumps and Hoses 1.2.0.0, which the game loaded again.
This proves rollback but does not prove an unattended handling of this prompt or
a successful DLC upgrade. Update the base game before retrying this DLC.

The new session entered gameplay at 18:49:30 UTC. The runtime validator confirmed
Emergency 1.3.0.0, Straw Harvest 1.3.0.0, and MacDon 1.2.0.0, then removed their
rollback copies. Pumps and Hoses remained at 1.2.0.0. The existing Krajow And
Lazniki mod-availability error appeared both before and after deployment.

Script rollback material is in the server volume under
`.voltra/backups/fs25-dlc-20261103T184340Z`, including the deployed hash manifest.

## Reinstall integration, subsequent source change

The existing Reinstall server action now selects the current bundled FS25 recipe
for managed eggs, including older imported versions. Explicit server installation
overrides are preserved. The installation image is root-default Debian; it installs Wine 11 before
opening the existing Wine prefix. The runtime image remains pinned. `reinstall.sh` maps the persistent volume to the normal Wine path,
drops to its owning UID/GID, and runs `start.sh --install-only`. No new dashboard
route, update button, background update service, or API permission is added.

Reinstall checks the current publisher version through the existing licensed
portal flow without downloading the full image. An outdated game is backed up,
then its original GIANTS launcher is invoked with `-updateAll`. The `VERSION`
file must reach the publisher's target before DLC installation can proceed.
Normal startup performs the compatibility check but does not apply a base update;
it skips DLC maintenance and directs the user to Reinstall if an update is needed.
Automatic-download opt-out remains respected. Mods are kept, not auto-updated.

Tests cover version selection, sequencing, no-op exits, rollback, disk failures,
secret-safe errors, real filesystem backup/restore, and success/failure execution
in disposable pinned installer containers with networking disabled. A live
read-only portal check resolved Windows version 1.25.1.0. These tests do not yet
establish a native GIANTS base-game upgrade or deployment of this subsequent
panel/reinstall integration. The earlier six-file runtime deployment is separate.


## Subsequent live test and backup dialog

The first real Wings reinstall failed before opening game files: the runtime
image defaults to UID 1000 and could not read Wings' root-only install script.
The root Debian bootstrap replaces that image in source; its full native update
has not been verified. The failed server-scoped override was removed and FS25 was
started again; the server reported Game server started at 19:11:21 UTC.
GIANTS subsequently returned "Download limit exceeded for this key". Further
live update attempts stopped. Ordinary startup must use the cached publisher
version, not issue download tickets. Reinstall refreshes that cache at most daily.
Node 18's combined Set-Cookie header is now handled explicitly.

The shared Reinstall dialog offers a default-on backup switch, names backups
Reinstall Backup - YYYY-MM-DD HH:mm:ss UTC, and waits for success before requesting
reinstall. Closing/navigating cancels the pending reinstall but keeps a started
backup. Existing exclusions, quota and permissions apply; no old backup is
silently deleted. The API checks that the supplied backup belongs to this server
and is completed, successful and not deleted, including before Steam routing.
This panel change is source-only. Focused frontend and database-backed backup
gate tests pass; broader route tests are blocked by the pre-existing invalid
embedded game_library/overrides.json catalog in the working checkout.


## Live deployment and corrected backup scope (2026-11-03)

A scoped overlay on deployed Nightly commit
187c70b3bb3bd738225fe24ecea820e3294a909a was built and deployed separately from the
dirty working catalog. The existing shared Reinstall dialog is live. Its FS25
backup is now saved-data-only: data/savegame[0-9]*, modSettings, root XML/DAT files
and dedicated-server configuration. It excludes Wine/game installation, mod and
DLC binaries, caches and the savegameBackup history. Other games retain their
normal backup behavior and the dialog describes that scope explicitly.

The initial full-server test archive was 36,946,564,109 bytes and was deleted
through the Backups API after the user corrected the requested scope. The
replacement backup is 60,917,296 bytes (58.1 MiB), UUID
0f110ab1-51dc-4126-8dc8-50b918b86fb9. Its archive was inspected: 128 files, both
current save slots, settings and licence files; no game, mods, DLCs or historical
save backups. The actual archive uses the same gitignore matcher as Wings;
negative directory patterns must match the directory itself to allow traversal.

Live reinstall testing found and corrected a Wine keyring format/permissions
error and symlink-sensitive Node entrypoint guards. The latter originally let
the installer return success without running update helpers; that result is
explicitly not native update acceptance. CLI checks now resolve argv[1] with
realpathSync, with Windows junction and Linux container regression evidence.
An early ownership repair keeps script files readable after bootstrap failures.


The corrected symlink-aware live attempt reached the base-game check and failed
with PROVIDER_DOWNLOAD_LIMIT. DLC work did not run; VERSION remained 1.25.0.0.
All original world and licence files retained their hashes. The dedicated-server
metadata database changed during the intervening normal start; it is not a world
or licence file. Recovery through the ordinary client Start API initially hit an
inconsistent power guard. HTTP/WebSocket power now allow reinstall_failed for a
previously installed server, retaining suspension/maintenance/transfer guards;
the shared power controls and runtime status display follow the same policy.
The live client Start API subsequently returned 204.
Final panel deployment: nightly-fs25-reinstall-data-20261103-v6, derived from the
same Nightly .8 commit; no Release feed or other game container was changed.

## Reinstall workflow correction, 2026-11-03

The version check now reads GIANTS' public FS25 changelog. It no longer requests a licence-gated full-installer ticket just to learn the version. The installed game's native updater runs before DLC work, and its exit alone is insufficient: VERSION must reach the published target.

Existing DLC installers are compared with the FS25 section of GIANTS' public updates page. Current downloaded installers must also match their stored size and SHA-256 receipt. A stale, unknown, or damaged cached installer falls back to the authorised download path. Installed and pending DLC versions still require the engine's matching version and load markers before final success.

A newly completed successful managed FS25 reinstall requests runtime startup automatically. Failed installs, duplicate completion callbacks, later installation cycles, suspended servers, transfers, and node maintenance do not trigger that startup. The installer reports prepared files, not gameplay success. Runtime validation owns the final ready verdict.

Live verification is in progress. Do not treat the public metadata checks or isolated tests as proof that the native update and DLC installation succeeded.

## Backup ownership correction

Backups belong exclusively to the Voltra app's reinstall confirmation flow. The FS25 base updater does not create backups, inspect backup state, or impose a backup disk reserve. Both admin and owner reinstall buttons now use ReinstallServerButton with the same default-on optional saved-data backup. If enabled, the app waits for its backup to succeed before requesting reinstall.

The updater retains only operation state so an incomplete native update cannot be mistaken for a successful installation. Reinstall resumes native repair, including when VERSION was temporarily removed. It runs a working copy of the vendor launcher outside the game directory, with explicit Windows game/profile paths and a trailing profile separator, and waits for the Wine child process handoff. Console progress derives safe phase labels from newly written native updater log messages.

These changes supersede earlier descriptions of internal base-game snapshots or rollback copies. Live end-to-end acceptance remains pending.

The native publisher receipt is diagnostic information, not installation proof. Reinstall must find the actual VERSION file and game executable before permitting DLC installation. A missing executable triggers native repair. Live testing found that the publisher can report success with missing launch files, so that case now fails explicitly with GAME_FILES_INCOMPLETE. The current live repair is not yet accepted as complete.

## Live acceptance, 2026-11-03 20:48 UTC

Deployment `nightly-fs25-reinstall-data-20261103-v18` is served. A native repair restored the missing game executable and VERSION 1.25.1.0, then staged Pumps and Hoses 1.2.1.0. The subsequent canonical Reinstall server action was submitted through the live Voltra dialog in Brave. It checked the current base and DLC files, completed successfully, and automatically started the runtime. The fresh engine log `log_2026-11-03_20-45-02.txt` reports game 1.25.1.0, Emergency 1.3.0.0, MacDon 1.2.0.0, Pumps and Hoses 1.2.1.0, Straw Harvest 1.3.0.0, all four Load dlc markers, and Entered Gameplay at 20:48:04. The update status reached UPDATE_COMPLETE with no pending DLC markers.

All 104 saved-world files matched the stopped baseline before automatic startup. The existing successful Voltra saved-data backup remained 60,917,296 bytes. For the final retry, backup creation was switched off in the app to retain that existing backup without requesting a duplicate; the dialog default-on state was separately verified. No script-owned backup check, snapshot, or storage reserve ran. The obsolete script snapshot and all temporary updater containers were removed. The dashboard showed Online without a reinstall-failed banner. This proves native gameplay startup, not a remote player connection.

Validation: 39 focused Node tests passed; previously recorded UI typecheck/build and Go automatic-start/backup guard tests passed. Deployment and canonical-script contents were checked against the scoped build. Evidence is retained on the node under `/tmp/voltra-fs25-live-test-20261103/v18-canonical-success.json` and `v18-canonical-retention.json`.
