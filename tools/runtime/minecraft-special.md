# Minecraft services

Four exact imported recipes are staged by `stage-minecraft-special-profiles.mjs` in `.local/minecraft-special/profiles.json`. They reuse the shared React template form, native file/config/console/lifecycle APIs, and managed Java where applicable. No production refresh is required to inspect their source.

| Recipe | Runtime and publisher identity | Allocations |
| --- | --- | --- |
| ClassiCube MCGalaxy | Publisher MCGalaxy ZIP with strong checksum; pinned Linux amd64 Mono image | Classic/CPE TCP |
| Cuberite | Native publisher build445, source ffa3279d, Apache2 | Minecraft1.8–1.12.2 TCP plus distinct WebAdmin TCP |
| VanillaCord | Official VanillaCord8d4493ac and Bridge cac7ab1c MPL2 source, pinned Maven3.9.11, Mojang-checksummed input jar | Minecraft TCP |
| Purpur/Geyser/Floodgate | Purpur26.3 build2654, Java25; Geyser2.12.0 build1269; Floodgate2.2.5 build141 | Java TCP, distinct Bedrock TCP+UDP, distinct WebRTC UDP |

`minecraft-special-releases.json` records the complete download URLs, SHA256 identities, source commits and license identities. Publisher license files are downloaded with separate strong identities and kept under `.voltra/minecraft-special/licenses`. Program/source downloads are verified before use. A verified public cache retains source archives and binaries, never writable worlds or credentials. Cuberite's original mutable download URL was replaced by its exact official Jenkins build445 artifact after checking equal bytes.

VanillaCord's original `src.me1312.net` and current documented `dev.me1312.net` hosts failed DNS during this run. Their public source remains available. The installer builds Bridge's ASM library, Maven plugin and compile-only API first, then VanillaCord. It assigns the upstream unpublished `-PLACEHOLDER` version24w25a and removes the dead private Maven repositories. Original implementation source and upstream ASM9.7 remain unchanged. Mojang's official metadata and server checksums are verified, and the actual VanillaCord patcher processes an input/output jar pair. Source licenses, source SHA identities and generated patcher hash are retained. Default1.21.4 is explicit; original `latest` and exact version selection remain available and never silently substitute another Minecraft version. Newer unsupported class/protocol layouts may fail patching. No unpatched vanilla jar is installed as fallback.

Purpur's original version/build/jar controls remain present, including the installer's former hidden `DL_PATH` capability. Reviewed defaults are pinned. Historical Purpur builds and custom public HTTPS downloads require operator-reviewed SHA256 because Purpur metadata only supplies MD5. URL placeholders are literal data, never shell evaluation. Geyser uses the current `java.auth-type` schema and real Floodgate plugin. BOTH enables legacy RakNet and modern NetherNet. Private defaults use built-in signaling with STUN discovery off. Configure real advertise addresses, TLS and port forwarding for external topology. No external Xbox/Microsoft account or signaling enrollment is created.

Cuberite uses a scoped typed startup writer because Wings INI alignment produces keys the native parser ignores and collapses repeated Plugin entries. The writer preserves repeated native plugin keys, comments and unknown sections, writes exact assigned ports and private credentials, then execs the native binary. Cuberite's WebAdmin password is required operator input and uses a masked form control. Its native `webadmin.ini` is private. MCGalaxy public listing is opt-in; all original name and MOTD controls remain available. World data, plugins, ranks, native settings and forwarding/authentication keys are operator data. Native programs are replaced on reinstall, while operator files and plugin configuration stay in place. EULA acceptance remains the operator's choice for Mojang-based Java servers. Cuberite and MCGalaxy do not inherit Java/EULA/content claims belonging to a different engine.

Verification commands:

```text
node tools/runtime/stage-minecraft-special-profiles.mjs
node tools/runtime/test-minecraft-special.mjs
go test ./internal/panel -run '^TestMinecraftSpecial' -count=1
```

`minecraft-special-create.mjs` requires the ordinary atomic shared weighted lease before creating any isolated acceptance resource. Receipts are private and duplicate creation is refused. Native reports must separately prove startup/config/query, stop0/noOOM, strict reinstall file+metadata retention and complete owned cleanup before releasing that lease. A native status packet is not a player join, crossplay session, authenticated proxy forwarding test or gameplay proof. MCGalaxy has no unauthenticated Minecraft Java status protocol; acceptance must not manufacture a player login to claim query parity.
