# Voltra Companion

Version 0.1.0-nightly.7. Manifest V3 extension for Firefox desktop 142+, Brave, Chrome and Edge.

## Download and install

Download [voltra-companion-0.1.0-nightly.7.zip](https://github.com/Veky121/voltra/releases/download/companion-v0.1.0-nightly.7/voltra-companion-0.1.0-nightly.7.zip). This is the ready-to-load extension. GitHub's automatic Source code ZIP is for developers.

1. Extract the ZIP into a permanent folder.
2. Open `brave://extensions`, `chrome://extensions` or `edge://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted folder containing `manifest.json`.
4. Pin the Voltra icon, open its sidebar, enter your API domain and normal Voltra API key, then Connect.
5. On an FS25 ModHub page, click **Add to Voltra**. Collect mods in the queue, select your server and send them together.

For updates, extract the new ZIP over the same folder and click **Reload** on the existing extension. Keep it installed to preserve your key and queue. ZIP installations do not update automatically. The ZIP includes these instructions in `INSTALL.txt`.

## Connect

Enter the panel domain and your existing client API key from Voltra Account > API keys. Bare domains get https:// automatically. No separate key type, server registration, addon API or addon database is needed.

The extension uses the account's existing permissions. All compatible accessible servers appear automatically, including servers added later. Offline, online and starting game states do not affect matching. Installation, suspension, node maintenance and transfer restrictions remain enforced by the normal API.

## Build and reload

From ptero-go, with the web workspace dependencies installed:

```powershell
npm ci --prefix browser-addon
node --test browser-addon/tests/*.test.mjs
node browser-addon/build.mjs
```

Load browser-addon/dist once using Load unpacked in brave://extensions, chrome://extensions or edge://extensions. After rebuilding, click Reload on the extension, refresh ModHub and click the Voltra toolbar icon. Keep using the same folder and extension installation; removing the extension clears its saved data. Unpacked extensions do not update automatically.

The toolbar opens a native browser sidebar. In Chromium, Add to Voltra also opens it. Firefox does not treat webpage clicks as privileged browser gestures, so Add to Voltra queues the mod and updates an already-open sidebar. Click the toolbar icon to open it. The extension reuses the app's existing Voltra icons in the toolbar, extension manager and panel header.

## Remembered settings and queue

The API address, normal API key, selected server and mod queue persist in local extension storage. Input drafts are saved even when Connect fails. A failed connection edit preserves the previously working connection. Leave the key field blank to reuse the saved key; Forget saved key removes the credential but preserves the domain and queue. Previous saved connections and session-only requests migrate without reinstalling.

Collect mods from multiple ModHub pages, choose a compatible server and click Add N mods to server. The extension submits each queued download through the existing client API and tracks each result. Repeated clicks on the same mod reuse its queue entry. Completed or uncertain entries are never automatically submitted again; check Voltra Files before dismissing an uncertain record. Closing the panel does not cancel server downloads. If the browser stops mid-submission, unsent items remain ready and an interrupted request remains uncertain. Queue capacity is 100 entries.

## Standard API flow

- GET /api/client?per_page=100&page=... validates the connection and lists accessible servers with pagination.
- GET /api/client/servers/{server} provides game features and current permissions.
- GET /api/client/servers/{server}/files/list?directory=... checks for an existing filename.
- GET /api/client/servers/{server}/files/pulls checks ongoing downloads and reports progress.
- POST /api/client/servers/{server}/files/pull queues {url, filename, directory, tracked:true}.

The extension sends the instruction only. Wings downloads the ZIP directly from GIANTS to /data/mods. No ZIP passes through the extension. Existing-file checks are preflight checks, not atomic exclusion against independent uploads.

The FS25 module identifies the reviewed profile through egg_features containing voltra_fs25, never by a user-editable server name. The server detail must grant file.read and file.create, or *. ModHub supplies the game edition, mod release and direct GIANTS ZIP link. Required engine patch, archive compatibility, dependencies, DLC and game activation are not verified. A completed transfer means the ZIP was downloaded.

## Credentials and gateway

The API key stays in this browser profile. Chromium uses local extension storage restricted to trusted contexts; Firefox uses extension-origin IndexedDB because Firefox cannot restrict storage.local access. It is never exposed to website scripts or returned to the extension UI. It is an ordinary client API key with the account's normal authority. Forget saved key removes saved credentials; revocation in Voltra blocks future requests.

The website can only open a validated mod request. Installation requires an explicit action in the extension window. The background worker validates the module, link, server metadata and permissions, and constructs the API path and destination. It is not a generic website-controlled fetch proxy. Requests omit cookies and do not follow redirects.

The separate addon API and custom vext_ key implementation were removed in Nightly.5. The one remaining panel compatibility fix lets an already authenticated client API key pass the browser-origin check for client API routes. Cookie sessions and unverified Authorization headers retain their origin protection. An older panel may require that fix if extension writes return 403.

Cloudflare Access can still block the normal API before Voltra checks the key. An API-key-only deployment must let the required standard API paths reach Voltra's authentication. The old proposed /api/client/addon/* exception is no longer applicable. Running the extension build does not change gateway configuration.

### njimgang.org deployment

Use `https://api.njimgang.org` with an ordinary client API key. This hostname routes through the existing Cloudflare tunnel to a dedicated loopback gateway on port 18190. Only `/api/client` and child routes accept `ptlc_` credentials. Voltra authenticates the key and enforces account and server permissions. Other routes return 404. The gateway strips cookies and Cloudflare identity assertions; the browser dashboard remains on `https://dashboard.njimgang.org` behind its existing Access policy. Existing `desktop.njimgang.org` connections still work. No new key type or panel binary was deployed.

On 2026-11-06 the new API hostname returned 200 for a normal client key listing five servers and reading the FS25 mods folder. Missing and invalid keys returned 401. Admin, application, setup, session, root and lookalike client paths returned 404. Tests used the public Cloudflare edge with TLS hostname verification while the local resolver cached the earlier NXDOMAIN; Cloudflare public DNS already returned the new address.

Gateway checks confirmed missing and invalid client keys return 401, client keys cannot enter admin/setup/session routes, and lookalike `/api/client-spoof` paths return 404.

A live check on 2026-11-06 used an ordinary key created through Account > API keys. The API listed all five accessible servers. The extension's actual background source, run with an in-memory Chrome storage/message adapter and real HTTPS requests, connected, matched the FS25 server, checked permissions and existing files, and submitted the tracked remote download. The real FS25 page parser extracted Alpine Farm Pack from ModHub. Wings completed `FS25_Alpinefarm_Pack.zip` in `/data/mods`; the file-list API independently reported 128,190,179 bytes. The same request could not be submitted twice. No game restart or activation was performed. This verifies the live API flow and background logic; it does not establish the Brave popup, browser host-permission prompt, or installed content-script click flow.

## Modules and distribution

src/modules/index.js registers bundled modules. FS25 owns page extraction, mod validation, server matching and the destination directory. Credentials, API requests and transfer tracking are shared. UI feedback uses Voltra's notification event store.

GitHub can host source and Nightly ZIPs for testers. Normal installation and automatic updates should use Chrome Web Store / Microsoft Edge Add-ons. Firefox uses a separate Mozilla-signed XPI for permanent installation. No publication occurs during a build.

```powershell
Compress-Archive -Path browser-addon/dist/* -DestinationPath browser-addon/voltra-companion-0.1.0-nightly.7.zip -Force
```

Future Modrinth and CurseForge modules should use the existing Minecraft content-install API with project/version IDs and respect its compatibility, dependency and stopped-server rules.

## Firefox

Use the Mozilla-signed Firefox XPI from the Nightly release. Open `about:addons`,
choose the gear menu and **Install Add-on From File**. Select the signed XPI.
For development only, load the unsigned Firefox ZIP through
`about:debugging#/runtime/this-firefox` > **Load Temporary Add-on**. Temporary
installations are removed when Firefox exits.

Build outputs stay separate: `dist` for Chromium and `dist-firefox` for Firefox.
Run `npm run lint:firefox --prefix browser-addon` to validate with Mozilla's
validator and `python browser-addon/package.py` to package both builds and the
reviewer source archive. See [reviewer instructions](REVIEWER.md).

The native Firefox test passed on Firefox Nightly 162.0a1 with an isolated
profile and loopback API fixture. It verified the actual toolbar sidebar,
connection, private credential storage, queued submission, completion tracking,
and preservation of credentials and queue after a full browser restart.
The test auto-accepts optional permissions only in its isolated profile. It
uses an API fixture, not a live game-server download.
