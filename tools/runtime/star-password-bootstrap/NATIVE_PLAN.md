# StarRupture bootstrap native acceptance plan

Status: **game/bootstrap phase prepared, not admitted or authorized to execute**.
The separately authorized metadata utility completed and was cleaned (see below).
No game payload or Wine/MS-runtime acquisition, game API resource or native game
process was created. Reviewed public UE4SS archives were acquired for static inspection.
The existing encrypted-file prerequisite and canonical recipe remain unchanged.

## Admission and ownership

Request one ordinary lease using the **current protected batch-node receipt**:
**8192MiB RAM, 40960MiB disk (40GiB)**, ordinary shared max-active/20GiB RAM/128GiB disk
including 20GiB cache reserve. Never hardcode a node ID: resolve its ID/UUID/root/
cache/volume paths from `.local/batch-node/private.json` and verify identity.
The metadata run observed node249 UUID33ba51df-f3ee-43f0-b927-1507d67f7dcc;
that is a receipt snapshot, not a fixed target for subsequent runs. At the
earlier reported root checkpoint, Romestead8GiB + K4.5GiB + SDK1GiB + probe1GiB left
5.5GiB; admission must wait. Re-read atomic ledger and actual node resources
before claiming; never raise limits or evict another job. The current reviewed
initial game budget is40GiB, matching the recipe's disk default. The earlier
24GiB proposal is retired and must not be admitted. Typed metadata puts the main depot alone
at21,349,240,119bytes (about19.88GiB), plus2,653,127,216download bytes, now-resolved
shared depot228989 (25,674,515installed/25,108,528download bytes) and the observed
bare private Wine prefix of about1.49GB.
40GiB leaves useful initial-install headroom, but resolve shared content before
acquisition. Two complete21.35GB program copies plus cache/prefix exceed40GiB:
do not begin such update/publication staging under this budget. Stop and return
for ordinary capacity/strategy review if any required phase cannot fit; no disk
or pool increase, fallback installer or game admission is implicit in this plan.

Use one isolated owned test server/volume/egg/nest/allocations and a private
win64 prefix. Record an authoritative baseline and ownership receipt before
resources. Reuse warm public SteamCMD only with its receipt/hash; no credentials
or private subscriptions. No original services, production frontend, Panel,
Wings, Docker service, existing games or operator data are restarted or edited.
Any Windows control subprocess must use `windowsHide:true` / Hidden.

## Exact prerequisite pins

* Official cached `UE4SS_v3.0.1.zip`: **5,523,402 bytes**, SHA256
  `4b47d4bceddd2f561a4e395bfa00924ccfc945af576a2d0c613e6537846c57ec`.
  URL `https://github.com/UE4SS-RE/RE-UE4SS/releases/download/v3.0.1/UE4SS_v3.0.1.zip`.
  Official tag resolves to source `d935b5b23bac03b65c14ae38382b02007204cc2e`.
  Read-only static inspection validated all 46 entries and ZIP CRCs.
* `dwmapi.dll`: AMD64 PE32+, 58,368 bytes, SHA256
  `ce596412befa68c30b7f88f65beb77d9bdad55e9b96a276a5a9cf690c63f24bb`.
* `UE4SS.dll`: AMD64 PE32+, 16,263,680 bytes, SHA256
  `8ac18fbffc1ef96b0662d4a2d537b3f224c26d65caaba7989a9404c566102b26`.
  Its imports include VC14 C++ runtimes/atomic-wait, UCRT, D3D11,
  D3DCOMPILER_47, OpenGL32 and normal Windows system DLLs. Inspect actual private
  prefix resolution before launch; static imports do not prove Wine support.
* MIT license notice SHA256
  `ddc030e25d0ea87aca4ae84c0ed3f868d69273c00c0c12ea1e26f1c6130f5d2e`.
  The ZIP has no LICENSE member, so carry the exact pinned upstream notice
  beside the mod/package. Source APIs are individually pinned in `sources.json`.
  No generated game SDK or unavailable UEPseudo headers are used. The full
  loader source build remains unreproducible from the inspected public submodule
  URL; the lawful official release is the proposed executable, not a fabricated
  locally rebuilt loader.
* Production Star Wine image from `ocean-space-pins.json` remains unchanged:
  `ghcr.io/ptero-eggs/yolks@sha256:eedeb0ff1684592ee0f28119d7111f7ba14488dfa9537c99689dfe7a33ba2553`.
  This digest was not cached; no pull/substitution/canonical change occurred.
  The proposed isolated first game/bootstrap phase instead uses separately
  reviewed cached Wine11 image
  `ghcr.io/ptero-eggs/yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8`,
  builtin runtimes only, a private win64 prefix, no Mono/Gecko/Microsoft installer
  and no runtime-license opt-in. Do not call the production `vcrun2022` installer
  or implicitly accept its license for that fixture. Original production runtime
  controls/license gates stay unchanged and untested by this builtin-first phase.
  On a real missing library/export/implementation dependency, STOP and preserve
  evidence; do not automatically install Winetricks/MSI or change runtime images.

**Compatibility blocker:** v3.0.1's exact README targets UE4.12 through UE5.3.
Official UE4SS merged PR1150, commit
`e71d5e5a2fe7c99e95e21fd910813811ee0e8f73`, supplies a StarRupture config with
MajorVersion5/MinorVersion6, object-array cache disabled, and a custom
StaticConstructObject signature. This is primary evidence of the maintainer's
UE5.6 target, not proof of the unacquired dedicated payload's actual engine.
Do not perform a blind legacy-loader trial. A compatible official experimental
candidate is proposed below and needs exact source/license review before any
acquisition or native probe. Do not substitute the Palworld-specific fork/proxy
or invent engine overrides.

### Compatible candidate proposal — approved static acquisition inspected

Official `experimental-latest` asset metadata currently identifies source
`8333063595fa3c49ad307f3b0f732accbb760d25` and:

* `UE4SS_v3.0.1-1181-g83330635.zip`, 8,748,315 bytes, publisher GitHub SHA256
  `b9a166a756605b21058a64cde93bcaab1a855dba3553e5c7e6ce0fa8fdfad7b9`.
* `zCustomGameConfigs.zip`, 423,121 bytes, publisher GitHub SHA256
  `0d91b15a75a7787bd4a469d1b3338a27c3e19ca843b5f8778f69a4d13f63b5de`.

The rolling tag must never substitute a changed artifact. Root separately approved
only bounded static acquisition: both exact-size/hash assets are now in the
owned immutable `.local/star-password-bootstrap/public-cache/sha256` cache,
9,171,436 total ZIP bytes. Nine exact-commit primary source files (507,676 bytes)
confirm MIT notice, reflected invocation/FString marshaling, scheduler APIs and
the maintained UE5.6 Star config. Including these sources, acquisition stays
below16MiB. No DLL was executed, Wine/game/MS installer acquired or run, license
opt-in made or native lease admitted.

Static inspection validated41 loader and293 config members/CRCs with path,
Windows alias/ADS, symlink and size guards. The bundled MIT notice and Star
settings/signature match exact candidate source after CRLF normalization.
`dwmapi.dll` is279,552-byte AMD64 PE32+, SHA256
`93b9431a5a4f32c675d269c5da1c9b3ec6f88552ec20c282ab435f411e9271fb`;
`ue4ss/UE4SS.dll` is20,640,768-byte AMD64 PE32+, SHA256
`ce5e3c46a920cc00b2817ac61e438c9162830290379d0b5b9c4dfc2b29459290`.
The newer core additionally imports `bcryptprimitives.dll`,
`api-ms-win-core-synch-l1-2-0.dll`, and `MSVCP140_CODECVT_IDS.dll`; actual private
Wine/prefix resolution remains a native gate. Required API names exist in the
binary but string presence is not execution or engine binding proof.

Evidence: `artifacts/star-password-bootstrap-experimental-acquisition.json`,
`artifacts/star-password-bootstrap-experimental-inspection.json`, and
`artifacts/star-password-bootstrap-candidate-source.json`. The source API
contract is reviewed statically; game/loader compatibility remains unverified.
The configured version must never be forced onto a mismatched actual game build.

## Phase 1 — entitlement, build and loader probe, no secrets

This is a proposed independent owned fixture, not removal/bypass of the canonical
encrypted-file or Microsoft-runtime license requirements. Root review must
explicitly approve its builtin-Wine launcher/game/EULA scope before admission.
No EULA/runtime acceptance is performed by this plan. Bypass the stock image's
raw updater/Winetricks/eval entrypoint for the fixture; retain original typed
config/argv semantics and stop on actual unsupported dependencies.

After explicit root approval and successful admission:

1. Reuse reviewed lossless typed metadata for dedicated app **3809400** and the
   completed separately approved source-app228980/depot228989 metadata.
   Capture exact branch/build/manifest/footprint; no blind repeat calls. If anonymous entitlement
   is denied, stop; no client/private credential substitution. The reported
   publisher sunset/last-compatible 0.3.5 is a constraint, not a branch name.
   Select only an actually available documented compatible build; retain metadata.
2. Install the dedicated Windows payload under the owned receipt. Record engine
   version from its actual logs/version resource and installed executable SHA256.
   No source evidence can substitute for the actual engine/build identity.
3. Inspect the executable's real PE imports and loader search chain. Stage only
   the separately reviewed compatible pinned release proxy/core/settings/scripts under an owned
   manifest. Never overwrite an unknown proxy, mods list or operator plugin.
   Configure native `dwmapi` selection only in this private process if the actual
   import chain supports it; prove the exact module loaded rather than assuming
   file presence. Disable every bundled gameplay/cheat/keybind/blueprint mod;
   enable only the owned probe. No C++/UHT/object SDK dumps or generated headers.
4. A scoped probe runs on the game thread, reports fixed status only, and
   enumerates `FindAllOf("CrDedicatedServerSettingsComp")`. Require exactly one
   valid live instance and valid UFunctions for both setters; inspect reflected
   input property type/count using the supported UE4SS APIs before secrets are
   delivered. Capture actual method existence, not strings found in a DLL.
   If class/ABI/lifecycle differs, stop at binding-unverified and investigate
   licensed source; no guessed patterns or parameter buffers.
5. Keep `-RCWebControlDisable -RCWebInterfaceDisable` as in the existing source
   launch path. Inventory listeners; no new public TCP management exposure.
   Graceful stop and exit status required even for a failed probe. No secret
   request is staged for this first compatibility probe.

## Phase 2 — protected native generation

Only after phase1 passes under the same owned receipt:

1. Snapshot both native password files if present (bytes/hash/mode/UID/GID), all
   original DSSettings/saves/operator mods and receipt-owned files. Stop first.
   Use a clean first-generation fixture with no encrypted files only as an
   explicitly reviewed experimental bootstrap candidate. The canonical
   encrypted-file import requirement is not bypassed or removed for production.
2. Stage exact source-pinned bootstrap mod. Use root/game UID988 or actual
   observed game UID, mode0700 mod directory, mode0600 exclusive request.
   Send packet from a private controller over an inherited pipe; strip original
   `ADMIN_PASSWORD` / `PLAYER_PASSWORD` from every child environment before launch.
   No password in process argv, environment, logs, receipts, shell command text,
   filenames, network services or artifacts. Record redaction checks without
   retaining a reusable verifier or password hash. No password-service request.
3. Actual Lua callbacks must run on the game thread and select one live object.
   Both reflected methods are checked before calls. The request must be unlinked
   before either call. Fixed `methods_returned_pending_native_file_verification`
   status is only a callback marker. Timeout/ambiguity/error/unlink failure must
   never become ready or a generated-files success.
4. Require actual engine-produced `Password.json` and `PlayerPassword.json` in
   the publisher's observed native location. Validate native object structure,
   nonempty encrypted values, mode/UID/GID and absence of raw secrets. Record
   file hashes only, not encrypted payloads, in public evidence. Do not infer
   RSA parameters or decrypt/extract keys. File appearance alone is partial proof.
5. Deliberate invalid binding/input/partial failure must leave no private request
   behind and never auto-replay. Preserve prior native encrypted files before
   any explicit password-change trial. After stop, restore pre-trial files if
   generation fails/partially updates, preserving bytes/mode/UID/GID; no live
   file rollback while the engine is writing.

## Phase 3 — authentication, restart and preservation

* Require a legitimate game client or documented licensed maintained protocol
  client for correct/wrong admin authentication and correct/wrong player join.
  No password spraying, guessed management protocol, or fabricated success from
  the setter result. Client/gameplay availability is currently an open blocker.
* The current adapter disables remote-control management. If admin authentication
  needs that disabled publisher endpoint, STOP and coordinate a separately
  reviewed isolated management transport. Never silently drop those flags or
  expose unauthenticated UE remote control to LAN/Tailscale/public interfaces.
  Gameplay UDP may be published only for the approved private-client trial.
* Test admin-only and player-only operations (other encrypted file unchanged),
  explicit clear semantics only if the real publisher method supports it,
  Unicode, unchanged omitted controls, explicit new passwords (old denied/new
  accepted), clean stop0, restart with request absent and authentication retained.
* Save/reload an actual world if the supported build/client allows it. Do not
  describe protocol/admin bootstrap as player gameplay or world persistence.
* Same-build reinstall: record numeric Steam build/depot identity before/after,
  preserve native files, settings, saves and operator plugin fixtures with strict
  hashes/mode/UID/GID. Separately record release-comparison availability.
* Verify the canonical encrypted-file import continues to work without this mod.
  Production integration/gate removal needs root review of all relevant native
  evidence; failure or missing client proof remains explicitly partial.

## Owned files/resources planned for the later approved run

These paths are proposed, not yet created/executed:

* `.local/star-native/private.json`, lease receipt, install/boot/stop/reinstall
  receipts and private authentication packets, access restricted and never dumped.
* `.local/star-native/controller.py`: confined private delivery, environment
  scrubbing, listener/module observation, bounded wall-clock watchdog and cleanup.
* `.local/star-native/probe/Scripts/main.lua`: secret-free exact reflected method
  probe before first real bootstrap; source review/fixtures before native use.
* `.local/star-native/owned-loader-manifest.json`: exact ZIP members/paths/hashes,
  previous-file ownership guard and rollback for owned content only.
* `artifacts/star-password-bootstrap-native.json`,
  `artifacts/star-password-bootstrap-native-cleanup.json`: phase/build/module/
  callback/file/auth/persistence/stop evidence and explicit untested boundaries.
* No shared core, runtime helper, canonical egg, UI, production package or service
  edits. Any necessary production secret-delivery integration is coordinated
  separately after reviewed proof.

Cleanup uses only the exact receipt-owned server/volume/allocations/egg/nest and
private probe files. Verify absence, native process/listener termination and
baseline reconciliation before releasing the lease. Preserve diagnostic evidence
with secrets removed. A review rejection ends that action; no alternate mechanism.

## Existing evidence and current open blockers

The 256MiB RAM/1024MiB disk/zero-port utility lease
`232ea4f4-df6a-42c2-bf81-7b9811c34cff` ran only verified cached SteamCMD:
`+@sSteamCmdForcePlatformType windows +login anonymous +app_info_update 1
+app_info_print 3809400 +quit`. Its output explicitly confirms the Windows
platform before anonymous login. Login/user-info succeeded; process exited0
after94.6seconds without an AppID3809400 block. Build/depot/manifest/branches/
OS payload/disk/entitlement were **unknown from that command**; this is neither a
NoSubscription result nor evidence of app removal. No app_update was attempted.
Raw response/order/hash and primary engine/config metadata are retained in
`artifacts/star-password-bootstrap-steam-metadata.json` and the private log.
The exact owned metadata container is absent; its170,482,356-byte temporary
directory was removed/absence verified and the lease released.
`artifacts/star-password-bootstrap-metadata-cleanup.json` records cleanup.
There was no Panel resource, port publication, game/runtime acquisition, license
opt-in, native game launch, production gate change or service change.

### Subsequent authoritative typed anonymous metadata

Root's independently approved one-shot PICS request succeeded and is recorded in
`artifacts/steam-private-metadata-3809400-live.json`, change39599309. Public branch,
Windows64, build **25642172**, main depot **3809401**, exact manifest decimal
string **3659990775896995763**, installed bytes **21349240119**, download bytes
**2653127216**. This supersedes the empty SteamCMD observation for these metadata
fields, while preserving that first response honestly. No install entitlement or
content acquisition was proved. Shared depot **228989**, from app **228980**, has
no supplied manifest in this app response; its exact identity/footprint and
required content selection still need separately authorized metadata resolution.
No unobserved legacy branch is invented; public is the observed branch.

The authoritative Python/raw receipt path and SHA are recorded by the root
artifact. Keep manifest IDs as typed uint64 or decimal strings: a historical
derived JavaScript Number receipt rounded this manifest and is explicitly
non-authoritative. Do not copy IDs from that lossy file or JSON Number output.

Root independently reran 19 actual-Lua + five Python offline fixtures and then
ran five actual Linux nonroot UID988 staging tests under network-none/read-only
repo/tmpfs. That closes the original Windows-only POSIX staging test boundary;
it does not establish native engine or UE4SS compatibility. Root owns that Linux
evidence. `artifacts/star-password-bootstrap-loader-inspection.json` records the
cached binary's static checks and imports without executing it.

### Reviewed successful runtime-import prerequisite

The separate no-CRT C probe SHA256
`364e1bdbe9ba1b45063c7ea06964741147b8172017532312f15c99c06e21dc1c`
ran once on the cached db48 Wine11 bare private prefix with `--init`, nonroot,
networknone, unlimited RLIMIT_FSIZE and external32MiB log cap. Actual MAIN+READY,
rawexit0, all29system/API-set libraries and655 named/ordinal export addresses
were observed. Root independently reviewed/rebuilt this in
`artifacts/star-runtime-prerequisite-root-review.json`. Exact utility/prefix
absence and lease release are verified. Both earlier Go startup failures remain
preserved; the C result does not establish their cause.

This resolves only lookup availability in that Wine base. No returned function
address was called. Builtin implementation semantics may differ or be stubs;
no UE4SS/game/password/configuration/admin/join/EULA/runtime-install proof follows.
The first actual game/loader phase must STOP on missing/unsupported implementation
behavior instead of inferring readiness or installing Microsoft prerequisites.

Open: root game execution approval, ordinary8GiB capacity and adequate disk,
actual content entitlement and actual installed engine/build identity,
actual UE4SS compatible load and reflected methods,
secure host-to-game secret delivery verification, native encrypted output,
correct/wrong authentication/private join, restart/reinstall/save proof, and
reviewed cleanup. No native step is authorized by this plan file itself.

### Completed one-shot shared-depot resolution

Root reviewed the staged controller and independently passed its8fixtures, then
authorized one anonymous app228980 request with exact controller SHA256
`e0608db83fd83a6c27730f6ec811a71eb0d433c20bddd21e18e9f21133ab2544`
and CEA92 lossless worker. It succeeded, worker/rawcontainer exit0, failure null,
no parent kill and no stderr. Exact depot228989/public manifest decimal string
**5753583882400741046**, installed **25674515**, download **25108528** bytes;
platforms windows, architecture null, from_app_id null. No architecture or
human-readable payload role is guessed. No entitlement/content proof follows.

The7402-byte raw stdout was saved as a byte-identical receipt before JS parsing,
SHA256 `cc8b45a2aa6f88811df1b070ec8b004f972df9c37ea9addd2b229823789a6d1a`.
Independent Python validation passed the actual staged ABI/selection functions
and confirmed every selected uint64 is a string. No second call occurred.
All3exact utility containers and651,931,672-byte temporary directory were removed
and absence verified; ordinary1GiB/4GiB/zero-port lease released. Evidence:
`artifacts/star-password-bootstrap-shared-depot-live.json`,
`artifacts/star-password-bootstrap-shared-depot-validation.json`, and cleanup.

Main+shared installed bytes total21,374,914,634; download bytes2,678,235,744.
Including observed bare prefix1,487,727,187 gives25,540,877,565bytes before other
overhead, consistent with the reviewed40GiB initial game budget. This does not
reserve space for a second complete program copy or prove actual installation.

The original staged proposal/source freeze is retained as pre-call evidence;
no repeat request is authorized. Native encrypted-file import/upload, full-world
import/load and production secret delivery remain independent acceptance work.
