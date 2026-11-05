# Game setup

Create servers through Game Library. Choose a game and template, then a node, resources, version and any required credentials or agreements. Optional settings remain in the server workspace. Installation and game agreements require explicit actions.

## Templates and settings

The bundled catalog uses pinned recipe definitions. A reviewed override can change a recipe; a changed executable recipe hash receives a distinct egg identity so catalog refresh does not overwrite existing operator edits. Catalog size is not a count of verified playable games.

Community recipes share one setup form. Minecraft has loader, modpack and Java controls. Managed Steam profiles have app-owned install, update and verify actions. Community Steam recipes keep their own update behavior unless a reviewed managed profile replaces it.

- [Minecraft](MINECRAFT_SETUP.md): loaders, Java, memory, mods and provider credentials.
- [Steam](STEAM.md): managed profiles and maintenance rules.
- [Farming Simulator 25](FS25.md): licence and dedicated-server requirements.
- [Server settings](SERVER_SETTINGS_CONTRACT.md): game settings, startup and resource controls.
- [Files](FILE_MANAGER.md): configuration files, uploads and downloads.
- [Proxy gateways](FRP_PROXY.md) and [join domains](docs/FRP_SUBDOMAINS.md): public game addresses.

User-facing memory and storage inputs use GB. APIs retain integer MiB, with 1 displayed GB equal to 1024 MiB. Zero/unlimited and swap sentinels must survive conversion.

## Template API

| Route | Purpose |
| --- | --- |
| `GET /api/client/game-library/templates` | Pinned catalog and source links |
| `GET /api/client/game-library/templates/{template}` | Administrator setup options, images and ports |
| `POST /api/client/game-library/templates/{template}/install` | Provision through the shared lifecycle and Wings pipeline |
| `GET /api/client/game-library/steam` | Managed Steam profiles |

Template installation accepts `name`, `request_id`, memory/disk in MiB, an allowed image, allocations and environment values. Existing validation, permissions and idempotency apply. Community template installations leave servers stopped for inspection. Managed profiles can have a different first-start workflow; see the Steam guide.

## Verification

Keep source validation, installation, native runtime, persistence and player joining as separate results. A valid recipe, running process or assigned port does not prove gameplay or public reachability.

`TestGameTemplateCatalogCompatibility` can write the checklist to `GAME_CATALOG_REPORT`. `node tools/runtime/game-source-coverage.mjs` reports source coverage from the catalog and mappings. Neither is a native game test. Use isolated test resources and preserve failed attempts and exact installed helper bytes when checking native behavior.

The former long rollout log is preserved in [game acceptance history](docs/archive/game-setup-rollout.md). Per-game implementation notes and bounded acceptance plans are indexed under [runtime tools](tools/runtime/README.md). Historical receipts apply only to their recorded source and runtime; inspect the current campaign state before resuming work.
