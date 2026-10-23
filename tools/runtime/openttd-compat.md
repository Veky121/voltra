# OpenTTD original controls

Stage with `node tools/runtime/stage-openttd-compat.mjs`. Output is
`.local/openttd-compat/profiles.json`; only root merges it into shared overrides.
The installer template and resolver/launcher sources live in
`internal/panel/game_library/scripts/openttd-{install,resolve,start}.sh`.

All original variable names remain: `srv_name`, `srv_advertise`,
`OPENTTD_VERSION`, `OPENGFX_VERSION`. Version fields retain their original
administrator-only editability. Defaults stay at the previously accepted
OpenTTD 15.3 and OpenGFX 8.0 with the same pinned archive hashes.

`SERVER_VISIBILITY=auto` uses `srv_advertise=true` for public and false for
local. New installs default to false/local. Explicit existing values of local,
public or invite-only continue to win. This precedence is described in both
fields so legacy edits are never silently advertised as effective overrides.
The launcher also accepts uppercase `SRV_ADVERTISE` when the original lowercase
variable is absent. It rejects invalid settings, preserves unrelated config
keys/comments, and retains the prior exit-save search and native console.

Release selection accepts exact publisher version tokens including the original
13.0-RC2 and OpenGFX 7.1. Nondefault versions resolve the exact archive SHA-256
from that release's official HTTPS `manifest.yaml`. Missing, ambiguous or invalid
checksum records fail installation. Defaults use pinned hashes without metadata
lookup. Version changes require reinstall; availability does not prove a release
runs on the current image. No claim is made for versions without a Linux amd64
archive or valid publisher manifest. Existing saves require compatible engines;
downgrades can make newer saves unreadable.

OpenGFX extraction uses a fresh private staging directory so a prior version's
cached tar cannot overwrite the newly selected graphics. Existing config is
retained by the installer. The new launcher is installed during reinstall;
merging source does not mutate a previously provisioned server.

Tests: `node tools/runtime/test-openttd-compat.mjs` runs shell syntax and mocked
native-launch/config/manifest fixtures in a tiny network-disabled container.
Add `--publisher-metadata` to fetch current official manifests for 15.3,
13.0-RC2, 8.0 and 7.1 and run the actual shell parser against them. This does not
download the game or start a native server. The changed launcher has now passed
fresh 15.3/8.0 native acceptance on the owned remote node, with LAN query,
legacy visibility mapping, explicit visibility precedence, native save and world
seed restoration, six-file reinstall preservation and graceful exit code 0.
All owned resources were removed and the eleven-container baseline preserved.
See `artifacts/openttd-compat-acceptance.json` and
`artifacts/openttd-compat-cleanup.json`. Alternate versions remain unverified
at runtime; metadata acceptance is separate.

Sources: https://cdn.openttd.org/openttd-releases/15.3/manifest.yaml,
https://cdn.openttd.org/openttd-releases/13.0-RC2/manifest.yaml,
https://cdn.openttd.org/opengfx-releases/8.0/manifest.yaml,
https://cdn.openttd.org/opengfx-releases/7.1/manifest.yaml and the native
`OpenTTD/OpenTTD` 15.3 `src/table/settings/network_settings.ini` definition of
`network.server_game_type`.
