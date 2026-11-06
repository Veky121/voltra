# Mozilla reviewer build instructions

The Firefox package is built from local source with esbuild. No remote code,
obfuscation or minification is used. All dependencies are development tools;
the installed extension contains only the bundled first-party code and icons.

Use Node.js 22 or newer and npm. From the root of the source archive:

```
npm ci --prefix web --ignore-scripts
npm ci --prefix browser-addon --ignore-scripts
node browser-addon/build.mjs
npm test --prefix browser-addon
npm run lint:firefox --prefix browser-addon
```

The output for Mozilla is `browser-addon/dist-firefox`. `manifest.json` is the
shared Chromium base, and `manifest.firefox.json` overrides browser-specific
fields. The Firefox version is numeric, with the Nightly label in the name.
`web/src/notificationEvents.ts` is Voltra's shared notification event store.
Icons are copied unchanged from `web/public/brand`.

Firefox uses an event-page background script, the native sidebarAction API,
Promise-based browser APIs and extension-origin IndexedDB for credentials and
queue storage. No credentials are returned through messages or written to
Firefox storage.local, which is accessible to content scripts.

The ModHub content script only queues validated FS25 ZIP metadata. It cannot
connect, read credentials or servers, or submit a download. A user clicks the
toolbar icon to open Firefox's sidebar and explicitly submits the queue there.
Only the configured Voltra host receives the API key and selected mod metadata.
There is no telemetry. See PRIVACY.md for the data transmission description.

The automated native test can be run with a Firefox binary and geckodriver:

```
python browser-addon/tests/firefox-smoke.py /path/to/firefox /path/to/geckodriver
```

It creates its own temporary profile and loopback API fixture. Its fixture key
is not a real API credential. It does not access or change production servers.
Only the isolated test profile disables optional-permission prompts; the
distributed extension always requests permission through the normal browser UI.
