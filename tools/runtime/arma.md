Arma family source adapter
=========================

Stage with `node tools/runtime/stage-arma-profiles.mjs`. Verify with
`node tools/runtime/test-arma.mjs` and
`go test ./internal/panel -run '^TestArmaStagedDefaults$' -count=1`.
The stage does not merge or promote itself. No production build is needed.

Two exact imported recipes are owned by this adapter. All22 original Arma3
variables and all15 Reforger variables remain in the generic shared React form,
Startup API and egg document. Configuration is generated immediately before
native launch, rather than exposing secrets to shell expansion or rewriting
JSON string literals with sed. Native console input remains connected; Panel
stop sends SIGTERM to the scoped supervisor, which forwards SIGINT to its owned
native server/headless process groups and waits for exit before escalation.

Arma3 private install is unresolved. The shared reviewed Steam transport rejects
password/account login; experimental transports are not integrated here. Default
Steam mode fails before apt/download/spawn and never sends a credential. The
explicit existing-files mode requires legitimately uploaded selected native
binary, UPDATE_SERVER=0 and DISABLE_MOD_UPDATES=1. All original install controls
remain visible, including retry/CDLC/branch/validation/Workshop options, with
an actionable prerequisite. They are not reported as working private downloads.
The supported existing-files runtime preserves launcher HTML/manual/client,
server-only and optional-key roles, native CFG mission classes, signature keys,
headless client0..5 settings and optional lowercase/cache operations.

Reforger uses the shared anonymous Steam updater and manifest/depot receipts.
Both publisher dedicated stable1874900 and experimental1890870 are supported;
unrelated arbitrary Steam app IDs are rejected. Reinstall saves/restores exact
config.json bytes, mode and timestamps even after a failed Steam operation.
Native profiles, mods, addons, admins and unknown JSON remain operator owned.
Current publisher documentation has no REGION or AUTO_JOINABLE setting, and the
original imported recipe did not use either variable in install, startup or
configuration. Their API controls remain documented original no-ops. Supported
access controls include visible, password, admins and operating.joinQueue.

Arma3 public sample configurations are pinned to the exact imported game-eggs
revision and verified SHA256, with custom HTTPS sources requiring both checksums.
Actual legacy TBB2 binaries use checksum-pinned official Debian2020.3-1 packages
for both32/64-bit architectures. NSS wrapper/SDL and dependency closure use the
matching Debian12 installer packages, recording package versions and observed
library SHA256, preserving Debian copyright files. These apt package versions
are observed dependencies, not claimed immutable publisher game binary pins.
Proprietary Arma binaries/client assets are not redistributed. Dedicated tool
downloads and legal availability remain subject to publisher/Steam terms.

Evidence scope
--------------

The offline Python tests use a network-disabled256MiB container. Tiny Python
processes test actual signal forwarding and owned child cleanup, but these are
process fixtures, not Arma clients or native game acceptance. Other fixtures
cover JSON typing/literal preservation, native CFG nesting/comments/duplicates,
original mods/keys, path escapes, role allocation, all binary/HC choices, private
Steam fail-closed and exact config preservation after interrupted updates.

No Arma3/Reforger native install, startup, protocol, world save/reload, headless
connection, reinstall retention or player gameplay has been proved. Both
profiles remain not_verified. No native claim was made while heavy jobs held
capacity; these games use honest4096MiB defaults and are above the current2GiB
native claim limit. Future acceptance must acquire the ordinary atomic weighted
lease and satisfy account prerequisites, then clean all owned resources before
releasing it. No accounts, credentials or BattlEye agreements are fabricated.

Primary references
------------------

- https://community.bistudio.com/wiki/Arma_3:_Dedicated_Server
- https://community.bistudio.com/wiki/Arma_3:_Server_Config_File
- https://community.bistudio.com/wiki/Arma_3:_Headless_Client
- https://community.bistudio.com/wiki/Arma_Reforger:Server_Hosting
- https://community.bistudio.com/wiki/Arma_Reforger:Server_Config
- https://github.com/pterodactyl/game-eggs/tree/c637a6d1e0449b167efeff81bb9a0177aa3df6c2/arma
- https://github.com/ptero-eggs/yolks/tree/master/games/arma3
- https://deb.debian.org/debian/pool/main/t/tbb/
