# Source-only diagnosis after first native binding failure

The first native run and its source freeze remain immutable. Its fixed error
`native_call_or_binding_failed` does not identify whether lookup, validity,
method resolution/type or invocation failed. Request absence alone does not
prove consumption: the guarded error path also unlinks the packet. Neither
encrypted file nor a save directory appeared. Wrapper0 is not child0: the
supervised child returned-2 after the scheduled SIGINT; no clean-stop claim.

The game log confirms actual engine5.6.1-127004+++Earth20+Neon and UE4SS log
confirms3.0.1Beta83330635. Main map and EOS session update completed, but neither
authentication nor world persistence was verified. A handled publisher ensure
in Mass static-mesh template construction also appears before the bootstrap
failure; temporal proximity does not prove a shared cause. Logs remain evidence.

## Separate source artifacts

* `diagnostic-main.lua` is a derivative of original main.lua SHA
  `0f0fe319de3abefca7af8ba57a326a20308945d64aa1c756e1ec7e89a4872e4e`.
  It preserves packet/setter semantics and adds literal progress codes immediately
  before/after component lookup, object validity, packet opening/unlink/decoding,
  both method resolutions, method type/validity, preinvoke object validity and
  native invocation. It never prints arguments, method-return values, exceptions,
  userdata or arbitrary type names. It is NOT installed or authorized to run.
* `readonly-main.lua` is the preferred next diagnostic candidate. It has no
  packet/file I/O, passwords, CallFunction, native UFunction invocation or setters.
  It only enumerates the component and inspects both method userdata through
  pinned UE4SS reflection wrappers. A600-attempt bounded game-thread scheduler
  reports constant enter/return codes, suppressing all caught error payloads.
  `read_only_surface_complete_not_native_call_proof` means metadata inspection
  only. It does not validate FString marshaling or native setter behavior.
* `test-diagnostics.lua` executes both candidates in actual stockLua with the
  engine explicitly mocked. Deliberate exception payloads contain sentinel
  secrets. Tests require their absence, exact last-stage discrimination, bounded
  scheduling, read-only zero calls/no I/O, and error-unlink without consumption.
  The trace variant also runs all19 original packet/engine-mock fixtures.

## Exact licensed API evidence

All source references below are from official MIT UE4SS commit
`8333063595fa3c49ad307f3b0f732accbb760d25`, independently archived and hashed in
`artifacts/star-password-bootstrap-candidate-source.json`:

* `UE4SS/src/Mod/LuaMod.cpp`: FindAllOf, ExecuteInGameThread and ExecuteWithDelay.
  Existing dispatch requirements are retained; no object is cached across retries.
* `UE4SS/include/LuaType/LuaUObject.hpp:185`: IsValid; `:647`: CallFunction delegates
  directly to call_ufunction_from_lua. No invented hook/SDK or handbuilt param ABI.
* `UE4SS/src/LuaType/LuaUObject.cpp:2241`: indexed reflected method lookup;
  `:1443`: FunctionPusher constructs UFunction userdata with its owning object.
* `UE4SS/src/LuaType/LuaUFunction.cpp:97`: type returns the fixed UFunction name;
  its callable metamethod and CallFunction both use the shared native marshaler.
* `UE4SS/src/LuaType/LuaUObject.cpp:93`: call_ufunction_from_lua determines actual
  UFunction/context, validates parameter count and marshals native property types.
  The generic first failure cannot establish which of these checks failed.

The observed binding surface remains ambiguous. No source change claims a fix,
engine-method existence or compatible native FString binding yet. No raw Lua
exception is required or permitted. No crypto/RSA extraction or SDK offsets.

## Proposed next native action — NOT authorized or implemented here

Request separate approval for ONE read-only90s diagnostic boot of the same
stopped owned namespace, under the existing ordinary8GiB/40GiB lease (or a new
normal lease if root releases it). Verify source/payload/loader pins again.
Snapshot existing config/mod enable markers first; disable the original bootstrap
mod without deleting its first-run receipts and enable only the read-only probe.
Use the canonical typed settings with StartNewGame=false and LoadSavedGame=false:
do not regenerate the intentional world or invent a missing save. No request,
password pipe, host ports, runtime installers or license opt-in. NativeSIGINT
and owned process-group bounds remain mandatory; raw stop outcome stays evidence.
If metadata inspection fails, return the last constant stage; no native setter
retry. If it passes, review exact marshaler/property metadata separately before
any further side-effecting trial. No silent switch to alternate call syntax.

## Implemented driver pending root review

`readonly-controller.mjs review` verifies the exact stopped container, active
8192MiB/40960MiB lease, image, original freeze/dependencies and diagnostic freeze
without starting a container. Its explicit `boot-once` phase has not been run.
It uses no stdin, published ports, acquisition or runtime installers. The host
watchdog is105s; `readonly-once.py` supervises the owned child group for90s,
requests SIGINT at75s, and records child raw exit separately from wrapper state.

The driver revalidates installed manifests, payload and loader bytes before
snapshotting DSSettings, .pteroignore and mod enable markers. It rejects existing
requests, probe directories, unknown enabled mods and nonempty mod registries.
It disables only the original bootstrap, installs the unique readonly mod,
uses the existing typed adapter with both world/load controls false, and restores
original bytes/modes on success, native failure or partial probe installation.
Private snapshots and restoration evidence remain in .voltra/star-readonly.
Only literal allowlisted progress codes and structured child state are exported.
No credential is supplied; unknown first-run random passwords cannot be audited
again. Raw native logs stay private and are not copied by the controller.

Independent offline commands: `python acceptance/test-binding-contract.py` and
`python acceptance/test-readonly-driver.py` from the bootstrap directory, or
`node tools/runtime/star-password-bootstrap/acceptance/diagnostic-freeze.mjs`
from the module root. Windows cannot exercise the real Linux process/ownership
boundary; the symlink fixture reports an explicit skip if host privileges deny it.

No staged diagnostic has been installed into the owned game volume or executed
in Wine. No existing world/config/enable marker has been changed by this work.
