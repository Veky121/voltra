# Star loader system-import probe

This separate MIT probe reuses the source/build design from
`tools/runtime/palworld-runtime-probe`; no Palworld source, bundle, or runtime
was edited. `generate-imports.py` reads the exact approved modern Star loader
ZIP/PEs as data and embeds **all655 unique imported exports from29 libraries**.
Both named/ordinal imports and delay-import descriptors are parsed. The reviewed
actual files contain no delay-import libraries. Synthetic PE tests exercise
named, ordinal, delay and invalid-address cases.

Archive SHA256:
`b9a166a756605b21058a64cde93bcaab1a855dba3553e5c7e6ce0fa8fdfad7b9`.
The per-PE hashes, actual import symbol lists and exact source commit
`8333063595fa3c49ad307f3b0f732accbb760d25` are in embedded `imports.json`.
This manifest is compiled into the executable, never read from a runtime path.

The executable accepts no arguments, paths, passwords, commands or external
manifest. It loads only absolute `C:\windows\system32\<name>` dependencies;
API-set contracts use their virtual OS namespace. Both routes use
`LoadLibraryExW(..., LOAD_LIBRARY_SEARCH_SYSTEM32)` to exclude the executable,
current directory, PATH and user DLL directories, including for transitive
dependencies. It checks every named/ordinal export using GetProcAddress, then
releases the system module. It never loads the inspected `dwmapi.dll`, UE4SS,
game DLLs/executables, a mod or an MS installer. Windows/Wine system DLL
initializers necessarily execute when those system dependencies are loaded.

Output contains fixed statuses and embedded public library/export names, both
stdout and OutputDebugStringW for detached-console/Wine diagnostics. Sorted
library order is deterministic. Completion requires the actual
`VOLTRA_STAR_PROBE_MAIN_ENTERED` and `VOLTRA_STAR_RUNTIME_IMPORTS_READY` markers
and process exit0. Missing libraries/exports produce explicit messages and exit1;
invalid inputs/internal manifest produce exit2. Failure before main is a probe
runtime/bootstrap failure, not evidence that the655 dependencies were checked.
No functions resolved from the manifest are called.

## Offline build and tests

Run `node tools/runtime/star-password-bootstrap/runtime-probe/build.mjs` from
the module root. It uses the already installed local Go1.25.5, standard library
only, GOPROXY/GOSUMDBoff/CGOoff, windows/amd64/v1, trimpath/buildvcsfalse and empty
build ID. No compiler/dependency/runtime acquisition occurs. It regenerates the
fixed manifest from the approved immutable cache and rejects any drift, runs
three Python PE parser and three pure Go policy/manifest/export fixtures, then
builds twice and compares hashes. Tests never call probe main or load a game/
UE4SS library. All Windows child processes are hidden.

Output: `.local/star-password-bootstrap/runtime-probe/star-runtime-probe.exe`,
`LICENSES.txt` (MIT source plus Go's BSD runtime notice), and `bundle.json`.
`artifacts/star-password-bootstrap-runtime-probe.json` records hashes, compiler,
flags, fixture results and the **native-not-run** boundary. The source reuse
baseline is Palworld main SHA256
`7a6d936551d42338a56aea41220914e1259edcbda36c00aa5696fa48f89962a9`,
tests `086ab83ed8dd1bcf36de5d38c4d89076dcd184e20495597b7fc3c4900df3aa58`.
Star adds stricter transitive System32 confinement, deterministic output ordering
and validates all embedded symbols before loading anything.

## Proposed ONE bounded dependency run — root review required

No utility lease or native probe has been run. After source/root approval, request
ordinary **1024MiB RAM /4096MiB disk /zero ports** utility admission using the
current protected batch receipt and ordinary weighted pool limits. Never hardcode
a node ID or acquire while waiting. Only owned utility resources; no Panel server
or production changes. Revalidate the exact reviewed source/binary/manifest hashes
before launch.

Expected exact current Star image is the source-pinned
`ghcr.io/ptero-eggs/yolks@sha256:eedeb0ff1684592ee0f28119d7111f7ba14488dfa9537c99689dfe7a33ba2553`.
**Read-only local image inspection returned NoSuchImage.** No pull or substitution
was attempted. Root separately authorized read-only inspection of cached WineLatest
`ghcr.io/ptero-eggs/yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8`.
Under ordinary128MiB/1024MiB/zero-port utility admission, a nonroot65534 container
with networknone/read-onlyroot ran only Linux `wine --version` and read the exact
image entrypoint/OS release. It reported Wine11.0 on Debian13.5/Trixie, exit0,
no prefix creation, Wine/Xvfb/xvfb-run already present. The utility is removed and
its lease released. No Windows executable, loader DLL, MS installer or game ran.
Entrypoint SHA256 is
`0f588eb70155e6d408376dbbd313b7d54466e509d33a4c21f65d83e930eef733`;
it contains the stock raw Steam updater, Winetricks/MSI loops and eval startup,
which the proposed utility bypasses completely. Production typed-Wine/Steam
derived hooks must continue suppressing those raw paths for future game use.

Source-only candidate-base proposal: db48 is a suitable cached *dependency-probe
candidate*, not a tested Star game image. Do not replace production image/pins
or execute the Windows probe until root approves that exact base for the probe.
`artifacts/star-password-bootstrap-wine-image-inspection.json` records the
limited version/source result and cleanup. The Star and current Palworld import
lists are exactly equal29/655; that is not implementation or game compatibility.

If root approves that exact cached candidate base, the proposed single run is:

* Use an isolated receipt-owned directory with private HOME/WINEPREFIX, win64,
  bound to one utility container. Mount only the probe/notices read-only; do not
  mount the UE4SS ZIPs/DLLs, game payload, operator volumes, credentials, Docker
  socket or user directories. Image `--pull never`, `--network none`, no ports,
  read-only root, bounded temp storage, no-new-privileges/cap-dropALL and1CPU.
* Bypass the stock image entrypoint using the exact reviewed `/bin/bash` launch
  path so it cannot run AUTO_UPDATE/Winetricks/MS installers. Set private
  WINEPREFIX/WINEARCHwin64, `WINEDLLOVERRIDES=mscoree,mshtml=` (disable automatic
  Mono/Gecko), `WINETRICKS_RUN` empty, no runtime-license opt-in, and narrow
  `WINEDEBUG=+debugstr` diagnostics. No network is available for downloads.
* Launch the harmless executable once under the cached Wine/Xvfb already in that
  image. A fresh prefix may initialize builtin Wine system files only. No
  wineboot/MSI/Winetricks/Steam/game/UE4SS command or loader DLL is supplied.
  Use a bounded180-second wall-clock watchdog; record actual PID/process state,
  exit, OOM status, stdout/debugstr markers and all missing-library/export rows.
  Gracefully terminate only this utility if it exceeds the bound; do not
  automatically retry with changed libraries/environment/image.
* Result is narrowly **system import availability in this exact bare private
  Wine prefix**. Missing VC runtime is an expected honest finding without an
  explicit prerequisite install; a success does not prove UE4SS initialization,
  game compatibility, native passwords, authentication, saves or gameplay.
* Stop/verify owned process termination, remove the exact utility container and
  confined private prefix/directory, verify absence and release the lease. Keep
  a public secret-free result/cleanup artifact. A policy rejection ends the
  rejected action, with no alternate mechanism.

The default production encrypted-file import/gate remains unchanged regardless
of this dependency probe's result. Further Wine/runtime installation or native
bootstrap still needs its separate reviewed scope.
