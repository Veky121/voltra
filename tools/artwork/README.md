# Game library artwork

Public artwork consists of original SVG typography and geometric tiles. Game names identify compatible software. No publisher logos, screenshots, or marketing images are distributed in web/public/artwork or web/public/game-artwork.

Edit tools/branding/public-artwork-input.json to add names and exact identity mappings, then run:

```sh
node tools/branding/generate-public-artwork.mjs
node tools/artwork/verify.mjs
```

The generator runs offline and deterministically writes both client catalogs, the public source ledger, SVG tiles, and the original library background. It preserves template, category, guided-game, alias, kind, and app-ID mappings. The shared scalable 1000 by 500 viewBox supports existing thumbnail and hero layouts. User-provided server and pack icons remain separate authenticated API images.

The public ledger records generated file sizes and SHA-256 hashes. Its downloadedAt field is a legacy compatibility alias for generatedAt, not evidence of a download. Original compositions follow repository licensing; third-party game names and trademarks remain with their owners. UI fonts retain their separate OFL notices.

Historical sync-overview.mjs is an acquisition utility and is not the public release generator. Do not run it to prepare release artwork. Removed originals are privately backed up under .local/private-artwork-backup and are excluded from Git and Docker context.
