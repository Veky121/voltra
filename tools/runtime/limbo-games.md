# Standalone Limbo recipes

`node tools/runtime/stage-limbo-games-profiles.mjs` stages the two exact catalog
recipes under `.local/limbo-games/profiles.json`. It preserves current reviewed
status/details and does not edit the shared overrides. Both profiles reuse the
existing managed Java runtime, heap/JVM controls, native Wings configuration
binding, and shared React template form. No new Minecraft UI or Java supervisor
is introduced.

The reviewed defaults are official Limbo CI build76, version
2026.0.3-ALPHA-26.3, and NanoLimbo v1.13.0. Both actual main classes are class65
and require Java21. The NanoLimbo checksum is published in GitHub release
metadata; Limbo's checksum was measured from the immutable official build76
artifact and pinned in source. These replace floating last-successful downloads
and the outdated Java8/17 defaults. Original jar filenames, Nano version/custom
URL fields, and Nano eula/java_version/pid_limit features are retained.

The scoped installer verifies default checksums before publishing executable
jars, extracts native default configuration from the matching jar only if no
configuration exists, and preserves existing settings bytes, mode and owner on
reinstall. Unknown explicit Nano release tags fail instead of silently falling
back to latest. Optional custom downloads use public HTTPS, bounded downloads,
redirect checks, executable-jar/class validation and an optional operator SHA256.
Receipts record the actual digest and whether an expected checksum was available.
Custom class69 jars need Java25 selected through the existing Java controls.

Run `node tools/runtime/test-limbo-games.mjs` for eight focused installer tests.
They cover immutable defaults, verified cache reuse, configuration/receipt
metadata preservation, explicit versions/custom URLs, checksum failure, invalid
jars, confined paths, private hosts and manifest/class bounds. These are fixture
checks, not native server acceptance.

Limbo keeps its native stdin console and `stop` command. NanoLimbo v1.13.0 also
has a native console: `help`, `conn`, `mem`, `version`/`ver` and `stop`. Its new
default Stop uses that normal exit0 command and shutdown hook; Java's original
interrupt behavior remains available. The existing Java/Wings process handling
supplies these behaviors directly. The old egg description predates this console.

Limbo's acceptance restriction is recorded in
`artifacts/limbo-games-source-fixtures.json`. Its former installed candidate
never started: automatic approval review rejected its combined owned Files
fixture/snapshot/start command before execution, supplying only "blocked by
policy". No retry, alternate startup mechanism or replacement candidate was
attempted. Separately authorized ordinary cleanup removed all its resources.
This is an acceptance restriction, not a native game failure.

Independent NanoLimbo native acceptance is recorded in
`artifacts/nano-limbo-live-acceptance.json` and `artifacts/nano-limbo-cleanup.json`.
Fresh installation matched the pinned official jar and installer source, with
actual Java21/class65 preflight. Native status returned the operator MOTD and six
slots; the native ping nonce matched. Real console commands responded and both
native Stops exited0. Same pinned-release reinstall preserved settings.yml,
server.jar and the release receipt byte-for-byte with mode/UID/GID, then native
reload returned the same configuration/version. All resources were removed.
There is no persistent gameplay world to assert for this holding server. No real
player login, proxy forwarding, plugin or large-load test was performed.

The original Wings YAML startup binding rewrites comments; the fixture comment
was already removed before the pre-reinstall snapshot. Existing values survived,
and the installer itself preserved configuration bytes/metadata. Generic Steam
build comparison is unavailable for these non-Steam releases; the pinned jar and
receipt hashes plus native version provide explicit release evidence.

`tools/game-query/minecraft-status.mjs HOST PORT [OUTPUT_JSON]` implements the native Java
server-list handshake, JSON status and nonce-checked ping without logging in.
Three transport fixtures test fragmented Unicode frames, wrong-nonce rejection
and strict rejection of invalid wire UTF8:
`node --test tools/game-query/minecraft-status.test.mjs`.
Pass the optional output path to write UTF8 directly. Windows PowerShell5
`Set-Content` otherwise writes ANSI and can corrupt Minecraft section-sign color
codes when a later reader assumes UTF8. The acceptance report retains the
original diagnostic hashes and explicit normalization in
`artifacts/nano-limbo-query-encoding.json`; no new native action was needed.
