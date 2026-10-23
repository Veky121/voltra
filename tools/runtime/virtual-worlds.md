# Virtual worlds source adapters

Stage with `node tools/runtime/stage-virtual-worlds.mjs`. This writes only
`.local/virtual-worlds/profiles.json`; root owns canonical catalog integration.
`node tools/runtime/virtual-worlds-source-proof.mjs` checks original variable
defaults/rules/permissions, current embedded sources and pinned images.

Neos and Resonite remain source-only. NWN native acceptance is reported separately
in `artifacts/nwn-native-acceptance.json` when its final evidence is ready.

## Neos and Resonite

The original eight variables per recipe remain in their original order, with
their defaults, visibility, editability and validation rules. Neos uses Mono and
the original `Neos.exe`, `Config/Config.json`, `Logs` and `shutdown` protocol.
Current Resonite uses .NET 10 and `Headless/Resonite.dll`, not the original Mono
executable. It runs from `Headless` so native data/plugins remain beside the
headless application. Existing world config bytes are not rewritten on startup.
Missing configs get one private Grid session using the selected primary LNL port.
An explicitly empty world list remains valid for interactive world creation.
Listener overrides must select allocated ports; unknown configuration fields,
world-saving options and role/account settings remain operator-owned.

Both publishers require an entitled private Steam branch. The install helper
fails before network, bootstrap, payload writes or process launch because private Steam
credential transport is not verified in this project. Automatic update retains
its original default and fails visibly. The egg shell script prepares runtime
helper files, then exits with failure without APT/Steam requests.
Operators with their own legally acquired
headless files can upload the correct payload and select `AUTO_UPDATE=0`. This is
runtime preparation, not an entitlement bypass or complete installation support.
The application still requires publisher account access where applicable.

`ENABLE_MODLOADER=true` installs pinned NML 1.12.6 or RML 5.0.1 plus their pinned
Harmony artifact. All downloads and corresponding LGPL/MIT notices are SHA256
checked before any publication. Different operator loader bytes are preserved
and rejected pending explicit version resolution. Other plugins are untouched.
Native plugin compatibility is unverified.

Registry image pins are the observed multiarch manifests for `mono_latest`
`327404b6358bdc3b558587713b21fbc1719c10b369a38f32b33045954ab4627b`
and `dotnet_10`
`9173704345a6ea815622cede2ef15cd7f317f4374d4b7a361929d2d4756ed351`.
Image metadata receipts under `.local/virtual-worlds` record the Linux amd64
children/config history. The base is Bookworm; Python 3.11's TOML parser is used.

Primary sources:

- https://wiki.neosvr.com/Headless_Client
- https://wiki.resonite.com/Headless_server_software/Setup
- https://wiki.resonite.com/Headless_server_software/Configuration_file
- https://github.com/neos-modding-group/NeosModLoader/tree/1.12.6
- https://github.com/resonite-modding-group/ResoniteModLoader/tree/5.0.1

## Neverwinter Nights Enhanced Edition

All original twenty variables remain. Startup uses typed argv, `-interactive`,
the selected port and original gameplay options. `SAVE_SLOT`, unused by the old
egg, now selects `-load` and takes precedence over `MODULE_NAME`. Slots 0 and 1
are reserved. Passwords are TOML strings under `[server.login]`, in private
`user/settings.tml`, never process argv or native environment. Existing unknown
TOML settings and comments remain; previous settings are privately backed up.
Malformed/duplicate/multiline managed password TOML fails before writing.
The original max-level default 100 was rejected by native 8193.37-17 and silently
fell back to 40. The explicit replacement default is 40, and MIN_LEVEL/MAX_LEVEL
rules now require integers 1 through 40. Other original defaults/rules remain.
Module and saved-game completion lines both produce a constant readiness marker,
so loading an existing save transitions Wings to running. Child umask 0077 keeps
the publisher's own rewritten password settings private after startup and exit.

Wings may run UID 988 without a passwd entry in its image. NWN dereferences a
missing getpwuid result and crashes before resources load. The installer pins
Ubuntu libnss-wrapper 1.1.15-2, verifies library/license SHA256 and retains its
copyright notice. Runtime creates owner-private passwd/group mappings and loads
the wrapper only for the NWN process when the actual UID lacks an entry. No host,
image or node users change. Matching dependency bytes and metadata are left
intact on reinstall. The original failed native boot and the initial dependency
ownership regression remain in the private evidence directory.

The original latest-version lookup used the Beamdog Docker tags. Beamdog now
explicitly marks those images outdated. The installer uses the official archive
index, numeric version selection and SHA256 sidecars. The observed current
archive is `8193.37-17`, SHA256
`e46444749cbd1f8238802b8c6d603ba8ed9252e6f1f835f2b5bd4933db6b96f3`.
The actual 64,780,418-byte archive was downloaded and checksum verified without
executing any game code. Its binary strings contain `-interactive`, `-load`,
`server.login.player-password` and `server.login.dm-password`.

Only Linux program/data/lang files are published. Existing matching files are
left intact; changed files need a previous matching receipt to authorize update.
Modified/unmanaged collisions fail. Reinstall does not launch a server or move
root's home directory. The whole `user` tree, custom modules, vaults, databases,
unknown program files, settings and saves remain untouched. A publication failure
rolls back updated programs. Archive path traversal, symlinks, duplicate members,
oversized downloads and expansion are rejected.

The dedicated archive lacks playable modules. A licensed module in user/modules
or an existing save is a real prerequisite. No client assets are fabricated or
downloaded from third-party mirrors. Native module/console/network/password/save
acceptance for older explicit archive versions remains pending. Native acceptance
uses only a pinned MIT DockerDemo.mod from the publisher-recommended maintained
urothis/nwserver project, as an isolated test fixture. It is not bundled into the
production game distribution. No proprietary client or operator module is used.

Primary sources:

- https://nwn.beamdog.net/downloads/
- https://nwn.beamdog.net/downloads/nwnee-dedicated-8193.37-17.zip.sha256sum
- https://hub.docker.com/r/beamdog/nwserver
- https://github.com/urothis/nwserver/tree/b1822f0781083aacd166929c8794d9d0e7f7c18c

## Verification

`test-virtual-worlds.py` runs 31 tests in a bounded Python 3.13 Linux utility
container with no network and no publisher executable invocation. It covers
private gates, typed original controls, Unicode/literal arguments, modern .NET
startup, saved slots, secret TOML parsing, byte/metadata preservation, symlinks,
bad publisher digests, operator collisions and rollback after publication failure.
The test returns an injected raw native status 37 unchanged; it does not count
as a native lifecycle result. Root should run shared Go/catalog checks after
reviewing the staged profiles. No frontend components, builds or services changed.
