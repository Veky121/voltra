# Stormworks, Carrier Command 2 and Archean source implementation

The `vehicle_sims` reservation covers exactly the three staged original recipes.
Generate `.local/vehicle-sims/profiles.json` with
`node tools/runtime/stage-vehicle-sims-profiles.mjs`; run fourteen network-free
fixtures with `node tools/runtime/test-vehicle-sims.mjs`.

All original variables, defaults and visibility/edit permissions remain. Original
Steam account/password requirements are conditional on INSTALL_MODE=steam;
app identity/platform and typed numeric bounds reject incompatible values.
No React component or shared helper was changed. All three remain not_verified.

INSTALL_MODE defaults to steam. Stormworks573090 and Carrier1489630 require a
legitimately owning account; current shared private Steam transport is unsupported
and fails before acquisition. It never substitutes an anonymous application.
INSTALL_MODE=operator_files provides an explicit supported installer path for
legally acquired uploaded original content. It checks Stormworks x64 PE server64.exe
and rom/, Carrier x86 PE dedicated_server.exe plus rom_0/, all three original x86
SDK DLLs and x64 ELF linux64/steamclient.so, or Archean x64 ELF server binary.
It records SHA256/size inventory separately in
.voltra/vehicle-sims/operator-files.json. This is structural validation, not
publisher authenticity, complete depot verification, license proof or runtime
acceptance. It never acquires, deletes or republishes operator assets. AUTO_UPDATE
revalidates supplied files in this mode, without Steam credentials or network.
The default Steam path retains original acquisition behavior where supported;
Archean3557220 is the publisher-documented anonymous Linux dedicated tool.

Stormworks retains the exact original XML world/DLC/weather/playlist template,
managed optional admin changes, seed/save identity and unrelated permissions/mods.
Carrier retains all original match controls, permissions, mod folders, private
win32 prefix and isolated SDK1007 handling. The original warning that the server
can load but cannot write match saves remains explicit. Archean retains all twelve
controls through native INI, original working directory and operator comments,
worlds/mods/admin data. Ports are two/four consecutive and one respectively.
All original Ctrl-C stops use the existing native console supervisor.

Exact original JSON archives under .local/vehicle-sims/upstream match catalog
commit c637a6d1e0449b167efeff81bb9a0177aa3df6c2. Public publisher references,
archive SHA256s and immutable container digests are in vehicle-sims-pins.json.
The existing upstream MIT license is retained; no proprietary binaries are
redistributed. Windows image provenance is public OCI metadata, not a local
native Wine test. Fixtures use non-runnable binary headers and mocked consoles.
No large acquisition/native claim/lease or service change occurred. Protocol,
Wine launch/stop, actual publisher content, save/reinstall and client gameplay
remain untested.
