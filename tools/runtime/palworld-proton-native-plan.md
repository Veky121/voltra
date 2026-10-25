# Palworld Proton: staged native acceptance plan

Status: native acceptance completed and independently reviewed in `artifacts/managed-steam-palworld-proton-root-review.json`; all owned resources cleaned. Public setup promotion retires only the temporary availability override. The phases below retain the acquisition/probe safety contract and historical evidence. No new game run is required for gate/metadata-only promotion.

Production `steamPalworldProtonGap`, API setup/job rejection and catalog readiness remain enabled. PhaseA import prerequisites now have real native proof; no game or UE4SS/proxy DLL has been executed. See `artifacts/managed-steam-palworld-proton-prerequisites.json` for original failures, corrections, exact source/binary/debug output and cleanup. The maintained MIT loader does not claim compatibility with opaque legacy winmm or arbitrary C++ DLL mods.

## Phase A: dependency probe, before any Windows game acquisition

PhaseA initially used an ordinary9216MiB/32768MiB game lease; root subsequently approved each bounded diagnostic under its own **1024MiB/4096MiB zero-port utility lease**. All were cleaned and released. PhaseB requires a new ordinary **9216 MiB RAM inclusive of8192 MiB game plus1 GiB controllers,32768 MiB disk** lease. Common bounds remain max7 active,20480 MiB RAM,131072 MiB disk including20480 MiB cache reserve. Re-read the queue/current batch receipt at claim/start, never infer capacity from these historical attempts.

Create one receipt-owned random namespace below `/var/lib/voltra-batch-20261023/managed-proton/<UUID>`. Record exact container names, image digest, root/volume/prefix paths, lease ID and all helper source bytes before launch. No production Panel/Wings/node/Docker daemon or existing service changes. All Windows tool launches remain hidden. No polling subprocess every second; use direct queue reads. A deadline invokes normal stop/removal only for receipt-owned utility containers, retaining raw exit and logs.

Live read-only image inspection at this source checkpoint found the exact image already present:

`ghcr.io/ptero-eggs/steamcmd:proton@sha256:38380883a880937c6bdfa25a29a50601e8fd010a126157f857539bfd9057ed7b`

LinuxAMD64,1,541,820,907 image bytes, created2026-06-22T02:53:14.05532293Z. No image pull was issued by this owner. Use `--pull never`; if the exact image disappears, stop and request a separately bounded acquisition plan. Existing image presence is not runtime/library proof. The image includes Proton and Wine tooling; it is not proof that redistributable Microsoft libraries are present or licensed for this use.

The harmless WindowsAMD64 probe is2,258,944 bytes, SHA256 `6c8f67de8ce7232e1128a49c16098c8b544f56647b52ceedfd6e9485213e1235`. It checks the exact29DLL/655 imports from both pinned loader DLLs. Real DLLs use absolute `C:\windows\system32\` paths; embedded `api-`/`ext-` virtual contracts use `LoadLibraryExW(name,NULL,LOAD_LIBRARY_SEARCH_SYSTEM32=0x800)`, then every required export is resolved. No application/user/PATH DLL fallback is allowed. The probe does not load UE4SS, game code or a relative proxy. Fixed MAIN/READY/missing-import diagnostics go to stdout and `OutputDebugStringW`, because the Proton Steam shim can detach stdout. Its two explicit diagnostic/loader baseline APIs are recorded separately. Source/build flags and MIT/Go licenses are bundled. Recompute imports with:

```text
python tools/runtime/palworld-runtime-imports.py .local/palworld-proton-dependencies/UE4SS-Palworld-g2281fa31.zip
node tools/runtime/palworld-loader-bundle.mjs --repro
node tools/runtime/palworld-loader-bundle.mjs --verify
```

The successful diagnostic used pinned image `--pull never --init --network none --cap-drop ALL --security-opt no-new-privileges`, actual `container` UID/GID1000, bounded PIDs/CPU/RAM and one private X display. The exact SHA-verified regular probe was copied onto the owned Linux filesystem0500; no noexec mount, symlink or host-bind ambiguity. Before Proton it copied ONLY three existing public SteamCMD SDK ELF files into private `HOME/.steam/sdk64/`: steamclient.so/libtier0_s.so/libvstdlib_s.so. Archive and file SHA/size/AMD64 guards plus actual `ldd` all passed. No account/config/appcache/log/user state was copied. The SDK came from the reviewed public official bootstrap+quit archive, not an operator install. The pinned tagged lsteamclient source requires that SDK path, matching the existing managed mutation helper.

The current diagnostic driver is `tools/runtime/palworld-proton-probe.mjs --diagnostic --sdk-diagnostic`; it must never be rerun without root's bounded attempt authorization. Its fixed inner setup is:

```bash
set -euo pipefail
umask 077
export HOME=/home/container
export STEAM_COMPAT_DATA_PATH=/home/container/.steam/steam/steamapps/compatdata/2394010
export STEAM_COMPAT_CLIENT_INSTALL_PATH=/home/container/.steam/steam
export SteamGameId=2394010 SteamAppId=2394010
export PROTON_LOG=1 PROTON_LOG_DIR=/home/container/private-logs
unset WINEDLLOVERRIDES
cd /home/container/public-probe
exec python3 /probe/log-bounded.py
```

`log-bounded.py` starts only the fixed `xvfb-run -a /usr/local/bin/proton run /home/container/public-probe/runtime-probe.exe` process group. It refuses inherited RLIMIT_FSIZE; log-only monitoring bounds private Proton logs to16MiB plus separately bounded16MiB native stdout. There is no processwide file/memfd/prefix limit. Directory0700/log files0600, deadline at most15minutes, no Wine/Microsoft installer or license acceptance. Fixed SteamGameId/SteamAppId are logging identity, not authentication. Success requires MAIN_ENTERED then READY, rawExit0 and no missing imports; PE load alone is insufficient.

Final run `ed5be819-699d-4cab-9345-c2288c862d39` met those conditions, raw0/OOMfalse. Actual debug timestamps131210.702 MAIN and131210.761 READY are retained. Its755,366,320byte private namespace and exact container were removed; utility lease `ab53817d-4245-46bb-bd5e-3ec789e12ae2` released. Root independently reviewed phaseA in `artifacts/palworld-proton-prerequisite-root-review.json`. This proves import resolution using existing Wine/System32 libraries, not their full behavior or Palworld/UE4SS compatibility. Public image/cache remain unchanged.

## Phase B: separately reviewed Windows game acceptance

Only after root reviews phaseA and explicitly releases acquisition. Use the established isolated fixture Panel18098/Wings18191/SFTP12131/private connector on distinct owned resources, fresh random PostgreSQL fixture schema, current-source compiled binaries, same bounded lease. Record schema identity privately for exact cleanup. The accepted run used a reviewed test-only fixture seam while production remained gated. After root native review, that availability override is retired; the fixture keeps exact ownership checks without changing production specs or shipping behavior. No environment/user availability override exists.

Typed Windows platform selection must precede anonymous app2394010 login/update. Preserve initial entitlement/download failures; no private account/Guard/beta password request or credential fallback. Do not reuse Linux depots or appmanifest/user state. Existing updated public SteamCMD bootstrap may seed independent writable copies under normal cache policy; Windows game CAS is permitted only if its exact app/build/platform/content identity is independently proved. No Steam credentials, prefix or operator files enter shared cache. The reviewed UE4SS ZIP already exists locally at8,631,290 bytes; seed through existing bounded public CAS only, then verified independent per-volume copy.

Archive expected and actual helper/launcher/probe/loader/pins bytes at first install and reinstall, not just hashes. Verify exactWindows PE target, publisher build/manifest, maintained loader receipt/core SHA, single `dwmapi=n,b` invocation and private per-server prefix. Never inherit a global Wine override. Before launch, loader ownership/integrity/conflict checks and the same runtime probe must pass; no game process on failure.

Demonstrate all12 original controls through real config/argv/native/API behavior: fixedSRCDS_APPID2394010, WINDOWS_INSTALL1, AUTO_UPDATE policy, MAX_PLAYERS, ADMIN_PASSWORD, PUBLIC_IP/PublicPort, SERVER_NAME, SERVER_PASSWORD, RCON_PORT, fixedRCON_ENABLE, SERVER_DESCRIPTION and ALLOW_CONNECT_PLATFORM/CrossplayPlatforms. Retain legacy Palworld/nativeLinux defaults and unsupported private Steam credential gates. Do not substitute API name presence for native behavior; no player join/crossplay matchmaking/admission-cap claim without a real client.

Require actual game plus one UE4SS revision/GitSHA in native logs, correct engine/layout initialization, server-only harmless Lua that reads genuine Unreal/Palworld object state, and native Blueprint-loader initialization. No fake Lua success or gameplay proof. Test authenticated native RCON commands/save, originalShutdown5, child termination/raw exit, real generated world identity after restart, settings and QuickSetup admin/join edits, encrypted DB and masked/no-secret API/audit/argv/environment boundaries.

Seed distinct operator Lua, settings, order/enabled files and a24MiB custom PAK under a dedicated custom mod directory. Native successful and intentionally failed maintenance/reinstall must retain exactSHA/mode/UID/GID, along with saves. Only scoped custom roots are backed up; publisher basePAKs are not promised patch preservation. The node streams private backups to node journal after actual free-space admission; insufficient space fails before Steam mutation. Conflicting legacy/custom DLL paths and altered core refuse before writes. Keep original failures and distinguish recovery from first pass. Generic client/application Reinstall must enqueue real stopped install, never autostart; Verify is not Reinstall.

Finally stop normally, retain raw publisher stop status, archive owned protected world privately if required, remove exact owned game/helper containers/volumes/allocations/egg/nest/controllers/schema/network, verify absence and release lease. Never delete shared cache/image or production resources. Root reviews runtime promotion separately; no source-only status promotes readiness.
