# Voltra Companion privacy

Voltra Companion sends requests only to the Voltra API address you configure.
Your normal API key authenticates those requests. When you submit a queued mod,
the extension sends its download URL, ZIP filename, destination directory and
selected server identifier to your Voltra panel. The server downloads the file
from the mod provider. The extension does not download or relay the ZIP.

The API address, key, selected server and queued mod metadata are remembered in
your browser profile. On Firefox they are stored in the extension origin's
IndexedDB database. On supported Chromium versions they are stored in local
extension storage restricted to trusted extension contexts. Website scripts
and the ModHub content script cannot read the saved key.

The ModHub integration reads the current mod's title, game edition, release,
filename and download link. Clicking Add to Voltra saves that mod in your local
queue. Downloads require a separate explicit submission from the extension.

There is no analytics, advertising, telemetry or developer-operated collection
endpoint. The extension does not send your browsing history to its developer.
Firefox's required authentication-information and website-content disclosures
cover the API key and mod details sent to your configured Voltra service.

Use Forget saved key to remove the stored credential. You can remove queue
entries from the sidebar. Revoking the key in Voltra prevents further API use.
Uninstalling the extension removes its browser-managed local data.
