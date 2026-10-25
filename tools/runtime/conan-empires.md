Conan and Myth of Empires source checkpoint
==========================================

Generate `.local/conan-empires/profiles.json` with
`node tools/runtime/stage-conan-empires.mjs`. Verify with
`node tools/runtime/test-conan-empires.mjs` and
`go test ./internal/panel -run '^TestConanEmpiresStagedDefaults$' -count=1`.
Root owns merge, native acceptance and promotion. This stager never changes
shared overrides, restores excluded eggs or promotes itself.

Exact scope and original behavior
--------------------------------

`conan_exiles/egg-conan-exiles.json` retains all10 original variables and
Windows app443030 through pinned Wine. Original name/password/ports and native
log following remain. Additive private admin/RCON controls do not replace its
original fields. Generic root-owned `voltra_typed_wine` retains the original
Winetricks request in VOLTRA_WINETRICKS_RUN while disabling only the derived
global entrypoint action. The scoped runtime accepts only original vcrun2022
and corefonts requests and requires a legitimately prepared confined prefix,
operator readiness and actual requested DLL/font presence. Presence checks are
not license, authenticity or native compatibility proof. No arbitrary
Winetricks command or external agreement is executed automatically.

`conan_exiles/egg-conan-exiles-enhanced.json` retains all12 original variables,
native Linux server, mods, update flags, admin password and optional independent
RCON. Current publisher documentation explicitly confirms the Linux server.
Blank SERVER_PASSWORD preserves original native password configuration, matching
the imported conditional argument. Native INIs, unknown gameplay, repeated
unmanaged arrays and manual mod settings remain, with private changed-config
backups and independent secret redaction.

`myth_of_empires/egg-myth-of-empires.json` retains all15 original variables and
Windows app1794810 through unchanged SHA-pinned GE-Proton11-9. Both original
maps, game/admin identities, PvP/max players, stable world/server and cluster IDs,
extra native flags and the original private shutdown service/key remain literal
typed arguments. Original PROTON_USE_WINED3D=1/PROTON_NO_ESYNC=1 remain.
OUT_ADDRESS is additive and supports reachable IPv4; blank retains original
SERVER_IP fallback. Publisher private-server flags are preserved, with no
invented Steam login transport or account bypass. Changing SERVER_ID selects
different world archives, so the adapter never changes it on its own.

The original single-server recipe does not install or simulate the publisher's
separate full scene/lobby/peripheral cluster/database stack. Its private
shutdown wire protocol is not assumed to be Source RCON. Console keeps native
stdin and original Ctrl-C forwarding. No fabricated remote-management or save
result is returned. The readiness observer requires the selected server's
publisher SERVER_STATE_OPENED marker, rather than the old early Starting Game.

Original implicit Steam account/auth/platform/public branch/private beta and
INSTALL_FLAGS fields are explicit generic-form fields. Public anonymous tool
downloads use shared validated Steam acquisition and actual manifest/depot/build
receipts. Private transport and arbitrary INSTALL_FLAGS fail explicitly; no
private credentials are sent or substituted. These proprietary mutable depots
are not represented as immutable SHA-pinned game archives.

Mods and preservation
---------------------

Enhanced MOD_IDS accepts original comma-separated numeric IDs and spaces after
commas; UPDATE_MODS controls public acquisition independently of AUTO_UPDATE.
All selected items must report download success. Failed entitlement/CDN/mod
downloads remain failures; no account fallback or mirror is invented.

Publisher .pak names and sidecar names remain unchanged. Original unpacked
custom mod folders are auto-discovered. Existing manual modlist comments/order
remain. Only unchanged receipt-owned obsolete files are archived; edited,
untracked or identical pre-existing operator assets never become newly owned.
Original generated internal Workshop directory links can be adopted only when
their exact confined target is a known cache. Foreign links and path escapes
fail. Workshop caches are retained for reuse instead of broad recursive deletion.

The original extracted-cache cleanup is retained safely. Before/after snapshots
claim only matching cache files created/changed during the owned native run.
On mod removal, unchanged receipt-proved cache entries are archived. Unknown,
pre-existing, ambiguous-name or operator-modified caches remain. Cache hashes
are provenance for cleanup only, not proof of successful mod loading.

No world DB or mod generation is silently migrated. Current publisher notes
identify native lowercase Linux DB names, game.db/game_0.db migration, stale UE4
Engine.ini build-ID overrides and new Enhanced Workshop IDs. Operators retain
their data/backups and choose matching branches/clients/mods. Source fixtures
verify exact preservation, not successful publisher conversion.

Existing native INI bytes, mode and timestamps survive Steam updates, including
interrupted updates. The adapter never rewrites worlds, mods, database saves,
historical logs or private prefixes as installer defaults. Native Conan query
startup is an initialization marker, not a player/login/persistence proof.
Optional authenticated Source RCON uses the existing bounded shared transport;
enabled shutdown sends the Conan command, with no invented SaveWorld call.
Otherwise original native Ctrl-C is forwarded to only owned native processes.
Timeouts return failure and report persistence unconfirmed.

Evidence boundaries
-------------------

Fourteen offline fixtures cover every original native role/argument, optional
credentials, MoE maps/IDs/service key, unknown native INI retention, preserved
blank Enhanced password semantics, actual update-failure metadata retention,
mod order/sidecars/custom assets, owned removal, extracted-cache retirement,
legacy link safety, private/incorrect-platform early failure, allowed Wine
prerequisites and one real tiny Python SIGINT/readiness process fixture.
That Python process is explicitly not a Conan game or native acceptance proof.

Focused Go defaults/ports/generic typed-Wine integration and original-control/
current-embedded-helper audits pass. No game install/startup, real Workshop
download/mod load, RCON/game query, native save/reload/reinstall, Windows
compatibility or player gameplay has been proved. No game/Proton download,
resource claim, API/account change, production build or service action occurred.
All three profiles remain not_verified with no native resources to clean.

Primary provenance
------------------

Imported catalog revision and per-recipe upstream_sha256:
https://github.com/pterodactyl/game-eggs/tree/c637a6d1e0449b167efeff81bb9a0177aa3df6c2

Original public image mod/control implementation, MIT notices preserved in the
source archive under `.local/conan-empires/image-entrypoint-pinned.sh`:
https://github.com/pterodactyl/yolks/blob/43387e67780e54ed7b1f9ef9ebf7e4be910707b3/games/conan_exiles/entrypoint.sh
Source SHA256 f1f24bf1d829ce9c8dc2dea3a2856184f6b1ceaa66ef50753a9ce4d841ef5071.

Funcom original dedicated-server settings and native port roles:
https://www.conanexiles.com/dedicated-servers/

Current developer Enhanced native Linux, migration, mods and settings:
https://exiles-enhanced.inflexion.io/servers/linux/
https://exiles-enhanced.inflexion.io/servers/ue4-ue5-migration/
https://exiles-enhanced.inflexion.io/servers/troubleshooting/
https://exiles-enhanced.inflexion.io/modding/uploading/
https://exiles-enhanced.inflexion.io/servers/settings/

Publisher Myth of Empires single/cluster setup and archive-ID semantics:
https://www.mythofempires.com/newsall/2024/0220/556.html

Pinned compatibility distribution, whose existing helper is reused unchanged:
https://github.com/GloriousEggroll/proton-ge-custom/releases/tag/GE-Proton11-9

Source snapshots, exact recipe origins and final source/stage SHA256 are recorded
in `artifacts/conan-empires-source-handoff.json`. Proprietary publisher game and
original client assets, real credentials and third-party agreements are not
redistributed by this adapter.
