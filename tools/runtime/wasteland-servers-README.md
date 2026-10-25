# Wasteland server source adapters

`node tools/runtime/stage-wasteland-servers.mjs` stages three **not_verified**
profiles at `.local/wasteland-servers/profiles.json`. Root owns canonical merges.
No Steam depot, Windows/Linux game binary, Wine/VC/font runtime download, native
lease, server creation or service restart occurred. No gameplay was tested.

| Exact imported recipe | Original controls | Platform retained |
|---|---:|---|
|night_of_the_dead/egg-night-of-the-dead.json|16|Windows under private Wine|
|no_one_survived/egg-no-one-survived.json|17|Windows under private Wine|
|plains_of_pain/egg-plains-of-pain.json|11|native Linux|

All44 original variable names/defaults/rules/view-edit permissions remain. Added
Windows runtime-license acceptance uses the same shared React form. QUERY_PORT
is an explicitly assigned, distinct game-address role, with existing automatic
selection metadata. Every game requires two allocations. No unspecified extra
ports are fabricated from unrelated Unreal/Unity defaults.

Run `wsl.exe -u root -e python3 tools/runtime/test-wasteland-servers.py` for21
focused fixtures. Filesystem fixtures run as Linux root on temporary paths to
exercise real UID12345/GID12346, modes and secure publication. Publisher updates
are mocked. One tiny Python process verifies actual SIGINT delivery and native
exit42 returned unchanged through the shared console. This is process transport
proof, **not game/Wine normal shutdown or save completion**.

The first one-shot signal.pause version of that tiny fixture escalated after2s
and returned raw241. Mask inspection was empty, not a confirmed signal-mask
failure; a direct group-signal probe returned42. The final fixture records
PID/group/mask in readiness diagnostics and uses a periodic wait loop, passing
with exit42. Shared native-console source was never changed or exit-normalized.
This fixture history is retained in the source-review artifact.

## Shared behavior and original controls

`wasteland-servers.py` reuses typed Steam metadata/update/validate, fixed platform
selection before login, secure anchored publication, common private Wine API,
INI patching/unique JSON parser and native console explicit SIGINT mode.
Private credentials/password branches remain fail-closed before writes/processes.
No raw shell expansion, background shell PID, fixed sleep or global Wine mutation.
All scripts retain publisher native markers; file-log forwarding only reads fresh
bytes from confined regular files and never replays historical readiness.

Night retains LF/Saved/Config/ServerSettings.ini and LF/Saved/SaveGames. Managed
ServerName/Password, SaveName/IngameAdminPassword/DefaultMessageOfTheDay,
Difficulty and GameSettings/General.MODSelect map every original field. The old
malformed MOTD template `{env.SERVER_MOTD}}` now maps the actual field. MaxPlayers,
custom difficulty/gameplay/mod settings and repeated unrelated INI arrays remain
untouched. OTHER_ARGS supports literal optional switches; shell fragments and
managed port/path/exec overrides fail clearly. WINEPATH/WINEDEBUG, derived typed
Winetricks vcrun2022/corefonts and XVFB=1 remain meaningful. LF.log uses a bounded
anchored no-follow relay with fragment redaction, truncation/rotation handling,
FIFO/symlink rejection and no historical readiness replay.

No One retains original WRSH/Saved/Config/WindowsServer Engine.ini and Game.ini.
URL.Port, Steam networking/query port, save/name/password toggle/password,
players/zombies/region/admin password map every original field. Unknown OpenMap,
GameSettings, plugin/admin entries and repeated unrelated arrays remain editable.
Both config plans validate before the first managed write. Original
STEAM_NETWORKING=True remains selectable with its original startup-failure
caveat. Original WINEARCH=win32 field remains present; current Win64 binaries/
common private runtime reject that legacy value explicitly instead of ignoring
it or deleting a prefix. Actual Win32 support is not claimed.

Plains retains native PlainsOfPain.x86_64, the original headless/-cc/-config
command and configs/server.json API. Initial config copies publisher
configs/default.json only if missing; no third-party default is downloaded.
Name/password/player/world/map/seed/difficulty/size/ports are typed. Unknown
admins, native save paths, gameplay, workshop/mod fields remain. Original signed
integer world/map/seed fields use bounded native Int32 values; original allowed
difficulty1..4 and sizes11/21/31/41/51 remain. No Windows substitute or unsupported
Linux workaround is silently introduced.

## Preservation and receipt ownership

Unique `wasteland-preservation.py` parameterizes the previously reviewed Forest
disk-preservation behavior, without editing Forest or a shared helper. Saved
trees are LF/Saved, WRSH/Saved, and Plains configs/saves/worlds/known Unity data
locations, plus Mods/BepInEx config+plugins/MelonLoader mods. The32GiB preservation
limit fails explicitly before a publisher process if exceeded. Symbolic-link
inputs fail before mutation. Existing world/config/admin/mod bytes, modes and
UID/GID restore on successful and failed Steam updates. New Steam release/SDK
receipt content is **not** rolled back to old data; tests assert new build bytes
with old owner/group/mode. New publisher default copies inherit volume ownership.
If restoration of one file fails, others are attempted and all private recovery
copies+metadata manifest remain. Successful cleanup verifies the owned staging
directory inode/resolved parent before deleting only that staging tree.

Shared `native-console.run(...stop_signal=signal.SIGINT)` targets the owned native
process group. PTY ETX alone is not treated as signal delivery. Native raw exits
are returned unchanged, including nonzero codes. Timeout escalation is visible
and never asserted to be a clean save. Actual Windows console/admin command
support and normal stop require native acceptance.

## Exact sources and primary documentation

Exact imported raw egg archives were fetched under
`.local/wasteland-servers/original-eggs/` and SHA256 checked against catalog at
revision `c637a6d1e0449b167efeff81bb9a0177aa3df6c2`:
https://github.com/pterodactyl/game-eggs/tree/c637a6d1e0449b167efeff81bb9a0177aa3df6c2 .
Repository MIT licensing does not grant game ownership or publisher runtime rights.

Night's original public config3477bytes was read from that same pinned commit:
https://raw.githubusercontent.com/pterodactyl/game-eggs/c637a6d1e0449b167efeff81bb9a0177aa3df6c2/night_of_the_dead/ServerSettings.ini
SHA256 `c62ee2dbfcd6ac7dc702d159c99f49f597f527d4a4d1c32913d63312c4fec3b3`.
It is embedded as the create-if-missing default, never downloaded from mutable
main or overwritten onto operator settings.

Primary pages read2026-10-23:

* Night publisher developer jackto's deployment post:
  https://steamcommunity.com/app/1377380/discussions/0/2849047119419572824/
  links https://steamcommunity.com/sharedfiles/filedetails/?id=2252239447 .
  The guide names jackto_dev/jacktoQA collaborators, updated2025-05-21, describes
  anonymous app1420710, game/query ports, save path, INI controls and16GiB RAM.
  The source profile therefore uses16GiB recommended memory. The web rendering
  also showed generic removed/incompatible banners; current native support is
  not inferred from that page alone. Its root-level ServerSettings.ini wording
  differs from the imported Saved/Config path, so actual publisher precedence
  remains an explicit native acceptance check.
* No One publisher announcement2023-10-25:
  https://steamcommunity.com/games/1963370/announcements/detail/3714965613435374565
  was available through the official Steam community-announcement feed:
  https://store.steampowered.com/news/posts/?enddate=1698235050&feed=steam_community_announcements .
  The direct article rendered only an image in the web reader. The official feed
  confirms app2329680 and Game.ini path; no private runtime OneDrive download or
  account-login workaround was used. Historical configuration documentation is
  not a guarantee of current native compatibility/100-player support.
* Plains developer fosco.alma's platform advice:
  https://steamcommunity.com/app/2218970/discussions/0/4336482437895967889/
  confirms app2227360 and warns native Linux needs workarounds, recommending
  Windows at that time. Original Linux route is retained, **not runtime verified**.
  No recent maintained publisher config specification was found; preserved field
  semantics come from the exact imported recipe, not third-party hosting claims.

Wine uses the existing reviewed image
`ghcr.io/ptero-eggs/yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8`
and common WineMono9.1.0 published SHA256
`8a0a1e6837b494df49927e5d759b1c6908e89b8a2f8e3ad025e1c2881882476e`.
The pinned Wine source digest provenance is
https://github.com/wine-mirror/wine/blob/wine-9.8/dlls/appwiz.cpl/addons.c .
Microsoft/font license acceptance and image-pinned Winetricks validation remain
separate prerequisites; pinned source/runtime provenance is not game acceptance.

All three remain not_verified pending actual binary/layout/INI precedence,
Linux/Wine compatibility, ports/query, console/admin/mod behavior, save/reload,
reinstall and normal stop/cleanup evidence. No client join or gameplay was tested.
