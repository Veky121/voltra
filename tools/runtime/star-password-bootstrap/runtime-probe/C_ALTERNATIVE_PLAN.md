# Proposed no-CRT Win32 dependency probe — not built or run

Purpose: isolate the probe's runtime/bootstrap variable while keeping the exact
reviewed29-library/655-export contract and safe System32 resolution. This is a
proposal, not an assertion that Go caused the observed crash or that C fixes it.
Root review is required before implementing/building this alternative, and a
separate explicit approval is required before any native run. No acquisition,
new utility, build or launch of a C probe occurred in this investigation.

## Existing toolchain inspected as files only

The installed Microsoft Visual Studio2022 BuildTools x64 toolchain is available:

* `VC/Tools/MSVC/14.44.35207/bin/Hostx64/x64/cl.exe`, file version19.44.35229.0,
  677776bytes.
* `link.exe`, file version14.44.35229.0, 3252616bytes.
* `dumpbin.exe`, file version14.44.35229.0, 23376bytes.
* Windows SDK10.0.26100.0 `Include/.../um/Windows.h` and
  `Lib/.../um/x64/kernel32.lib` are present (7511 and311908bytes respectively).

No Clang/clang-cl/lld-link/MinGW gcc was found on PATH or in the checked common
LLVM/MSYS/MinGW install locations; that is not an exhaustive filesystem absence
claim. No tool was installed or downloaded. Tool versions were read from file
metadata; no C compiler/linker/alternative probe was invoked here. Use only the
already installed toolchain. Vendor headers/import libraries stay local and are
not embedded as source or redistributed in the repository. No Unreal/game SDK
or crypto implementation is needed.

## Concrete source and execution contract

Proposed new owned directory:
`tools/runtime/star-password-bootstrap/runtime-probe-c/`, containing `probe.c`,
`imports.h` generated from the already reviewed immutable PE manifest,
`generate-imports.py`, static fixtures/build script, MIT notice and provenance.
Output would live in `.local/star-password-bootstrap/runtime-probe-c/`.
Palworld and the existing Go probe/bundle/failures remain unchanged.

The C entry point would be a plain `void WINAPI probe_entry(void)` using only
Win32 Kernel32 imports: GetCommandLineW (reject extra args, never interpret a
runtime path), GetStdHandle/WriteFile, OutputDebugStringW, LoadLibraryExW,
GetProcAddress, FreeLibrary and ExitProcess. No CRT startup, C++ exceptions,
Go runtime, TLS constructors, filesystem manifest, environment configuration,
allocator, format library, SDK generation or custom DLL-loading input.

The fixed generated tables retain all655 named/ordinal exports from both exact
approved modern PE files, including zero actual delay-import libraries; parser
fixtures still test delay descriptors. Literal system DLL names use absolute
System32 paths, API-set contracts use the virtual OS loader namespace. Both use
LOAD_LIBRARY_SEARCH_SYSTEM32 for transitive confinement. No UE4SS/game DLL is
loaded. The probe resolves but never calls manifest functions, emits fixed/public
name statuses, and exits0 only after actual MAIN+READY plus all655 checks.

Use bounded static buffers and handwritten trivial ASCII/wide output conversion
and ordinal handling. No dynamic input is copied into them. Avoid large stack
frames, compiler-generated memcpy/memset helpers or security-cookie startup
dependencies. The compiler/linker must fail closed on any unresolved CRT helper;
do not add CRT libraries to make it build. Static PE inspection must prove the
final import table contains only the explicitly reviewed Kernel32 APIs.

Proposed offline build after approval: MSVC C mode `/TC /c /GS- /Zl`, fixed
source/SDK paths, then x64 linker `/NODEFAULTLIB /ENTRY:probe_entry
/SUBSYSTEM:CONSOLE /INCREMENTAL:NO /BREPRO` with only the installed `kernel32.lib`.
Choose code-generation options after checking emitted helper references, not
by adding hidden runtime imports. Compile/link twice and compare full binary
hashes and `.text`/entrypoint. Record exact compiler/linker/header/import-lib
hashes and flags. Do not execute the resulting Windows binary in offline tests.

Offline checks must cover actual PE manifest generation, named/ordinal coverage,
unsafe DLL/argument/name rejection, deterministic generated source and binary,
no CRT/Go/UE4SS import or TLS callback, expected x64 machine/entrypoint, and
System32-only policy. Preserve a map/disassembly for meaningful future crash
analysis. Distribute only the new MIT source/binary notices; no Go runtime is
linked into this proposed alternative.

Only if reviewed source/static checks pass would a later separately approved
single native run reuse the exact cached db48 Wine11 base, `--init`, nonroot
private prefix, networknone, ordinary1GiB/4GiB/zero-port utility, existing external
private32MiB log cap, unlimited inherited RLIMIT_FSIZE, bounded watchdog and exact
receipt cleanup. It would remain a runtime-import probe, never game/UE4SS/native
password proof. No MS installers or fallback attempts are implicit in this plan.
