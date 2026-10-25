# Wine Generic, Nova-Life: Amboise and Modiverse

This source-only batch stages exactly these recipes in `.local/sandbox-servers/profiles.json`:

- `wine/generic/egg-wine-generic.json`
- `novalife_amboise/egg-nova--life--amboise.json`
- `modiverse/egg-modiverse.json`

All remain `not_verified`. Root owns canonical integration. No game/Wine/Steam process, native lease, live API/DB mutation or production build occurs in this batch. The only process acceptance is an isolated tiny Python utility proving shared signal forwarding and raw exit status, not game behavior.

All 13 original variables retain their exact defaults, rules, visibility, editability, descriptions and types. The shared React startup form handles the additive fields. There is no new React component or protocol/API replacement.

## Wine Generic

The original download URL, executable and INSTALL_DIR fields remain unchanged. INSTALL_DIR chooses archive extraction beneath the server volume. SERVER_EXECUTABLE remains a root-relative executable, not relative to INSTALL_DIR. Exact `/home/container` and `/mnt/server` aliases and harmless dot segments resolve inside the same volume. Spaces, Unicode, quotes, dollar signs and shell-looking text remain literal path/argument data; nothing is evaluated by a shell. Separate SERVER_ARGUMENTS is a JSON array of literal strings.

Stable, staging and development Wine image choices are separately pinned. Registry config/history confirms Python, Xvfb and xauth package installation without pulling layers or starting those images. The common Wine helper checks private prefix architecture and owns only its private display. Image-wide display and unrelated Steam/Winetricks startup actions are disabled using existing backend features and hidden fixed controls. Stop forwards explicit SIGINT through the shared native supervisor. No global wineserver termination occurs. Arbitrary Windows applications may require licensed dependencies or a different native shutdown mechanism; none is silently installed or accepted.

Download mode requires HTTPS and an independently verified SHA256 before any publisher request. Redirects must retain HTTPS. URLs and query parameters are passed to the HTTP library as data, never shell arguments, logs or receipt fields. This deliberately replaces the original unchecked download behavior. The historical default URL is preserved; its current availability and bytes are not asserted. Uploaded mode uses the operator's legal ZIP, gzip tar or XZ tar, or existing extracted executable and dependencies. No dummy credentials or proprietary payloads are supplied.

Archive extraction detects the original three formats by content. It confines paths, rejects links/special files, case collisions, traversal and adapter-control replacement, and bounds compressed/expanded size and entry count. Empty directories are retained. The publisher archive's directory layout is preserved. Existing config/world/mod paths in PRESERVE_PATHS are excluded from publication. Modified or unmanaged program collisions fail without overwriting operator data. Ownership receipts bind installed file hashes and archive SHA256. Late failures after atomic rename attempt rollback of every exact owned program file and the old receipt. Empty directories created during a failed publication may remain; rollback does not recursively remove directories or unknown data.

Generic configuration, credentials and listener selection remain operator-managed because an arbitrary executable has no universal schema. Choose selected allocations in its native configuration. CONSOLE_SECRETS supplies private values for the shared redactor without adding them to argv or native environment. Arbitrary applications may emit unknown credentials or use non-UTF-8 output; no universal native redaction/encoding guarantee is claimed.

The old `change me` marker is not evidence. Optional READINESS_MARKER is bounded literal text supplied from a real observed publisher message. The raw child-output observer emits fixed `VOLTRA_GENERIC_READY` once after a matching message, including split reads. Empty means no ready claim. Spawning or waiting a timer never emits readiness. A message match does not prove connectivity or gameplay.

## Nova-Life

Original AppID 1665030 and startup arguments remain intact. SERVER_NAME selects `Servers/<name>` and follows original Unicode alpha_dash semantics. Changing it selects another profile; it never renames or deletes old saves. The native JSON writer manages only profile name, list name, whole-number slot count and allocated game port. Integral numeric input such as `25.0` retains the original numeric rule's useful semantics.

Existing administrator/PIN/whitelist settings, map/shop settings, tablet URL, save interval, disconnect-before-stop and unknown JSON fields remain intact. The original private/no-whitelist configuration is used only when absent. Existing or explicit queryPort/steamPort fields require distinct selected allocations. Blank additive fields retain the original seed and do not invent new listeners. Current extra-port/public-listing semantics need publisher/native acceptance. The historical `Server launched in ` marker is preserved without claiming it was observed from current binaries.

Steam validation precedes state copies and publisher processes. Complete Servers profiles, plugins, mods and Unity configuration are retained across successful or failed updates, including file ownership/modes and empty directories. Source fixtures preserve an operator life.db and plugins after a simulated failed publisher update. No native database, authentication, save or gameplay claim follows from that fixture.

## Modiverse

Original AppID 1549820, literal hostname, slot count, UGC base folder, DoNotRestartOnEmpty and InitUGCs flags remain intact. Locked QUERY_PORT=27015 requires its own selected allocation and is never silently remapped. The original `listening on port` marker is retained as unverified.

The default ServerConfiguration.json comes from exact MIT catalog commit `c637a6d1e0449b167efeff81bb9a0177aa3df6c2`, with a pinned local snapshot independently compared against the raw source. Existing files are preserved byte-for-byte when unchanged. PIN, RCON password, map cycle, Workshop asset IDs, MOTD and unknown fields remain operator-owned. Both documented installer and root-relative ServerData locations, native Saved data, plugins and mods are retained across updates. The unused publisher shell launcher is preserved instead of being deleted.

Default PIN/RCON values remain the original public examples. Configure actual access controls through Files. No Workshop download, remote-console transport, map load or native mod compatibility has been tested. The adapter keeps the original UGC startup behavior and does not claim a separate verified RCON API.

## Reproduction and limits

`node tools/runtime/research-sandbox-servers.mjs` refreshes small pinned source/documentation and registry metadata receipts. It downloads no runtime/game binaries. `node tools/runtime/prove-sandbox-servers.mjs` stages this batch and runs original-variable/embedded-source parity plus 30 offline Python fixtures. Utility tests use an existing image with no pull/network, one CPU, 256 MiB memory, read-only filesystems and 64 MiB temporary storage. All Windows helper subprocess launches are hidden.

The final receipt is `artifacts/sandbox-servers-source-acceptance.json`. Publisher entitlement/depot availability, binary compatibility, native console/Stop/save behavior, networking, listing, mods and client gameplay remain unverified. Private Steam credentials fail closed; operator-owned legal files can run with AUTO_UPDATE=0. RAM/disk defaults are setup estimates. Original catalog licensing remains in `internal/panel/game_library/upstream/LICENSE`; publisher game and Windows dependencies retain their separate licenses.
