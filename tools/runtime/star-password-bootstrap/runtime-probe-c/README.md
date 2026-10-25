# Separate no-CRT Win32 probe — offline built, never executed

This is the reviewed source/offline implementation of `runtime-probe/
C_ALTERNATIVE_PLAN.md`. It does not establish that Go caused the previous fault
or that this probe will work in Wine. Both Go native failures, diagnostic mapping,
logs and cleanup remain unchanged. No Windows binary, Wine command, loader/game,
installer or utility lease was executed/admitted for this build.

The exact reviewed manifest is immutable SHA256
`e911e1824b3920133026103f05a8718e0884869ed60584251fcded775fd1df68`, copied
from the Go probe. `generate.py` rejects drift and emits29 fixed library tables
covering all655 unique named/ordinal exports. The original PE parser is reused
read-only; its fixtures cover real thunk shapes, ordinal and delayed imports.
Actual reviewed modern loader PEs have no delayed-import libraries.

`probe.c` has a plain `probe_entry` and imports exactly eight Kernel32 APIs:
GetCommandLineW, GetStdHandle, WriteFile, OutputDebugStringW, LoadLibraryExW,
GetProcAddress, FreeLibrary and ExitProcess. It has no C runtime startup/library,
Go runtime, TLS initializer or constructors. Header/import libraries come only
from the installed Windows SDK; vendor source/libraries are not bundled here.
The new source and generated fixed factual tables are MIT; no Go runtime is
linked, and no Go notice is substituted for this binary's MIT notice.

The executable refuses extra arguments. It examines only the OS executable token
to reject arguments, never interpreting that token as a path. It reads no
environment, configuration, external manifest, passwords or runtime paths.
Real DLL requests are fixed absolute System32 paths; API-set contracts use the
OS virtual namespace. Every request uses LOAD_LIBRARY_SEARCH_SYSTEM32 including
transitive dependencies. No UE4SS/game/proxy DLL is loaded and no resolved export
is invoked. System DLL initializers may necessarily execute when dependencies
load. Static output buffers are512 bytes/wide characters; generator/fixture bounds
cover every possible fixed status/name line.

Statuses: `VOLTRA_STAR_C_PROBE_MAIN_ENTERED`, missing library/export rows, then
`VOLTRA_STAR_C_RUNTIME_IMPORTS_READY` only when every lookup succeeded. Exit0
requires all lookups; missing dependencies exit1; malformed commandline/internal
bounds exit2. Output is sent both to stdout and OutputDebugStringW. A future
run must independently require actual MAIN+READY+raw0; no marker/file/build is
native dependency proof. Argument handling is source-reviewed and compiled only,
not claimed as executed Windows test coverage.

Build/review command:
`node tools/runtime/star-password-bootstrap/runtime-probe-c/build.mjs`.
It uses existing MSVC19.44/SDK10.0.26100 x64, `/TC /O1 /Oi- /GS- /Zl`, and
link `/NODEFAULTLIB /ENTRY:probe_entry /BREPRO /INCREMENTAL:NO` with kernel32.lib
only. No compiler/dependency download, license opt-in or vendor redistribution.
No CRT helper fallback is permitted: an unresolved helper fails linking.

The build runs four actual generator policy fixtures plus three PE parser
fixtures, builds twice and compares whole-file hashes. Static verification then
checks AMD64 PE32+, exactly eight allowed imports from kernel32.dll, no delayed
imports/CRT/Go/TLS directory, actual executable entrypoint in .text matching the
`probe_entry` linker maps, and every fixed request/export literal in the binary.
It does not execute the binary or either test an imported Windows function.

Artifacts: `.local/star-password-bootstrap/runtime-probe-c/` holds both identical
executables, object/map files, fixed output and MIT `LICENSES.txt`.
`artifacts/star-password-bootstrap-c-probe.json` records exact hashes, flags,
tool/header/import-lib provenance, fixtures, PE/TLS/map evidence and limits.
Sources/build hashes must be handed to root for review before any separately
authorized native probe. Production Star image/pins/gates remain unchanged.
