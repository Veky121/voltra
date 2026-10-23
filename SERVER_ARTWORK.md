# Automatic server icons

The server overview, dashboard hero and compact workspace header share
`ServerIdentityIcon`. The icon beside a server name tries, in order:

1. Minecraft Java's `/server-icon.png` from that server's root directory.
2. The icon of the modpack selected during a managed Modrinth or CurseForge install.
3. No separate icon; the existing game artwork remains in the wide card/banner.

Square server icons are never stretched into banners. Pack names remain visible
even when a server has a custom display name. Other games retain their existing
artwork. No game containers or server files are modified by image detection.

Managed Minecraft eggs and pinned Java, crossplay and Java proxy templates are
recognized by their features or immutable recipe identity. Bedrock templates do
not attempt to load the Java icon file. A server's display name does not grant
access to its files or determine whether the backend reads an icon.

## Access and image handling

`GET /api/client/servers/{server}/artwork/icon` requires server membership and
`file.read-content`, including on cache hits. It can read only the fixed root
icon path, rejects symlinks/directories, and accepts a valid 64 by 64 PNG with a
maximum source size of 256 KiB. Missing or invalid images return an empty 204
response, letting the UI fall back quietly. Existing installation, maintenance,
transfer and suspension gates still apply.

`GET /api/client/servers/{server}/artwork/pack` requires server membership. The
URL comes from saved, provider-verified metadata, never a request parameter.
Downloads and redirects stay on the approved Modrinth/CurseForge image CDNs;
provider keys and daemon credentials are not forwarded. Supported raster images
are bounded to 4 MiB and 1024 by 1024 pixels. Images are decoded and re-encoded
as PNG pixels, stripping metadata and appended content.

The panel memory cache is bounded to 128 entries and 16 MiB, coalesces concurrent
loads, and checks authorization before use. Successful server icons are cached
for 30 seconds, pack icons for one hour, and missing images for 15 seconds. The
visible UI retries every minute and on returning to the window. Image responses
are private and support ETags; the desktop proxy passes legitimate HTTP 304
responses through while continuing to reject redirects.

## Persistence and rollout

The additive `servers.minecraft_pack` JSONB column defaults to an empty object.
Provider, project ID, name and validated icon URL are written in the normal
server-creation transaction. Only the internal typed install plan supplies
these fields; arbitrary application API JSON cannot impersonate that plan.
Artwork metadata is omitted from the archive installation plan.

Existing servers immediately benefit from their own icon once the new backend
is running. Previously installed packs without saved identity retain the
Minecraft artwork fallback if they have no server icon. New managed pack
installs save their provider artwork automatically. Manually imported Java eggs
can declare the existing `minecraft` feature to enable icon detection.

Start the rebuilt backend to apply the additive column through its normal
schema migration, then publish the shared frontend and desktop build. This
feature's verification did not restart the running backend or modify live
servers. Integration is coordinating production builds separately.

## Verification

`server_artwork_test.go` covers fixed-path reads, permissions/revocation,
conditional caching, malformed/oversized images, symlinks, non-Minecraft and
Bedrock exclusions, CDN credentials/redirect restrictions, and cache bounds.
The pack-provisioning test verifies metadata persistence for both providers and
after a rename. Browser receipts under `artifacts/server-icons` explicitly use
isolated API fixtures and real provider artwork; they are UI evidence, not a
claim that the running backend was updated.

## Optional panel artwork pack

Administrators can set `ARTWORK_DIRECTORY` to an absolute private directory on the panel host, outside `WEB_DIR`. The restored local pack is `.local/artwork`; the backup remains in `.local/private-artwork-backup`. No private images or source catalogs belong in the public repository, web build or desktop installer. Public builds include original Voltra SVG fallbacks.

The directory contains `manifest.json` and JPG, PNG or WebP files. Example:

```json
{"server":{"rust":"artwork/rust.jpg"},"library":{"steam-252490":"game-artwork/steam-252490.jpg"}}
```

Use IDs from `web/src/client/serverArtworkCatalog.json` for `server` and asset keys from `web/src/client/gameArtwork.json` for `library`. Paths are relative to the private directory. Unlisted files and source metadata are never served. Files must be regular rasters of at most 8 MiB, 4096 pixels per side and 8 million pixels. The decoded pack is limited to 512 unique images and 128 MiB of encoded PNG data. Invalid or missing entries retain the original SVG tiles.

The pack loads on the first authenticated artwork request and stays fixed for that panel process. Set the environment variable and restart the panel during your normal maintenance window to apply changes. No admin upload UI is provided yet. Operators are responsible for permission to host their chosen artwork.

Web and desktop request one authenticated `/api/client/artwork/catalog` per account shell mount. Only matching IDs override built-in tiles. Images use same-origin `/api/client/artwork/<sha256>.png` paths, private caching and ETags. Desktop credentials remain in its existing native API proxy. Server and modpack icon routes retain their priority. Offline or failed catalog requests leave built-in artwork visible.
