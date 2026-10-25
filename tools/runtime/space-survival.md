# Astroneer, Icarus and Empyrion source implementation

Owner space_survival reserved only the exact three canonical recipes missing from
overrides. All37 original variables, defaults, visibility and edit permissions are
retained (9 Astroneer,9 Icarus,19 Empyrion). Shared React setup, typed Steam/secure
publication, native INI, common private Wine prerequisites, immutable GE-Proton,
release integrity/public cache and native console are reused. No shared core,
overrides or helper was edited by this batch; root merges the staged profiles.

Run node tools/runtime/test-space-survival.mjs for15 network-free container
fixtures. If absent, the runner first obtains only the pinned130KB PyYAML OSS
source dependency; cache identity is verified before network-disabled fixtures.
Generate .local/space-survival/profiles.json with the scoped stager, then run the
profile test for original-control/embedding/syntax checks. All three remain
not_verified. No game or Windows/Proton runtime download, lease, native boot,
protocol/client join, publisher save/reinstall, admin/mod runtime proof occurred.
The local TCP fixture launches only a tiny Python socket server inside the
network-disabled fixture container; it is not a publisher server.

Astroneer preserves original Windows728470 and original PROTON_LOG through the
existing enshrouded-proton helper's immutable GE-Proton pin/licenses, private prefix
and Linux Steam SDK bridge. Lawful operator content requires its Windows x64
binary/Content plus x64 .steam/sdk64/steamclient.so; no alternative game app is
substituted. Owner/PublicIP/name/password/port/encryption use typed native INI.
Repeated PlayerProperties preserve unrelated admin/whitelist/ban entries; changing
the previously managed owner replaces only that entry. SaveGames, active save,
autosave/backup/custom settings remain. Original early setpriority diagnostic
marker is removed because it is not game readiness; actual native readiness must
be established later. Publisher licensing/client encryption/network prerequisites
remain, with no client compatibility inference from source tests.

Icarus preserves original Windows2089300, SteamServerName/PORT/QueryPort typed
arguments and all Wine architecture/path/debug/tricks controls. Common private
Wine helper installs original vcrun2022/corefonts after explicit runtime-license
acceptance. Publisher UserDir confines the actual Icarus/Saved tree. The exact
publisher config at commit0a794a8c2c2f9dc80642075be3fc77e99d182dfd is pinned.
Legacy original Config/ServerSettings.ini is copied only when the documented
Config/WindowsServer/ServerSettings.ini is absent; no operator copy is removed.
Existing admin/join passwords, prospect/resume/create settings, permissions,
player/world data and mods remain. Two distinct allocations are checked. Native
log streaming handles fresh history, rename/truncate, UTF8, secret redaction and
bounded final drain. Original Ctrl-C supervision remains; real save behavior is
not established by the adapter's mock process test.

Empyrion preserves original Windows530870/public beta selector, all nineteen
controls and native dedicated.yaml, DedicatedServer cwd, no-graphics/batch/log
arguments and saveandexit0. Five consecutive TCP/UDP game allocations are required.
Original hidden TELNET_PORT1030 is an internal unallocated container port; it may
not overlap any public allocation. The client uses raw loopback TCP as recommended
by publisher-linked wiki. Existing configured Tel_Pwd is preserved; the original
blank receives a generated private secret. It is not a claim that the game binds
its listener exclusively to loopback. The supervised proxy authenticates, forwards
actual console commands and sends the original saveandexit0 stop, tracks process
exit and terminates its owned group on error. No publisher save success is inferred
from a closed socket or the Python protocol fixture.

All original YAML settings are typed; unknown nested maps/scalars/comments,
SaveDirectory, adminconfig, scenarios/mods/worlds remain. PyYAML6.0.3 source is
MIT and SHA256-pinned from official PyPI metadata, installed as pure Python only
inside .voltra/python-packages. Unsafe constructors, duplicate keys, aliases and
managed structural ambiguity fail clearly before writes. This does not silently
flatten operator YAML or run constructors. Actual custom scenario/EAC Wine and
client compatibility remain pending; original EAC_ACTIVE true is not changed.

Original Steam private accounts/beta passwords remain explicitly unsupported by
the shared parser and fail before acquisition; no silent anonymous replacement.
The added INSTALL_MODE=operator_files route structurally checks lawfully supplied
original Windows binary/content and records SHA256/size separately from program
ownership. It neither proves publisher authenticity/licensing/complete depot
integrity nor takes ownership of supplied files. Original anonymous dedicated
apps are retained in steam mode, with no entitlement/gameplay promise.

Exact original JSON archives match catalog commit
c637a6d1e0449b167efeff81bb9a0177aa3df6c2 under .local/space-survival/upstream.
Public publisher/config/dependency provenance is recorded in space-survival-pins.
Existing upstream MIT recipe license and runtime distribution licenses remain;
no proprietary game binaries are redistributed. Frozen checkpoints and artifact
hashes describe source/test scope only.
