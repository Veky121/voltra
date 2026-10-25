# StarRupture local passwords and Windrose first-run generation

Research-only checkpoint2026-10-23. Ocean adapter and canonical profiles remain
unchanged. No password, credential, encoder POST, external secret request,
private key, game/runtime binary download, build or native process occurred.

## Result

No licensed standalone StarRupture encoder with an exact public-key/padding/
encoding contract was located in the bounded sources reviewed. The existing
legitimate encrypted-file prerequisite therefore remains a concrete feature gap.
There is a promising **local native-function route**, not a ready encoder: a
maintained MIT server plugin contains password hooks that call the original
engine routines. That route needs explicit implementation/native compatibility
work and cannot be labeled solved by source inspection.

Windrose's publisher documents first-start file generation, not an offline
generate-only command. Its documented persistent IDs must not be invented or
copied from examples. Existing uploaded-publisher-config prerequisite remains
until a bounded, network-isolated official first-run method is authorized and
verified. Community shell first-run wrappers do not by themselves establish safe
allocation binding or save completion.

## StarRupture evidence

Primary maintainer page:
https://starrupture-utilities.com/passwords/ describes PHP/OpenSSL server-side
encryption and form POST adminpassword/playerpassword, thanking mja00 for RSA
keys. The maintainer homepage identifies RSA4096 public-key encryption. Neither
an inspectable licensed key, exact padding/hash/encoding nor local encoder source
was exposed in the GET page. No request containing even a test password was sent.
RSA4096 alone is insufficient to choose OAEP/PKCS1v1.5, input encoding, output
encoding or key identity; **none is guessed**.

Bounded public repository review:

| Repository | Pin | License / result |
|---|---|---|
|AlienXAXS/RuptureServerManager|2732cc3babc76fca2d3d9e61ec3422dfac68d0e9|AGPL3; tree did not expose a local password/key/crypto component|
|AlienXAXS/StarRupture-Random-Utilities|196707177180ee22caa3b9d3c50b4c0a0572f5d1|No license metadata; no password/encryption/key-named source in inspected tree; not an integration candidate|
|AlienXAXS/StarRupture-Plugin-ServerUtility|89cb8aa60304fe57edd385501b4ab568488ff25c|MIT; native password hook source exists, last repository push2026-10-05; releasev0.19.0|
|AlienXAXS/StarRupture-ModLoader|168a9c75dc04b0b00ea0c8866df8769fff60d8d2|MIT; releasev1.22.0; plugin interface available within MIT repo|
|AlienXAXS/StarRupture-Plugin-SDK|da686928d2d322ca266054b1ba088b438e5ee728|No repository license metadata; do not bundle as if MIT|

ServerUtility hook source:
https://github.com/AlienXAXS/StarRupture-Plugin-ServerUtility/blob/89cb8aa60304fe57edd385501b4ab568488ff25c/src/hooks/set_password/set_password.cpp

It defines SetPassword and SetPlayerPassword hook functions. It calls the
original engine function first, then calls the original again with an override
FString. Comments explicitly aim to use engine validation/hashing. Its current
input is Windows GetCommandLineW -Password=/-PlayerPassword=, not protected input.
No cryptographic key or independent algorithm is implemented there.

**Important negative finding:** current src/plugin.cpp has no
SetPasswordHook::Install call. The source is listed in the .vcxproj, but source
inclusion is not activation. Current game_signatures.h does not provide password
function patterns. README does not advertise those password CLI switches. The
existing hook is an implementation lead, not evidence that released plugin
actually sets passwords. No claim of compiled/runtime support is made.

MIT ModLoader interface:
https://github.com/AlienXAXS/StarRupture-ModLoader/blob/168a9c75dc04b0b00ea0c8866df8769fff60d8d2/StarRupture-ModLoader-Core/plugins/plugin_interface.h

The public header depends only on windows.h/cstdint, so a narrow plugin may avoid
copying the unlicensed separate SDK. It offers object discovery and
InvokeUFunctionByName/ResolveUFunction/InvokeResolvedUFunction. Its comments warn
that parameter marshaling is not provided and buffers must match exact native
layout; name presence does not establish a safe call signature. Full loader build
also references a generated StarRupture SDK submodule at
659656c002e883312db46433c7b388a1184d6ad9. This is not assumed to grant redistribution
rights to publisher-generated/game-derived contents. No such SDK was fetched.

### Proposed local password implementation, subject to root approval

1. Build a **minimal server-only MIT plugin**, using only a licensed loader
   interface and independently authored glue. Exclude ServerUtility's RCON/web
   server, max-player patches and gameplay changes.
2. Resolve the native password object/method through a maintained public loader
   API only after the exact current method names/layout/lifecycle can be
   established from legitimate native interfaces. Do not assume dormant hook
   addresses or probe fabricated crypto/padding. Fail closed on missing or
   ambiguous methods/layout/version.
3. Provide original ADMIN_PASSWORD/PLAYER_PASSWORD through a confined private
   one-shot input file/pipe, never argv or a network API. Parse bounded Unicode,
   reject malformed state, redact logs, clear transient buffers/input after use.
   Existing native encrypted files remain authoritative unless the user
   explicitly changes their corresponding original control. Retain bytes/mode/
   UID/GID and receipt-owned update semantics.
4. Invoke the game's original functions and observe its own generated native
   Password.json/PlayerPassword.json. Do not ship a private key, bypass login,
   skip publisher password checks, or claim a standalone encoder.
5. Before integrating automatic generation, require a separately authorized
   pinned-version native acceptance: actual game-created files, password-change
   behavior, no credential argv/network/log leak, preservation/restart and
   success/failure cleanup. These cannot be proved with only crypto fixtures.

The publisher's existing official in-game Manage Server method remains another
legitimate route, but automating it would require a licensed client/native
interface and supported workflow; this research does not re-enable the currently
disabled remote-management endpoints or assume their protocol safe/stable.
Existing Ocean report also records the publisher's2026-10-20 dedicated-support
sunset/last-compatible0.3.5; any native plugin compatibility must pin the actual
supported branch/build, not invent a future legacy-branch name.

## Windrose evidence and proposal

Publisher source, read2026-10-23:
https://playwindrose.com/dedicated-server-guide

It specifies:

* ServerDescription.json and WorldDescription.json auto-create on first start;
  start/stop once before editing.
* PersistentServerId is generated and must not be edited.
* WorldIslandId must match a generated world's IslandId and its world folder.
* R5WorldDescriptionUpdater.exe applies world edits; it is **not documented as
  a server/world ID-generation tool**.
* DirectConnectionServerPort is the configured TCP+UDP direct-connect port.
* Official Docker instructions use windroseserver/windroseserver:latest and a
  mounted ServerDescription.json, but do not document missing-ID behavior,
  generate-only mode, or an offline first-run protocol. No image was pulled.

Primary maintainer wrapper source:
https://github.com/UberDudePL/windrose-dedicated-server-docker/blob/a5a09294278c7751c93999a0640093168aa1e228/scripts/server.sh
is MIT. first_run_generate_config starts the real game, waits for the config,
then terminates it. It supplies -PORT/-QUERYPORT/-MULTIHOME; those are maintainer
usage, **not publisher-confirmed guarantees of all sockets during bootstrap**.
Its broad user/process-name pkill and prefix-rebuild fallback are unsuitable for
our ownership boundary and must not be imported.

The GPL3 indifferentbroccoli wrapper at
aaff5ac0f06f84bf1b6b92fea6238b5f5958434a similarly performs first boot before patching
the description. It initially supplies only logging flags, so it does not solve
our assigned-port bootstrap requirement. No wrapper's claims replace native
socket/identity proof.

If root chooses a future native experiment, the most defensible route is the
publisher's actual first-start generation inside an **owned disposable network-
disabled environment** with no host publications/default7777 exposure, no
operator world/config mounted and bounded resources/time. Observe actual full
generated server+world files, stop the exact owned process, validate unique JSON
and matching IDs, then apply configured allocation/password fields while stopped
before a normal managed boot. Do not invent IDs, copy documentation IDs, invoke
the world updater as a generator, or rely on an undocumented -Port override.
Whether generation completes without networking and whether the engine stops
cleanly remain unknown; fail without a non-isolated retry if it cannot.

This is a proposed acceptance experiment, **not an implemented supported offline
generation API**, and needs explicit resource/isolation coordination. Current
source-only prerequisite stays until proof exists.

## Review artifacts

`.local/star-bootstrap-research/source-manifest.json` records14 pinned source
files,223901bytes total, with SHA256. Only MIT sources/licenses from the plugin,
loader public interface and one Windrose wrapper were archived. No game SDK,
public/private cryptographic key, game/runtime binary or credential was fetched.
`artifacts/star-bootstrap-source-research.json` is the machine-readable result.
