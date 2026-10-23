# Barotrauma and Enshrouded

Run `stage-additional-survival.mjs` to produce
`.local/additional-survival/profiles.json`; root owns merging and verification.
Both reuse the shared React form, typed Steam installer, private Python bundle,
configuration writer and streaming credential redactor. Every original egg
variable and feature remains. Tests are `test-additional-survival.mjs`.

Barotrauma v2 native acceptance passed fresh 1.13.4.0/build 23799137, interactive
console and native quit, six-slot/password A2S, campaign creation and restored
campaign loading after a reinstall. All sixteen protected files retained their
contents, modes, UIDs and GIDs. Owned resources were removed and the original
eleven-container remote baseline preserved. Evidence is in
`artifacts/barotrauma-live-acceptance.json` and `artifacts/barotrauma-cleanup.json`.
Development failures remain separate. No player joined.

Barotrauma uses two allocations for gameplay and Steam query. Its publisher
sets the Steam query port to zero in private mode, so A2S discovery is expected
only in public mode. Private/LAN is the default. New form controls manage name,
slots, join password and listing in `serversettings.xml`; existing attributes,
nested settings and XML comments are retained by the launcher. Native engine
rewrites may normalize or omit unknown settings. Passwords stay in private XML,
not process arguments. `quit` is the native Stop command. Its .NET console needs
a controlling terminal for stdin, stdout and stderr. Barotrauma alone opts into
minimal ANSI status/cursor query replies in the shared supervisor. This handles
fragmented requests without waiting for a newline; fixed position 1;1 is a
compatibility response, not a full terminal screen emulator.

Installation protects existing XML, native permissions, ban lists and karma
configuration byte-for-byte even if Steam fails. Campaign saves, LocalMods and
account data remain operator-owned. Newer publisher defaults should be reviewed
against retained native configuration rather than silently replacing it.

Enshrouded uses the original Windows-only server through a pinned official
Debian trixie Wine base and explicit Windows Steam platform selection. The old
bookworm Proton bridge fails current releases with `No SteamUtils011`; GE11
also requires a newer glibc than bookworm provides. The v4 installer provisions
a separate GE-Proton11-9 distribution, verified
against both publisher SHA-256 and SHA-512 values, and a private Debian Vulkan
loader. It checks that the new bridge and current native Steam SDK expose the
required interface. The archive's component licenses remain in the extracted
distribution. Exact upstream release/source:
https://github.com/GloriousEggroll/proton-ge-custom/releases/tag/GE-Proton11-9.
The downloaded asset is `GE-Proton11-9-x86_64.tar.gz`, SHA-256
`b2cf4a632a70ec321cdb9904fa396a2a45d4061129f9fdc89d8a27ea5ceeb9d6`.
GE-Proton combines components under their respective upstream licenses; the
MIT provisioning wrapper does not replace those licenses. The complete
distribution, including its component license files, remains in the server's
private `.voltra/proton/GE-Proton11-9` directory.
The helper can consume an independently verified copy in `.voltra/public-cache`;
it never shares writable game files or credentials between servers. This
compatibility preparation passed real archive extraction/dependency checks.
Fresh v4 native acceptance also passed Steam registration, loopback query,
world creation, native save/reload, exit-zero Stop and strict reinstall
preservation. See `artifacts/enshrouded-live-acceptance.json` and its cleanup
report. No client join or role permission exchange was tested.

The publisher currently documents a single `queryPort`, used as the primary
allocation. The original name, slots, four role passwords, Windows selector,
validation and update controls remain; new controls expose difficulty and chat.
Roles require distinct, nonempty passwords containing nonnumeric characters.
Existing custom groups, permissions and other JSON settings remain intact.
Save/log directories and the persistent Proton prefix stay within the volume.
Do not delete `.steam/steam/steamapps/compatdata/2278520` during normal upgrades.
There is no native interactive stdin console. The wrapper follows new native
log bytes, retains historical logs, redacts role credentials and forwards Stop
as SIGINT to the exact native Windows server process, which Wine reparents
outside the Proton launcher's process group. Its private Xvfb display runs in
a separate session and stays alive until native teardown finishes. Native
persistence/shutdown proof is separate from the supervision fixture. Earlier
old-Proton, bookworm ABI and display-less development failures remain separate
artifacts; they are not counted as successful final attempts.

Sources:

- https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaServer/ServerSource/GameMain.cs
- https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaServer/ServerSource/DebugConsole.cs
- https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaServer/ServerSource/Steam/SteamManager.cs
- https://enshrouded.zendesk.com/hc/en-us/articles/16055441447709-Dedicated-Server-Configuration
- https://github.com/ptero-eggs/yolks/blob/master/steamcmd/proton/Dockerfile
- https://github.com/mornedhels/enshrouded-server/issues/254
- https://github.com/mornedhels/enshrouded-server/pull/255
