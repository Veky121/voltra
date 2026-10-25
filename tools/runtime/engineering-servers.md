# Space Engineers, Torch and Nitrox source implementation

Owner engineering_servers reserved the three exact original recipes absent from
profiles. All50 original variables/defaults/visibility/edit permissions remain;
only Steam username/password requirements become conditional on INSTALL_MODE=steam
for Nitrox. Existing generic React setup, typed Steam, native-config, release
hashing/public cache and native-console helpers are reused. No shared core/UI file
was changed by this batch. Root independently implemented voltra_typed_wine to
preserve original WINETRICKS_RUN in VOLTRA_WINETRICKS_RUN and suppress the stock
image's pre-start shell loop. Existing voltra_steam_template suppresses its updater.
Both features are required for the SE/Torch profiles.

Run node tools/runtime/test-engineering-servers.mjs for16 network-free fixtures;
node tools/runtime/stage-engineering-servers-profiles.mjs creates the stage;
node tools/runtime/test-engineering-servers-profiles.mjs checks all original
controls and exact embedded helper source and compiles22 embedded Python modules.
Output .local/engineering-servers/profiles.json is root-merged only. All three
remain not_verified. No native leases/resources, game depot downloads, runtime
installation, protocol, client join, plugin load or save/reinstall evidence exist.
Fixtures use structural non-runnable binary headers and mocked consoles/processes.

Space Engineers preserves anonymous Windows298740 acquisition documented by its
publisher; the publisher page also discusses acquisition licensing prerequisites.
The Windows/.NET4.8 server is not a native Linux game. Typed isolated SteamSDK1007
supplies the original six32/64bit mod-support DLLs without placing its manifest in
game steamapps; SDK client copies and unknown operator DLLs are retained. The
exact upstream seed world and XML are pinned. Config/selected-world settings use
native XML with prevalidation; selected save folders are honored, unrelated saves,
Workshop mods/admin/ban/API security/unknown settings remain. New instances receive
random API key/salt instead of the public sample's secrets. Primary/Steam/RemoteAPI
ports require three distinct assigned allocations. Original vanilla console/path
and Torch -noupdate/-nogui/-console/Instance arguments are typed argv.

Torch is Apache2.0 upstream, exact current official Jenkins347 commit
17113701b141ab7151d12fc814c66ffd3b63082e, ZIP SHA256
b298f781e8d82cef366ad00285643a1684a2c7558418bca4a54e18a6f6fbba31.
Only this4.7MB public OSS archive and the2.1MB upstream world seed were fetched for
pin/provenance. No game binaries were fetched. Torch.cfg, Plugins/, configured
plugin list/local plugins, admins and modified program files remain operator-owned.
Archive publication prevalidates every entry, rejects links/devices/traversal/
duplicates, retains unknown/edited files, rolls back failed program publication
and claims receipt ownership only over published or previously-owned exact files.

The Wine image is immutable-pinned and public OCI/Dockerfile/entrypoint inspected.
Private confined win64 prefixes reject win32 without resetting them. Original
WINETRICKS_RUN default verbs remain, with an explicit Microsoft/font license
acceptance prerequisite and strict argv allowlist. Prerequisites install once per
successful prefix receipt. Original vanilla WineMono9.1.0 MSI SHA256 is pinned to
Wine9.8's own addons.c checksum, no MSI downloaded in this task. Microsoft runtime
acquisition uses the immutable-image Winetricks implementation and its checksum
checks; this is not native proof that Mono satisfies the publisher .NET4.8 API.
No host-wide Wine installation or custom image is required.

Nitrox1.8.1.0 is current publisher GPL3 Linux x64 alpha, SHA256 from GitHub's asset
digest12411e27754831564cd1fc01ced830b4a15bce1a1c3963ffee391050af62113c.
It was not downloaded. NITROX_VERSION latest maps this reviewed pin, explicit1.8+
versions resolve the exact publisher tag/architecture/digest; unavailable or
unhashed versions fail and never silently become latest. The original version
field remains. .NET9 target and image are retained, without claiming it is a
currently supported runtime modernization; actual pinned OCI installs /usr/share,
so DOTNET_ROOT is explicit. Debian12 Python is bundled only for this runtime.

Subnautica264710 is proprietary owned base game content. Original Steam
username/password/Guard fields remain, but the current private command parser is
unsupported and fails before acquisition. INSTALL_MODE=operator_files validates
legitimately supplied game PE/managed assembly/StreamingAssets. Independently,
NITROX_INSTALL_MODE=publisher downloads the exact verified OSS release, while
operator_files validates supplied compatible Linux server files. Structural
SHA/size inventory is separate from program ownership; it does not prove licensed
ownership, publisher authenticity, complete depot integrity or the declared
operator-supplied Nitrox version. No anonymous substitute is offered.

All original Nitrox controls use selected SAVE_NAME/server.cfg: admin/server
passwords, permissions, game/serializer mode, console toggle, player limit,
autosave and UPnP. Unknown hooks/seed/admin/world files remain. Original native
Subnautica installation/data/config paths and Ctrl-C supervision are retained.
Publisher says clients need matching supported game/mod release and notes alpha
limitations; no gameplay compatibility is inferred from configuration fixtures.

Exact original JSON archives match catalog commit
c637a6d1e0449b167efeff81bb9a0177aa3df6c2 in .local/engineering-servers/upstream.
Public primary references and immutable image/artifact identities are recorded in
internal/panel/game_library/scripts/engineering-servers-pins.json. Existing upstream
MIT recipe license is retained. Proprietary content is never redistributed.
