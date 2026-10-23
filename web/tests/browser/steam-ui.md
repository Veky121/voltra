Run from `ptero-go/web`:

```powershell
node --experimental-strip-types --test tests/gameSetup.test.mjs
npm run check
npm run build
node tests/browser/steam-ui-server.mjs
```

Open `http://127.0.0.1:5189/?suite=1`. The page reports each React DOM interaction test and exposes results as `window.__steamUIResults`. The suite covers install defaults and retries, permissions, native settings and revisions, missing defaults/files/folders, Steam requests and progress, bootstrap/start intent, and 390px layout geometry.

All API calls are intercepted in browser memory. This server has no API proxy and rejects any request that escapes interception. It does not create real installations, alter authentication, or contact port 8088. Results validate UI behavior against contract fixtures, not live Steam or game behavior.

For manual inspection, omit `suite` and set `path`, for example:

- `http://127.0.0.1:5189/?path=/game-library/palworld`
- `http://127.0.0.1:5189/?path=/server/fixture/quick-setup&game=satisfactory&empty=1`
- `http://127.0.0.1:5189/?path=/server/fixture/steam&job=1`

Stop this fixture process when finished. It is independent of the panel and development services.
