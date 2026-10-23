# Fabric, Forge, NeoForge, Quilt and Spigot

The imported recipes reuse the existing managed Java settings, Minecraft content browser, file manager, console and React setup controls. No per-game page or private runtime is added. Original variable names remain authoritative; duplicate hidden Minecraft version fields are not introduced.

`modded-java-install.py` converts original controls into the existing verified Minecraft install-plan format. It runs `minecraft_install.install` in temporary staging, then validates every publication path before writing. Atomic replacement preserves old ownership and permissions. Same-filesystem rollback backups restore the original program if publication fails. Existing EULA choice, properties, mods, configurations, JVM files and worlds are retained. Fresh installation never accepts the EULA. A confined disk work directory keeps downloaded JDKs and generated programs out of Wings' small installer `/tmp` filesystem; the shared installer's optional scratch argument leaves existing callers unchanged.

Original controls:

| Recipe | Controls |
| --- | --- |
| Fabric | `MC_VERSION` exact/latest/snapshot; `FABRIC_VERSION` installer; `LOADER_VERSION` exact/latest/snapshot; custom `SERVER_JARFILE` |
| Forge-enhanced | `MC_VERSION`; exact promotion `BUILD_TYPE`; full `FORGE_VERSION` overrides both; custom JAR for legacy releases |
| NeoForge | `MC_VERSION`; explicit `NEOFORGE_VERSION`, including original1.20.1 Forge namespace |
| Quilt | exact `MC_VERSION`; custom JAR; optional explicit loader and installer versions |
| Spigot | `DL_VERSION`; administrator `DL_PATH` with version substitution as URL data; custom JAR; optional custom SHA256 |

Current defaults pin Minecraft26.3 and official installer identities: Fabric0.19.5/installer1.1.2, Quilt0.30.1/installer0.15.1, Forge66.1.0 and NeoForge26.3.0.95. The defaults prefer Java25. Historical releases require an appropriate explicit runtime. Forge argfile eggs can declare optional `legacy_startup`, a validated direct Java JAR command used only with Java8; modern runtimes retain their normal argument-file startup. Server settings cannot override this egg metadata.

Spigot is built locally from official sources using pinned BuildTools201, Git and a compatible verified JDK. Source identity is checked before and after compilation. No Spigot server JAR is redistributed by the catalog. The administrator custom-download route remains available without shell evaluation.

Reinstall reuses a same-plan program cache only after hashing every recorded program file. Missing or altered files trigger the genuine installer. Spigot's cache likewise requires matching official source identity, BuildTools identity and built JAR checksum. Operator data does not invalidate the program cache.

The shared content browser resolves original version aliases and explicit Forge/NeoForge overrides. Ambiguous or unresolved identities stay unsupported instead of displaying falsely compatible content. Modrinth uses exact loader declarations and existing dedicated-server filters. CurseForge cannot establish mod dedicated-server compatibility or Folia/Spigot plugin API compatibility: those results remain hidden unless explicitly requested, and installation requires author-compatibility acknowledgment. Strict server-only filtering continues to exclude unknown compatibility. Spigot is never labeled Paper to obtain extra plugins.

Source checks: `node tools/runtime/test-modded-java.mjs` (nine fixtures), the shared `minecraft_install_test.py` (eight fixtures), PostgreSQL-backed `TestJava`/`TestMinecraftContent`, frontend TypeScript and existing setup/template model tests. Native evidence is separate per recipe and never establishes player gameplay. Quilt's Meta API checksums disagree with current official Maven assets; pinned Maven downloads/sidecars, the official latest-download redirect and installed program hashes are recorded in the publisher-discrepancy artifacts rather than claiming both sources agree.
