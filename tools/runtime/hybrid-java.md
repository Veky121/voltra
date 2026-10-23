# Arclight, Canvas and SpongeVanilla

Exact recipes reserved by `hybrid_java`:

- `minecraft/java/arclight/egg-arclight.json`
- `minecraft/java/canvas-mc/egg-canvas-mc.json`
- `minecraft/java/spongevanilla/egg-sponge-vanilla.json`

Generate `.local/hybrid-java/profiles.json` with
`node tools/runtime/stage-hybrid-java-profiles.mjs`. This stage preserves reviewed
verification/detail when regenerated; it does not modify shared overrides.

The scoped installer reuses the existing Minecraft path guards, public HTTPS
redirect validation, executable JAR inspection and atomic asset writer. It
preserves EULA, worlds, properties, libraries, configs, mods/plugins and JVM
settings. A pinned download cache is reused only after hashing its actual bytes.
No publisher code is executed during source fixtures.

Original controls remain available. Arclight supports Minecraft version,
Forge/NeoForge/Fabric loader, stable/beta/explicit publisher channel, custom URL
and custom JAR. Automatic selection chooses a loader-supported version. Its
default remains Forge1.21.1 and recommends the explicitly labelled publisher
beta1.0.2-SNAPSHOT-494b2c8 after native acceptance. Stable1.0.1 remains selectable
with a known core-Mixin startup failure warning (upstream issue1927); no silent
fallback occurs. The newer26.1.2 branch does not publish Forge. Canvas
retains exact/latest Minecraft and Jenkins build controls. SpongeVanilla retains
exact/latest/recommended Sponge release and custom filename, including a filename
without its extension (Java accepts it; startup and publication agree).

Defaults measured against official publishers: Canvas26.3/build991 Java25;
Arclight1.21.1/FeudalKings1.0.1 Java21; SpongeVanilla1.21.10-17.0.0 Java21.
GitHub's SHA256 and Sponge's SHA1 are checked before recording strong measured
SHA256 pins. Canvas's publisher URL/build identity and measured SHA256 are pinned;
no independent publisher checksum is claimed.

All use existing Java settings and React setup. Canvas uses the existing
Folia-compatible plugin browser: its official documentation and native loader
require Folia scheduling and explicitly marked compatible plugins. Arclight's original loader determines exact mod
compatibility via the approved generic alias; Bukkit plugins remain separate
uploads. Sponge plugins require SpongeAPI, with no Bukkit/Paper compatibility
claim. Unsupported or ambiguous publisher combinations fail clearly rather than
silently changing the administrator's explicit choice.

`node tools/runtime/test-hybrid-java.mjs` runs nine network-free fixtures:
original controls, loader/version resolution, exact assets, publisher ambiguity,
strong cache validation, operator preservation, corrupt downloads and symlink
prevalidation. Native acceptance is separate and requires a fair common lease;
no runtime verification is implied by these fixtures.

Publisher references:

- https://docs.canvasmc.io/canvas/getting-started/installation/
- https://canvasmc.io/api/v2/builds/latest?project=canvas
- https://github.com/IzzelAliz/Arclight/releases/tag/FeudalKings/1.0.1
- https://files.hypoglycemia.icu/v1/files/arclight/minecraft
- https://dl.spongepowered.org/spongevanilla
- https://dl-api.spongepowered.org/v2/groups/org.spongepowered/artifacts/spongevanilla/latest?recommended=true

Canvas development attempt: first native game boot reached readiness but rejected
the ordinary Bukkit acceptance fixture. This exposed a compatibility assumption
in the initial stage; corrected to Folia and retained the failed fixture log.
No server-program failure, silent retry or initial-success claim is made.

Arclight explicit beta native evidence: artifacts/arclight-live-acceptance.json,
arclight-cleanup.json, arclight-development-failures.json.152 files including
worlds/config/plugins/libraries survived reinstall with strict mode/UID/GID
preservation; Bukkit plugin boots1-to2-to3, real native NBT storage reload and
three Stop0 cycles passed. Bukkit World PDC does not persist on this publisher
build; this limitation is retained and not presented as successful compatibility.

Sponge native game readiness passed with actual autoJava21/custom filename
without.jar and protocol773. Its acceptance plugin was not found in root plugins/;
actual generated launch.properties uses primary mods/ and additional mods/plugins.
The subsequent fixture-directory correction/start was automatically policy-blocked
before execution. No retry or bypass is allowed, and plugin/reinstall acceptance
is not claimed. See artifacts/spongevanilla-policy-blocked.json.
