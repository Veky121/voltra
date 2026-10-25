# Isolated acceptance fixture — acquired, first boot pending source review

MIT source. Imports and the freeze command execute only offline tests. Explicit
native-controller phases now provide owned admission/acquisition/verification and
a separately reviewed one-shot boot. No implicit action occurs on import.
The canonical ocean adapter and encrypted-password prerequisite are unchanged.

`fixture-pins.json` records the independently inspected modern experimental
UE4SS release, exact official Star UE5.6 config, MIT notice, owned engine-thread
Lua and separately reviewed cached Wine11 digest. It does not assert game
compatibility. Both earlier Go probe failures remain evidence; the no-CRT C
29-DLL/655-export pass establishes lookups only, not implementations.

After root approval and ordinary 8192MiB/40960MiB admission, a controller must:

1. Resolve current protected node receipt and ownership; baseline and reserve
   allocated game ports normally. Do not hardcode node identity or lower limits.
2. Stage existing verified public SteamCMD cache with the shared cache tooling.
   `acquisition_plan` reuses shared Steam typed arguments for anonymous Windows
   app3809400, metadata before update, public branch, validate. Execute through
   the shared installer/update and real manifest validation, not handwritten ACF.
   Recheck build25642172, main3659990775896995763 and shared5753583882400741046
   against real installed receipts; stop on drift/NoSubscription/dependency error.
3. Use the existing ocean adapter typed Star DSSettings configuration with only
   nonsecret original controls (SESSION_NAME, SAVE_INTERVAL, START_NEW, LOAD_SAVE,
   SAVEGAME_NAME, allocated SERVER_PORT). Its password inputs stay absent: this
   isolated fixture transports the requested original passwords independently,
   rather than weakening the canonical prerequisite. Do not fabricate a world,
   encrypted JSON, Steam identity, native admin authorization or EULA acceptance.
4. Validate actual AMD64 PE at
   `StarRupture/Binaries/Win64/StarRuptureServerEOS-Win64-Shipping.exe` through
   `launch_plan`; record actual installed engine/build and binary SHA before use.
   `assets` validates immutable cached ZIPs then selects only dwmapi.dll,
   ue4ss/UE4SS.dll, MIT notice, exact Star settings/signature and our Lua mod.
   `install_assets` refuses any existing target rather than overwriting mods.
   Require nonroot ownership and private0700 mod directory (all ancestor symlinks
   rejected); do not silently chmod arbitrary operator directories into ownership.
5. Bypass stock image entrypoint entirely, use `--init`, exact reviewed Wine11
   image, private win64 prefix and the generated allowlisted environment. There
   is no Winetricks/Microsoft/Mono/Gecko installer or runtime-license opt-in.
   Native argv is fixed xvfb-run/-a/wine plus canonical Star -Log/-Port and both
   remote-control-disable flags. This exact payload/layout/loader search path
   still requires actual validation once acquired; no assumed engine binding.
6. Read a protected inherited pipe/owned0600 FD via `protected_input`; packet
   format is existing VSPB1, original nullable UTF8 values <=4MiB each, explicit
   empty clears, only NUL unsupported by actual c_str conversion. API max4MiB
   JSON is still an upstream ceiling, not expanded by this packet codec.
   The host enforces a4MiB aggregate packet limit (framing included) before codec
   decoding, and FD reads allocate at most4MiB+1byte. The older standalone codec's
   per-value bound does not permit an8MiB host request.
   FIFO read can wait indefinitely: a monotonic10s deadline (shorter injectable
   in fixtures) and optional cancellation event cover delayed bytes and missing
   EOF. Reads are nonblocking with select waits <=50ms. The caller must own the
   read descriptor exclusively during this operation; its original status flags
   are restored even on failure, and the original descriptor remains open.
   Partial packets are cleared on timeout/cancellation/invalid input. Production
   protected FD reading refuses Windows rather than using a blocking fallback.
   No secret argv/env/log. `run_once` creates exclusive0600 durable attempt marker,
   stages exclusive0600 request, supervises one bounded child and unlinks its own
   request on every terminal path. Existing request files are preserved. No replay
   after any attempt. Production process-group cleanup is POSIX only; Windows
   actual-child tests use hidden processes and do not prove POSIX ownership.
7. Lua waits for one live component and reflected methods, dispatches on engine
   thread, unlinks before invocation and emits fixed statuses. A600-attempt bound
   plus the host180s watchdog prevents indefinite bootstrap waiting. A frozen
   engine can prevent callback progress; host cleanup must still remove packet.
   Native logs stay private; captured output is redacted using shared Redactor.
   Missing-DLL signatures/nonzero/raw exit remain failures; no automatic retry,
   image switch or Microsoft installer. Even method-returned/raw0 is NOT proof
   of generated encrypted files, successful authentication or gameplay.
8. Before any gate change, independently verify actual publisher Password.json
   and PlayerPassword.json generation, no plaintext leakage, correct/wrong auth,
   world persistence/reload/reinstall and clean native stop. Partial native setter
   failure requires stopped encrypted-file restoration from protected baseline,
   never live rollback/replay. Full-world import/upload remains a separate need.

Offline fixtures run harmless Python children for raw7, timeout, output cap,
spawn failure, packet cleanup/no replay, missing-DLL diagnostic and redaction.
Windows orchestration tests explicitly mock only POSIX packet staging; Windows
fails closed at the real production boundary. Earlier actual nonroot Linux
private-staging tests remain separate proof. None executes Wine/game/UE4SS.

The current20-fixture suite also ran in existing local Ubuntu WSL with actual
Linux pipes, select/fcntl, delayed split data+EOF, a valid packet whose writer
never closes, an idle writer, cancellation and preserved FD flags. The WSL
launcher reported an existing getpwuid(1000) warning before successful Python
execution; it did not affect test outcomes. No container/utility/game resources
were created. Use `node freeze.mjs --linux-offline` to capture both platforms.

## Actual acquisition checkpoint (not a native boot)

The approved8GiB/40GiB lease is active; state is tracked separately in
`.local/star-native-acceptance/receipt.json`. The first Steam image launcher lacked
Python and exited127 before Steam. Root approved one launcher-only correction to
the reviewed Wine11 image. Steam then installed the exact publicWindows build
25642172/main3659990775896995763/shared5753583882400741046. The initial post-install
validator exited1 because shared depot identity lives in a separate228980ACF;
both original failures/source/logs remain. Root approved a pure validator fix and
one standalone verify-installed completion, which ran without Steam/login/update.
It resolves the exact SharedDepots228989→228980 link plus actual sharedState4,
manifest and size25674515. Original ACF bytes are preserved, never rewritten.

The actual expected shipping EXE is233178112B, SHA256
`3a0f160767b24a621a73b75dd6d43ae262ceef56127b340fef30860ef8041757`.
No ASCII UE branch marker appeared. Read-only RT_VERSION parsing instead found
one unambiguous FileVersion5.6.1.0/ProductVersion5.6.1.0; this matches configured
UE5.6 but does not prove object hooks. The native guard rechecks this exact PE
version, frozen EXE hash, live installed build and both native depot receipts.

The proposed first boot uses one protected input pipe, generated private random
passwords (not retained in host files), no public management/game port publishing,
typed disposable StartNewGame=true once, and no restart. It sends nativeSIGINT
at150s, with the full180s child watchdog and210s Docker-host fallback cleanup.
License prompts/import failures stop immediately. Raw child exit is persisted
before post-stop encrypted-file/log audits. Setter-returned is not auth proof;
actual correct/wrong admin/player authentication remains unresolved without a
legitimate supported client. No native first boot has occurred at this checkpoint.
