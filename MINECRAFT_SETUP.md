# Minecraft setup

Game Library opens Minecraft setup with a choice between a custom server and a modpack. Custom setup selects the game version, loader, Java runtime, memory and node. Modpacks use an in-panel CurseForge or Modrinth catalog. The panel resolves the selected pack's game and loader versions before provisioning through the existing server lifecycle and Wings installation flow.

An administrator installs new servers. The selected node needs an available allocation and enough memory and disk capacity. The setup form requires the user's Minecraft EULA acceptance.

## Provider credentials

Save one enabled, unscoped CurseForge integration in Admin > Integrations to use CurseForge. Its API key stays encrypted in the panel and is used for provider API requests. Modrinth's public catalog does not require a token. Mod and plugin management can use an optional global Modrinth token.

CurseForge modpack setup requires an author-published server pack with API downloads enabled. Packs requiring custom launch scripts may need manual setup. Modrinth pack installation reads the pack manifest, omits files marked unsupported or optional on the server, and applies shared overrides followed by server overrides. Download integrity and archive paths are checked before installation.

## Java runtimes

Admin > Java runtimes registers container images by Java major version and distribution. Automatic selection reads the official Minecraft version metadata, then applies loader requirements and matching administrator runtime rules. Release boundaries are a fallback for older metadata without a Java version. A newly required Java major needs a registered image; it must not silently fall back to an older JVM.

Register a custom image for a pack that requires GraalVM or another distribution. The image must provide Java, Bash and the Pterodactyl Yolks STARTUP environment contract. Minecraft runtime rules can target a provider project, pack version, loader or exact Minecraft version and require a Java distribution, minimum major, minimum container memory and extra JVM arguments. Rules affect new installations. Existing servers retain their stored Java settings.

An egg can enable Java controls and choose command or argument-file memory management. Eggs without Java metadata retain their existing startup behavior. Exported eggs carry these settings in `voltra.java_config` alongside the native egg fields.

## Memory

The UI displays GiB and stores integer MiB. For example, 1.5 GiB becomes 1536 MiB, and 0.25 GiB becomes 256 MiB. The launcher generates whole-MiB options such as `-Xms256M -Xmx1843M`. Java 8 already supports the `G` suffix; integer `M` values also represent fractional GiB exactly.

The maximum heap leaves the larger of 128 MiB or 10 percent of the container limit for native Java memory. Automatic maximum heap uses the remaining budget. Initial heap cannot exceed maximum heap. A server with unlimited container memory needs an explicit maximum heap.

Command mode replaces old heap flags and adds the managed settings to a direct Java command. Argument-file mode updates the configured JVM argument file at launch, preserves unrelated arguments and comments, and ensures the launcher reads that file. Java 8 uses command mode. Modern Forge and NeoForge also retain their loader argument file. Changes apply on the next server start.

## Mods and plugins

Managed Minecraft servers have a Mods & plugins page. It uses the stored game and loader version to search compatible projects and files, resolves required dependencies, and installs checked JARs in `mods` or `plugins`. The server must be stopped for installation or removal. Existing file permissions still apply.

The default Modrinth filter shows server-compatible content and excludes client-only and singleplayer-only projects. Select "Works without client mods" to hide projects that also require installation on players' clients. Project cards label client requirements. New environment metadata takes precedence over legacy side declarations, and selected versions are checked again. Unverified CurseForge mods are hidden until the user enables their display.

Modrinth declares dedicated-server support. CurseForge does not expose an equivalent mod compatibility field, so CurseForge mod installation requires acknowledgment that the author supports the selected mod and dependencies on a server. Matching loader and game versions alone cannot establish that compatibility.

## References

- [Official Minecraft version manifest](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json)
- [Modrinth pack format](https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack)
- [CurseForge API](https://docs.curseforge.com/rest-api/)
- [NeoForge server installation](https://docs.neoforged.net/user/docs/server/)
- [Java launcher options](https://docs.oracle.com/en/java/javase/21/docs/specs/man/java.html)
- [Yolks Java entrypoint](https://github.com/pterodactyl/yolks/blob/master/java/entrypoint.sh)
