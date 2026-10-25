# Palworld modern UE4SS integration boundary

Supported public integration checkpoint, reviewed in `artifacts/managed-steam-palworld-proton-root-review.json`. The Windows dedicated server runs under the pinned Proton image with maintained MIT UE4SS (Git2281fa31), a private single `dwmapi=n,b` loader override, encrypted administration/join settings and shared Steam setup/Quick Setup UI. The helper itself only verifies/installs pinned loader files; game acquisition and launch belong to the typed managed Steam executor. Native execution, RCON/save/restart, real Lua/Blueprint-loader initialization, both Reinstall APIs and strict96-file retention were accepted and all disposable resources were cleaned. No client gameplay/crossplay admission or arbitrary C++ mod ABI claim is implied.

## Owned files and API

- `internal/panel/game_library/scripts/palworld-loader-install.py`
- `internal/panel/game_library/scripts/palworld-loader-pins.json`
- `tools/runtime/test-palworld-loader.py`

The installer imports existing `steam-template.py` read-only for its anchored, symlink-resistant publication primitives. Deploy that exact shared helper beside it as `steam_template.py` or `steam-template.py`. Deploy the pins JSON with its exact filename. The trusted node job must supply the reviewed archive from its existing verified content cache as a local file; the helper contains no downloader and never accepts URLs or credentials as arguments.

Python interface:

```python
receipt = loader.install(actual_server_volume, verified_local_archive)
requirements = loader.verify(actual_server_volume)
```

CLI, from the actual isolated volume, has only `install LOCAL_ARCHIVE` and `verify`. Output exposes only revision and `native_verified:false`. Errors identify actionable relative conflict paths, never secret config content. There is no arbitrary manifest, DLL, URL, version or native process argument.

The reviewed revision is `palworld-ue4ss-2281fa31-v1`, source commit `2281fa311e417b1dfddedbcd49972d764fddb244`, GitHub asset543339804, archive8,631,290bytes, SHA256 `f7543d57f8fdf5eab3731ac52121e6e7ff142fb3bfa17156e931037d0e44875b`. Its 21 regular members are individually pinned. The archive's MIT license is installed unchanged. No opaque legacy winmm bytes are embedded, copied or redistributed.

## Preflight and preservation

Before writes, the helper inventories legacy/competing proxies, root UE4SS/settings, Workshop-managed UE4SS, standard and configured mod roots, controlling order paths, all owned targets and state parents. It rejects DLL mods until matching modern ABI has been independently reviewed, rejects inherited `UE4SS_MODS_PATHS`, and rejects external/drive/symbolic paths. Unknown active core files, altered ownership receipts, changed managed core bytes and interrupted journals block launch/install instead of triggering vanilla fallback or automatic deletion.

Legacy root Mods/settings/proxies are **preserved and block automatic migration**, even if their Lua scripts might be compatible. The error directs the operator to explicit reviewed relocation; the helper never silently relocates or mixes the old tree with the modern layout. Existing modern Lua mods, custom configuration, mods.txt/enabled/load-order files, native PAK/Blueprint mods and saves remain byte-for-byte unchanged. Volume-relative alternate modern mod/order paths are inspected and retained; DLL ABI conflicts there also block before writes. Absolute Wine drive mappings are intentionally not guessed.

Fresh installs publish only reviewed `dwmapi.dll`, `ue4ss/UE4SS.dll`, `ue4ss/MemberVariableLayout.ini`, MIT license and absent seeds at the true executable-relative paths. All existing seeds/custom files are operator-owned after seeding and never overwritten. Settings and order seeds are0600. A complete matching private receipt controls core ownership; same-revision reinstall verifies and skips unchanged core. Unknown future revision receipts are refused until a new explicit upgrade manifest is reviewed; this source helper does not guess old ownership or install mutable latest releases.

The ZIP is hash/size checked before extracting into memory. It rejects traversal/absolute/drive/UNC/Windows reserved and alias paths, duplicate case-folded names, links/nonregular/encrypted members, unexpected or missing members and checksum mismatches. Bounds are512 members,64MiB unpacked and32MiB per file. All DLLs must have AMD64 PE headers and exact reviewed hashes. Nothing from the archive is executed by these checks.

Transaction state is confined to `.voltra/palworld-loader/`. Journals and per-transaction backups are0600; receipts contain public provenance/ownership, no game passwords or tokens. Existing ownership/mode is retained through secure publication; new leaves follow the actual volume UID/GID without blanket chown. The receipt is published after the active set, and the journal is committed last. Errors roll back already-attempted leaves, including failures after replace, restoring previous bytes/mode/UID/GID/timestamps or deleting only unchanged newly-created owned leaves. Conflicting/interrupted recovery preserves evidence and blocks native launch. Existing operator files outside the managed transaction are never deleted.

## Shared owner integration after native Linux work

`download_cache` retains ownership of current Palworld APIs/Go/configuration, signed node jobs, native Linux acceptance and original12-control parity. It may integrate this helper only after root approves the next native plan:

1. Keep current `steamPalworldProtonGap` and managed-job rejection unchanged until real acceptance. No claim of availability comes from installing/checking these files.
2. Reuse current typed Windows app2394010 platform selection and executable checks; pass the already-verified reviewed archive from the normal bounded cache into this helper only while that isolated owned server is stopped. Preserve WindowsServer config, original name/player/public-lobby/performance/password flags, Steam ownership/auth behavior, RCON stdin bridge and Shutdown5 semantics.
3. Call `verify` before every Proton launch and after installation/reinstall. A missing/altered receipt, core or conflicting loader is a hard error. Never catch it and launch vanilla. Native Linux must not acquire this dependency or inherit its environment.
4. The returned DLL override plan is exactly `dwmapi=n,b` for the private per-server Proton invocation. Do not set system/global Wine overrides, disable another operator loader automatically, or accept external environment mod roots. A second active proxy/Workshop UE4SS is an actionable conflict, not something to rename behind the operator's back.
5. Prove the pinned private prefix/Proton actually supplies MSVCP140, MSVCP140_ATOMIC_WAIT, MSVCP140_CODECVT_IDS, VCRUNTIME140, VCRUNTIME140_1, UCRT and required Wine Windows APIs. The helper reports these prerequisites; PE inspection does not verify runtime resolution. Do not download/execute Microsoft installers or autoaccept their licenses. Any genuine missing prerequisite needs an explicit supported plan.
6. Current fixed loader ships nested MemberVariableLayout and modern settings; do not force a historical engine version, inject obsolete signatures, enable cheat/admin mods, rewrite operator GUI/cache settings, or claim old C++ DLL mods remain ABI-compatible. Existing incompatible settings must produce an actionable runtime preflight result after real compatibility research, with original files retained.

## Native acceptance still required

After root authorizes a bounded isolated Proton plan, demonstrate actual Windows Palworld startup, one loader/core/GitSHA in real native evidence, correct engine layout and a server-only Lua fixture reading genuine Palworld/Unreal object state. Verify native Blueprint-loader initialization without inventing gameplay. Exercise RCON commands, real Shutdown5/child exit, real world save/restart, custom Lua/settings/order retention across reinstall, failure recovery and full owned cleanup under the normal weighted lease. Do not fabricate player joins. C++ mod ABI needs separate per-mod evidence before relaxing its explicit preflight gate.

16 offline fixtures currently pass, including the exact reviewed archive/license/PE layout, conflict-before-write behavior, configured alternate mod-root inspection, malicious ZIP cases, custom state preservation, partial/receipt/post-replace failure rollback and UID/GID/mode/timestamp retention. These tests execute no game, Wine, Proton or loader DLL. No Go/TS/global/native tests were run in this source checkpoint.


## Public availability and migration limits

The temporary unavailable/provider bypass was retired after independent native review. Ordinary shipping routes require connected Linuxamd64 Steam nodes advertising the reviewed Palworld bridge and Windows-platform capabilities; unsupported nodes still fail closed. Public anonymous Steam only: account/Guard/private-branch credential support remains a separate open compatibility gap. Existing legacy winmm/other proxy loaders and C++ DLL mods require explicit compatibility review; they are never silently deleted, replaced or bypassed with vanilla launch. No Microsoft installer is fetched and no license is automatically accepted.
