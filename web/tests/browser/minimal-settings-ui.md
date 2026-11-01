# Minimal settings UI

Start the ordinary local frontend with `dev.ps1` as described in [local development](../../../docs/LOCAL_DEVELOPMENT.md). This fixture intercepts every API request; it does not change games, gateways or DNS records.

Run `node web/tests/browser/minimal-settings-ui.mjs` from the repository root. It uses Playwright Chromium. Optional environment variables:

- `PLAYWRIGHT_MODULE`: module name or file URL for an existing Playwright installation.
- `BROWSER_EXECUTABLE`: path to an installed Chromium browser.
- `UI_BASE_URL`: local Vite origin, default `http://127.0.0.1:5181`.

Checks cover URL tabs after refresh and Back/Forward; cancelling and confirming dirty navigation; failed DNS and Steam saves preserving drafts; DNS clearing through Save/Discard; read-only controls; transient save confirmation; and horizontal overflow at phone and ultrawide widths. These are mocked UI checks, not provider or gameplay acceptance.
