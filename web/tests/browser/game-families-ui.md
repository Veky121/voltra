# Game family selection

Run `node tests/browser/game-families-server.mjs` from `web`, then open
`http://127.0.0.1:5196/tests/browser/game-families-ui.html?suite=1`.

The fixture uses pinned catalog data and the real GameLibrary/GameCatalog components. All API fetches are intercepted; non-GET requests and unexpected endpoints fail. There is no API proxy or backend connection. The result at the bottom reports the assertion count.

Coverage includes one card per game, distinct Counter-Strike games, default-first choices, recipe routes, browser Back restoring the selector, close, patch search, guided aliases, permission gating, catalog failure and retry. Open the same URL without `suite` for manual keyboard, Escape, focus return and 360/390px visual checks. No installation is performed.

Model coverage: `node --experimental-strip-types --test tests/gameFamilies.test.mjs`.
