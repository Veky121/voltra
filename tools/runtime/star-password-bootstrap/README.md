# StarRupture native password bootstrap — source checkpoint

This is an implemented UE4SS Lua mod, not a standalone password encoder.
It calls `CrDedicatedServerSettingsComp::SetPassword` and
`SetPlayerPassword` through UE4SS's reflected engine invocation. The engine
performs its own conversion and native password-file handling. No key, RSA
implementation, private game SDK, remote password service, function address,
or guessed Unreal parameter offsets are supplied.

**Not native verified.** The existing ocean adapter and encrypted `Password.json`
and `PlayerPassword.json` import prerequisites remain unchanged. Nothing here is
installed or invoked automatically. The offline tests execute the real Lua mod
with an explicitly mocked engine; they cannot prove that a particular dedicated
server build loads UE4SS, exposes the reflected functions, or generates files.

## Exact binding and licensed route

The MIT ServerUtility pinned commit
`89cb8aa60304fe57edd385501b4ab568488ff25c`,
`src/hooks/set_password/set_password.h`, explicitly names the component and both
methods. Its `.cpp` documents the native `FString` input/return ABI but supplies
no executable addresses. Its hooks are not installed by `plugin.cpp`.

The MIT ModLoader interface pinned at
`168a9c75dc04b0b00ea0c8866df8769fff60d8d2` cannot validate reflected parameter
sizes. This implementation deliberately does not cast those unvalidated buffers
or add a guessed signature to the loader. No ServerUtility DLL is installed.

Instead, the MIT UE4SS published `v3.0.1` source commit
`d935b5b23bac03b65c14ae38382b02007204cc2e` documents the used APIs:
`FindAllOf`, `UObject:CallFunction`, `ExecuteInGameThread`, and
`ExecuteWithDelay`. Its `LuaUObject.cpp` reads reflected parameter counts,
return/property offsets and `FProperty` types, and converts Lua strings to
engine `FString`. The mod requires an actual `UFunction` for each requested
method before invoking either. Its lifecycle uses delayed retries followed by
explicit game-thread dispatch; searches and engine calls never occur in the
asynchronous timer. No UObject survives between callbacks. More than one live
component is a terminal error. The retry budget is 600 game-thread attempts.
This is not a wall-clock timeout if the engine thread stops dispatching.

UE4SS's published Windows x64 loader is an external prerequisite, not bundled
or downloaded by this task. A subsequent authorized read-only inspection of the
existing official cache verified `UE4SS_v3.0.1.zip` (5,523,402 bytes), SHA256
`4b47d4bceddd2f561a4e395bfa00924ccfc945af576a2d0c613e6537846c57ec`.
Its PE imports, member hashes and exact source association are recorded in
`artifacts/star-password-bootstrap-loader-inspection.json`; no DLL was loaded.
This is not game compatibility proof. Current
and v3.0.1 source trees refer to the `Re-UE4SS/UEPseudo` submodule, whose public
repository/commit/license URLs returned 404 in this investigation. Therefore a
complete reproducible loader source build is **not** claimed. No inaccessible
headers or generated game SDK were acquired. A future acceptance must pin and
inspect the actual legitimate loader artifact and its supplied notices; a
maintainer-compatible loader/build may be required for the supported game build.
The current main-branch delayed-actions API was investigated but is not required.

## Private input and caller contract

Install the exact `main.lua` as
`ue4ss/Mods/VoltraPasswordBootstrap/Scripts/main.lua`, under a game-UID-owned
mode-0700 mod directory, and add `VoltraPasswordBootstrap : 1` to UE4SS's
`Mods/mods.txt` without replacing operator entries. These are instructions for
the later approved isolated acceptance, not changes made by these tools.

`prepare.py` accepts a protected packet on inherited FD 0, never passwords in
argv or environment. FD 0 must be a pipe or an owned mode-0600 regular file.
Its sole argv value is the approved private mod directory. The Linux caller
must confine that directory to its owned server volume before invocation.
The bridge checks UID, mode, directory type and symlink ancestors and uses
`O_EXCL | O_NOFOLLOW` to publish a new mode-0600 `request.bin`; existing requests
are never overwritten. Windows staging fails closed rather than assuming Unix
mode bits are Windows ACLs. Linux mode/UID behavior was not exercised by the
Windows-only offline run.

Packet format: six bytes `VSPB1\n`, then two little-endian uint32 byte lengths
and their UTF-8 bytes, admin first/player second. `0xffffffff` means absent
(leave that native password alone); zero means an explicit clear operation.
Each value is bounded by the existing 4MiB API request ceiling (the packet allows
two such values plus framing). The original fields have `string|nullable` and no
short maximum. Tabs, CR/LF, DEL and other original characters remain accepted.
Malformed UTF-8, trailing/truncated data, embedded NUL and no-operation packets
are rejected before calls. NUL is an explicit limitation of pinned UE4SS's
`FString{...c_str()}` conversion, not an invented original password policy;
native support for it is not claimed. The existing ocean password prerequisite
does not call `text()`, so its CR/LF validation is not cited as a password rule.
The caller maps the unchanged original `ADMIN_PASSWORD` / `PLAYER_PASSWORD`
controls to explicit operations. It must not turn an omitted/unchanged value
into a password reset. The production secret-delivery/environment-clearing
integration is intentionally not enabled before native proof.

The mod consumes/unlinks the request before side effects, never replays it, and
does not stringify native exceptions or return values. Logs contain fixed status
codes only. Timeout/ambiguous/missing-API paths attempt request removal. A failed
unlink prevents any password call. A controller must additionally check request
absence and remove it after a stopped failed process. Lua strings and engine
allocations are not guaranteed to be securely erased from memory, nor does
unlink guarantee storage-sector erasure. A partial native call can update one
file before a later failure: no transactional native-success claim is made.

`methods_returned_pending_native_file_verification` means exactly that. It is
never a readiness/file-generation receipt. Neither Python nor Lua fabricates,
rewrites, or deletes native encrypted files. Future orchestration must snapshot
existing encrypted files and require explicit password changes, retaining exact
bytes/mode/UID/GID across unrelated operations and failed installs.

## Offline validation

Run `node tools/runtime/test-star-password-bootstrap.mjs` from the module root.
It compiles pinned official Lua 5.4.8 source using the existing local MSVC x64
toolchain, hidden, then runs 19 actual-Lua engine-mock fixtures, five Python
protocol/platform-boundary tests and four archive-boundary tests. It neither
builds nor loads UE4SS or the game.
The Lua source archive is locally archived/pinned; the runner never fetches or
installs a compiler/runtime. Dummy request files are removed after tests.
`artifacts/star-password-bootstrap-offline.json` records this run's limits.
Root later independently exercised five Linux nonroot UID988 private staging
tests; that separate evidence closes the POSIX staging boundary, not native
engine compatibility. See `NATIVE_PLAN.md` for the prepared, not-yet-authorized
native resource/build/loader/authentication/persistence/cleanup plan.

## Native first-boot acceptance — requires later approval

1. Under an ordinary isolated resource lease, pin the actual supported dedicated
   server build and licensed compatible UE4SS artifact/hash/notices. Do not assume
   the publisher's sunset build has a named legacy branch. Preserve operator
   plugins/config/native files and reject conflicting loader installations.
2. Load only this source-pinned mod with debug/verbose argument logging disabled.
   Supply fresh secrets over the protected input; assert no password in child
   argv/environment, log files, receipts, network requests, or public files.
3. Verify one live component and real reflected methods, actual engine-produced
   native JSON files, correct file permissions/ownership, and successful admin
   authentication plus player-password enforcement. A method return/file alone
   is insufficient proof.
4. Test both initial creation and explicit changes, Unicode and omitted roles,
   a clean stop/restart, unchanged passwords, failed/partial generation and input
   cleanup. Preserve existing bytes/modes/ownership on unrelated reinstall.
5. Only after review wire the scoped package/protected delivery into the existing
   adapter and remove the relevant prerequisite gate. No native action, lease,
   API resource, container, or service mutation was performed for this checkpoint.
