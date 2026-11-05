# Documentation

Start with the guide for your task. Runtime state and test receipts can change independently of these documents; historical acceptance is not proof of the current deployment.

## Run and maintain Voltra

| Task | Guide |
| --- | --- |
| Understand and build the app | [Project README](../README.md) |
| Start, restart or inspect local services | [Local development](LOCAL_DEVELOPMENT.md) |
| Configure and recover a deployed panel | [Operations](../OPERATIONS.txt) |
| Build and connect the Windows app | [Desktop](../desktop/README.md) |
| Publish signed updates | [Releases](../RELEASES.md), Nightly by default for agent work |
| Install or reconnect nodes | [Node operations](../tools/node/README.md) and [patched Wings](../WINGS.md) |
| Configure external browser login | [Cloudflare Access](../CLOUDFLARE.md) |
| Forward game ports | [Proxy gateways](../FRP_PROXY.md) |
| Configure server join names | [Managed DNS](FRP_SUBDOMAINS.md), separate from Cloudflare login |
| Migrate a Pterodactyl installation | [Migration tools](../tools/migration/README.md) |

## Games and files

| Topic | Guide |
| --- | --- |
| Create and configure a game | [Game setup](../GAME_SETUP.md) |
| Java, loaders, mods and plugins | [Minecraft](../MINECRAFT_SETUP.md) |
| Managed install, update and verify | [Steam](../STEAM.md) |
| Dedicated server and licence setup | [Farming Simulator 25](../FS25.md) |
| Browse, edit and transfer files | [File manager](../FILE_MANAGER.md) |
| Provider-specific download headers | [Remote downloads](../REMOTE_DOWNLOAD_HEADERS.md) |
| Automatic server images | [Server artwork](../SERVER_ARTWORK.md) |

## Developer references

- [Connector wire protocol](../internal/steamapi/PROTOCOL.md).
- [Notifications](PANEL_NOTIFICATIONS.md), [game operation reporting](GAME_OPERATION_REPORTING.md) and [live events](LIVE_EVENTS.md).
- [Tool documentation](../tools/README.md) and [browser fixtures](../web/tests/browser/README.md).

Agent instructions, handoffs, working notes and local test receipts stay on the developer's machine and are excluded from source publication and application packages.

## Attribution

Retain [LICENSE.md](../LICENSE.md), [third-party notices](../THIRD_PARTY_NOTICES.txt), bundled dependency licences, [brand guidance](../branding/README.md), [game icon sources](../web/public/game-icons/SOURCES.md) and [artwork sources](../web/public/artwork/SOURCES.md).

## Keeping these docs current

Put reusable instructions in the relevant guide and link to them. Keep dated measurements, failed attempts and acceptance receipts in history or the owning tool's notes. Update navigation and API examples when behavior changes. Avoid copying release signing, local runtime or permission rules into feature guides. Preserve existing link targets when consolidating documents.
