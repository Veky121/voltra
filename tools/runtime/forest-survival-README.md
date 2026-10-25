# Forest survival source adapters

Stage `.local/forest-survival/profiles.json` with
`node tools/runtime/stage-forest-survival.mjs`. All three are **not_verified**.
Root owns canonical overrides. No native lease, server creation, game boot,
Steam depot, Wine/Mono/VC runtime download or service restart occurred.

Exact recipes and original field counts:

| Recipe | Original controls | Port roles |
|---|---:|---|
| `the_forest/egg-the-forest.json` |15|game, Steam, query|
| `sonsoftheforest/egg-sons-of-the-forest.json` |15|game, query, BlobSync|
| `sunkenland/egg-sunkenland.json` |10|original primary publicPort; current extra requirements unverified|

Original defaults, rules and view/edit permissions are retained. All fields use
the existing shared React setup component. The Forest gains typed
WINETRICKS_RUN=sound=disabled, replacing its shell startup command. All three use
the existing license-acceptance prerequisite field for managed private runtimes.

Run Linux fixtures:

```
wsl.exe -u root -e python3 tools/runtime/test-forest-survival.py
wsl.exe -u root -e python3 tools/runtime/test-private-wine-prerequisites.py
```

The family suite has20 passing tests, common Wine suite5. Engineering's original
16 fixtures and three profile/embedding checks also passed after extraction.
These exercise actual temporary Linux files/owner/group/modes with mocked
publisher processes. They do not establish a working Windows game under Wine.

## Shared components and changes

`forest-survival.py` reuses typed Steam app_info/update/validate, secure anchored
publication, native PTY console, and `private-wine-prerequisites.py`. Root approved
the generic extraction from engineering.prepare_wine; its thin wrapper retains
the original defaults/allowlist and is separately staged/reviewed. This family
does not alter common runtime behavior or engineering pins.

The generic API is `prepare(root, env, default_verbs, pins, allowed_verbs)`.
Required pin keys: wine_runtime and mono{url,sha256,...}. Dependencies are the
existing steam-native-next confined/text functions, native-config/native-release,
and steam-template. No raw WINETRICKS_RUN shell evaluation occurs: the daemon
preserves original selection in VOLTRA_WINETRICKS_RUN and suppresses the stock
entrypoint action. .wine is private; existing win32 prefixes and path escapes fail
without deleting data. Mono is pinned by Wine's published SHA256; VC runtime
verification uses the immutable image's Winetricks implementation.

The Forest retains original config.cfg path, independent ports, GSLT (a publisher
server token, not private Steam account authentication), passwords, VAC, name,
players, difficulty and New/Continue. Unknown slot, autosave, save path and
gameplay/mod settings survive targeted line edits. Duplicate managed lines fail.
The old grep hiding renderer errors is removed so diagnostics remain visible.

Sons retains serverconfig/dedicatedserver.cfg and ownerswhitelist.txt. Managed
JSON is typed; legacy SAVE_SLOT="0000000001" remains the original field default
and maps to native integer1. Values beyond Int32 fail clearly. SaveMode,
GameSettings/CustomGameModeSettings and all unknown fields survive. Original
LogFilesEnabled=true/TimestampLogFilenames=true behavior remains. Passwords are
stored in the original config, rather than expanded into a shell command.

Sunkenland retains WORLD_GUID/region/password/player cap, original publicIP and
publicPort command-line controls, and the original user-container .wine world
path. SERVER_NAME renames the matching world folder without deleting a collision;
multiple matching GUIDs fail. Existing AdminSteamIDs/BanSteamIDs and world files
remain untouched. Current native CLI/save-location changes need acceptance.

Reinstall streams configured save/admin/config/mod roots into bounded32GiB
private staging. Successful AND failed Steam updates restore original bytes,
mode, UID and GID through anchored no-follow publication. New Steam build receipts
remain new; preservation does not restore stale helper/Steam release state.
Forest paths include Data/forest, Data/Multiplayer, Data/Saves and its original
Wine user data. Sons preserves serverconfig. Sunkenland preserves its full
original AppData/LocalLow tree. Mods, BepInEx config/plugins and MelonLoader mod
paths are retained; actual mod/framework compatibility is not claimed.
If a restoration fails, remaining files are still restored and recovery copies
with path/mode/UID/GID manifest are retained in the private preservation folder.
They are not deleted as part of failed cleanup. Successful staging cleanup checks
the owned directory inode and resolved parent before recursive removal.

## Sources, archives and limitations

Exact original JSON archives were fetched and their catalog SHA256 verified at
`.local/forest-survival/original-eggs/`. All come from pinned revision
`c637a6d1e0449b167efeff81bb9a0177aa3df6c2` of
https://github.com/pterodactyl/game-eggs under its MIT repository license.
This does not grant ownership of games, publisher runtime components or sample
world content beyond whatever rights their respective authors grant.

Sources checked2026-10-23:

* Endnight's Sons configuration guide hosted on Steam:
  https://steamcommunity.com/sharedfiles/filedetails/?id=2992700419
  describes app2465200, three independent UDP ports, userdatapath, JSON schema,
  owners whitelist, save slots, save modes and command-line overrides. Its
  displayed authors are Dishmink/Survivalist; the web reader also rendered generic
  removed/incompatible-item banners, so current native support is not inferred
  solely from that page. Original catalog mappings agree with its documented
  fields. No external hosting-provider claims are treated as publisher proof.
* Sunkenland publisher manual landing page:
  https://www.sunkenlandgame.com/post/dedicated-server-user-manual
  still advertises a20240202 PDF. Its PDF URL/body was not exposed in the fetched
  page. The publisher developer support confirms the Vector3 Studio/Sunkenland
  LocalLow save tree in
  https://steamcommunity.com/app/2080690/discussions/2/587307627624755642/ .
  Recent community reports describe -port/-queryport and SteamCloudData paths;
  those are **not** sufficient publisher/native proof to silently replace the
  original publicIP/publicPort API. This remains an explicit compatibility gap.
* Forest's available configuration reference:
  https://theforest.fandom.com/wiki/Dedicated_Servers is community-maintained,
  not a newly verified publisher specification. The exact original recipe and
  sample line configuration are the pinned source of preserved behavior.
* Existing reviewed runtime image:
  ghcr.io/ptero-eggs/yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8.
  Private WineMono9.1.0 SHA256:
  8a0a1e6837b494df49927e5d759b1c6908e89b8a2f8e3ad025e1c2881882476e,
  original Wine provenance:
  https://github.com/wine-mirror/wine/blob/wine-9.8/dlls/appwiz.cpl/addons.c .
  These existing reviewed pins do not imply current game compatibility.

## Authorized legacy world review

Root specifically authorized fetching the three public upstream sample files,
**20370bytes total**, solely for checksums/layout/provenance. They reside under
`.local/forest-survival/upstream-source-world/`, never a runtime/cache world.
Pinned source root:
https://github.com/pterodactyl/game-eggs/tree/c637a6d1e0449b167efeff81bb9a0177aa3df6c2/sunkenland/world_files/Worlds/World~11223344-5566-7788-99aa-bbccddeeff00

| File | Bytes | SHA256 |
|---|---:|---|
|StartGameConfig.json|243|e389395bcc388fcfd6d440b97b791385e09f6d6fc283f6693eebd9e6a3e0ff6f|
|WorldSetting.json|608|0cdd81bf35b57d06f7e4d3c8042e788e6c463ad01487cce5c118ddd2dfb0bd5b|
|world.json|19519|efd592cc2a818541aa665af78b4c287a679e6a1ce9d4e9655f47b2abef43a746|

WorldSetting contains typed ApplicationVersion string **0.6.01**, indicating a
legacy sample. StartGameConfig has a wrapped StartGameConfig root. world.json
does not parse as ordinary UTF8 JSON; it is treated as opaque bytes. No world
conversion, current-version compatibility or OSS ownership of sample content is
claimed. Source code preserves the original missing-default-world bootstrap, now
checked with SHA256+Git object identity, all downloads validated before atomic
new-directory publication. Existing worlds are never reseeded or deleted.
Native acceptance may require a legitimate current operator-created world.

Every profile remains not_verified pending native startup/ports/query, Windows
console/normal Ctrl-C exit, settings/admin/mod behavior, world save/reload,
reinstall and cleanup acceptance. No gameplay or client connection was tested.

Shutdown requests use the shared native console's explicit
`stop_signal=signal.SIGINT` mode. Terminal input remains enabled for console
commands; injecting a PTY ETX byte is not treated as evidence of SIGINT delivery.
The shared bounded signal shutdown retains the native raw exit status, including
nonzero exits; actual Wine/Windows Ctrl-C handling remains native-unverified.
