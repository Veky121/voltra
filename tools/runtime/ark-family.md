ARK family source checkpoint
============================

Generate `.local/ark-family/profiles.json` with
`node tools/runtime/stage-ark-family.mjs`. Run
`node tools/runtime/test-ark-family.mjs` and
`go test ./internal/panel -run '^TestArk|^TestTemplatePrivateWineOwnership$' -count=1`.
Root owns merging, native claims and verification promotion. This family never
merges overrides or promotes itself.

Exact imported scope
--------------------

- `ark_survival_evolved/egg-ark--survival-evolved.json`, original13 fields,
  app376030 and native Linux `ShooterGame/Binaries/Linux/ShooterGameServer`.
- `ark_survival_ascended/egg-ark-survival-ascended.json`, original13 fields,
  app2430930 and Windows64 `ShooterGame/Binaries/Win64/ArkAscendedServer.exe`.
- `pixark/egg-pix-a-r-k.json`, original14 fields, app824360 and Windows64
  `ShooterGame/Binaries/Win64/PixARKServer.exe`.

All40 original API/form controls remain. Original implicit Steam account/auth,
branch/password, install flags and platform selectors are also explicit fields.
Anonymous public tool acquisition uses the reviewed shared Steam helper, including
cold-cache metadata refresh, validated required binary and manifest/depot/build
receipts. Private account and beta-password transport remain unavailable and
fail before spawning. Arbitrary Steam INSTALL_FLAGS are retained as an explicit
unsupported field, with typed branch/platform alternatives. Proprietary mutable
Steam depots are not misrepresented as SHA-pinned archives.

Both Windows games use a pinned Wine host. ASA reuses the existing private
GE-Proton helper, unchanged, with its publisher SHA256/SHA512-pinned archive,
bounded extraction and unchanged distribution licenses. No game or compatibility
archive was downloaded in this source batch. Actual game compatibility is
unverified. PixARK retains its Wine debug/architecture/path/XVFB fields.
The exact root-approved `voltra_ark_wine` feature preserves WINETRICKS_RUN in
VOLTRA_ARK_WINETRICKS_RUN and clears only the derived stock entrypoint value.
Other Wine recipes retain their existing behavior. PixARK's original
vcrun2019/dotnet6 prerequisites need a legitimately prepared private prefix and
explicit operator readiness setting; they are not automatically installed or
claimed verified merely because an INI or prefix exists.

Runtime/control behavior
------------------------

The single family helper types native Unreal URL parameters and argv, preserving
ASE map/Workshop/automanagedmods/public branch/BattlEye/extra flags, ASA
map/PvE/URL extras/flags/CurseForge IDs, and all PixARK original fixed launch
settings. ASA `-dev` unpublished mod selectors follow the publisher developer
documentation; authorized clients must have publisher test access. No access is
created, bypassed or fabricated. Extra managed listener/identity overrides and
Unreal URL metacharacters fail explicitly instead of changing native syntax.

ASE has four listener roles including primary+1. ASA has three by default, with
an optional additional query override. PixARK needs five because the publisher's
query listener also uses query-minus-one. Automatic defaults use primary+2 for
PixARK query, leaving primary+1 for that companion. A non-default explicit query
must separately reserve its preceding port, with no overlap with game/RCON/cube.
Generic UI metadata reserves primary+1; a relocated query pair can therefore
require another allocation beyond the five-port minimum. Native validation
rejects missing/overlapping roles before update/config mutation.

GameUserSettings.ini uses native shared INI patching with private backups,
retaining comments, unknown settings and repeated unmanaged arrays. Explicit
existing INI bytes, mode and timestamps are protected across Steam update
success/failure. The updater never removes worlds, movies, mods, logs or prefixes.
ASE's automatic-mod SteamCMD has a real original directory layout and its
Steam/steamapps mapping, so native relative paths do not point through a relocated
directory symlink. Existing operator bootstrap folders are retained.

Console and readiness use bounded authenticated native Source RCON. Readiness
requires a real ListPlayers response, with no fabricated player. Multipart reply
frames are bounded. Stop sends SaveWorld, retains ASA KeepAlive, then DoExit and
waits for actual process termination. Failed/timeout shutdown reports save state
unconfirmed and returns failure. Only exact current-UID native executables under
this server's volume are eligible for Windows process cleanup. Credentials are
redacted independently for stdout, log and console streams.

Evidence and remaining work
---------------------------

Twelve offline fixtures cover exact edition argv/control behavior; mod namespace
and ordering; native config retention; invalid paths/ports/syntax; genuine TCP
frame fragmentation/auth failure/exit disconnect; private Steam early failure;
interrupted-update exact metadata retention; original ASE SteamCMD layout; Wine
prerequisite gates; foreign process exclusion; and two real tiny Python process
fixtures exercising SaveWorld/DoExit and ASA KeepAlive order. Those Python
protocol/process fixtures are explicitly not native ARK/gameplay proof.

Focused Go tests cover all default rules, explicit real-password requirement,
generic allocated port layout and scoped derived Wine behavior, including the
unchanged legacy/private-mono cases. Original-control/current-embedded-helper
audits pass. No ARK native install, startup, query, mod load, save/reload,
reinstall lifecycle, real-client or Windows compatibility proof has run. All
three remain not_verified; no native resources or queue leases exist. Large
disk/memory defaults are honest planning limits, not measured native receipts.

Primary provenance
------------------

Exact imported recipe revision:
https://github.com/pterodactyl/game-eggs/tree/c637a6d1e0449b167efeff81bb9a0177aa3df6c2

Original source SHA256 identities are carried in each staged upstream_sha256
and original catalog snapshots in `.local/ark-family/*-original.json`.

Publisher PixARK guide, SG_Aech, original2018/updated2018:
https://steamcommunity.com/app/593600/discussions/0/1697168437881708051/

Publisher ASA developer mod testing and entry-map settings:
https://devkit.studiowildcard.com/getting-started/testing
https://devkit.studiowildcard.com/getting-started/ugc-settings
https://devkit.studiowildcard.com/changelog

Valve standalone server/SteamCMD guidance:
https://help.steampowered.com/en/faqs/view/5E9C-65C2-C968-98DC
https://developer.valvesoftware.com/wiki/SteamCMD

Compatibility distribution source and licensing:
https://github.com/GloriousEggroll/proton-ge-custom/releases/tag/GE-Proton11-9
https://github.com/ptero-eggs/yolks

Publisher server/client assets, Steam terms and individual mod licenses remain
with their publishers. No native game assets, original client assets or real
credentials are included in the repository.
