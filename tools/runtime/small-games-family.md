# Clone Hero, TachyonsCE, SuperTuxKart and MOHAA

These recipes keep the imported variable names and use the existing shared React
template form. Only `small-games-family-*` helpers belong to this work. Existing
`small-native-*` shared helpers remain owned by their original maintainers.

All native Windows child processes in these tools use `windowsHide:true`.
Runtime admission uses the common atomic seven-slot,20GiB RAM,128GiB disk queue,
including its20GiB public cache reserve. Public archive seeding copies verified
blobs into one stopped private volume; it creates no shared writable game trees.
An empty script-skipped bootstrap precedes the first real archive installation.
Reports label this as warm public-archive provenance, not a cold download.

## Distribution boundaries

* Clone Hero: official public standalone server1.1.0.6142, publisher SHA256.
  This is not an open-source server claim. No client or songs are installed.
  Root's native acceptance remains `runtime_partial`: normal CtrlC returned raw254.
  The official multiplayer wiki documents host chat commands, but no alternate
  standalone-console shutdown command was found. No repeat candidate was created.
* TachyonsCE: official public Community Edition1.0.2 bundle, independently hashed.
  Only its `server/` subtree is extracted; client and bundled Windows JRE are
  excluded. The publisher repository has no declared open-source license, so no
  binary/source patch or redistribution-right claim is made. The existing Java
  helper supplies supported Temurin8u504; this server uses Java8's Nashorn engine.
  Only reviewed1.0.2 is supported explicitly; unknown versions never fall back
  silently. Original100x100 universe settings are retained: smaller acceptance
  dimensions failed because publisher scripts reference fixed sector coordinates.
  Native startup, TCP registration greeting, console save/online, real saved
  universe reload and27-file exact reinstall retention passed. Normal `/exit`
  logs a completed shutdown but returns raw1; the report preserves that result.
* SuperTuxKart: official1.5 Linux package, publisher SHA256, GPL3 engine and open
  assets with their bundled per-asset licenses retained. Headless LAN mode uses
  no public account. The native discovery socket defaults to UDP2757, separate
  from the selected game allocation; automatic LAN discovery may require that
  additional fixed-port allocation. Native startup was automatically rejected
  before execution; the installed/unbooted candidate was cleaned and remains
  unverified. No alternate start was attempted.
* MOHAA: official OpenMoHAA0.82.1 GPL2 engine only. Original EA `main/Pak*.pk3`
  game files are operator-supplied. The old third-party revival fullgame bundle
  is never fetched. Missing assets cause an explicit preflight failure, not a
  synthetic success. Original CONFIG_URL/BASE_PATH/LOG_DIR, slots, map, name and
  password controls remain. OpenMoHAA's supported `fs_homepath` maps LOG_DIR to
  writable output; the closed engine's absent `fs_outputpath` is not emitted.

Primary references:

* https://wiki.clonehero.net/books/guides-and-tutorials/page/online-multiplayer
* https://github.com/clonehero-game/releases/releases/tag/v1.1.0.6142-final
* https://github.com/Davwyn/TachyonsCE/releases/tag/v1.0.2
* https://github.com/supertuxkart/stk-code/releases/tag/1.5
* https://github.com/supertuxkart/stk-code/blob/1.5/NETWORKING.md
* https://www.openmohaa.org/
* https://github.com/openmoh/openmohaa/blob/main/container/server/README.md

No report claims authenticated player connection, client assets compatibility or
gameplay. Root reviews and promotes profiles; this stager does not edit overrides.
