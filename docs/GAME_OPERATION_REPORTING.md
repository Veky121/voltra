# Reporting game operations

New Node-based game scripts can import the shared module at
`internal/panel/game_library/scripts/operation-report.mjs`. Package this file with
the game script, preserving its import path. FS25's template demonstrates this:
it installs the helper in `.voltra/scripts`, and its runtime downloader imports it.

```js
import {createOperationReporter} from '../../scripts/operation-report.mjs';
const report = createOperationReporter({source: 'my_game'});
report({state: 'running', phase: 'download', code: 'DOWNLOAD_CONNECTING'});
// Call as data arrives. Updates are limited to once per second.
report({state: 'running', phase: 'download', code: 'DOWNLOAD_RECEIVING', bytes: received, total: knownTotal || null});
// Only after the file has been checked and committed:
report({state: 'completed', phase: 'download', code: 'DOWNLOAD_COMPLETE', bytes: received, total: knownTotal || null});
```

Create a new reporter for each operation or retry. Terminal events close that
reporter. Use `{force:true}` as the second argument to report a genuine phase
transition immediately. Never use this to flood the output stream.

The version 1 wire format is one stdout line beginning `@voltra/operation `,
followed by JSON with `v`, `id`, `sequence`, `at`, `source`, `state`, `phase`, and
`code`. Optional fields are `bytes`, `total`, and `restart_required`. States are
queued, running, completed, and failed. Phases are prepare, authorize, download,
verify, extract, and apply. `total:null` means unknown. Bytes are nonnegative safe
integers. Zero is not a known total. Do not estimate bytes from elapsed time.

The helper emits only those fields. It does not accept raw messages, errors,
URLs, credentials, paths, or arbitrary metadata. User-facing messages and recovery
instructions come from the code catalog in `web/src/client/operationEvents.ts`.
To add a diagnosis, add its safe code there with a short message and a concrete
recovery instruction. Emit it only when the script has evidence of that cause.
Do not send exception messages or a provider's response body.

The parser rejects unknown versions/codes, malformed or oversized reports,
invalid byte totals, and invalid identities. It retains at most 12 operations,
ignores repeated or older sequence numbers and cannot reopen a terminal operation.
The shared bottom transfer dock shows reports with progress and expandable details.
Users can dismiss terminal reports or collapse active ones. A report identifies
its source and last timestamp. After 30 seconds without a report it shows
"No recent update" and stops drawing active progress.

These are **script reports**, not independent proof of readiness, connectivity,
ownership, or installed versions. A completed download is not a completed install.
A requested restart is not an applied setting. Scripts cannot trigger actions
through this protocol. Existing console permissions control access.

## Current integration and limits

FS25's runtime downloader reports connection, transferred bytes, length checking,
completion, and failure. Licence/authorization failures from its CLI entrypoint
also report safe codes. Content-Length is used when provided; streaming downloads
without it keep their existing hard byte limit and report an unknown total.
Existing downloaded files are labeled as reused, not newly verified downloads.

Runtime stdout reaches the existing server transfer websocket. The dock requests
the node's supported `send logs` snapshot after authentication and parses reports
from console output and authorized install output. It adds no socket or polling
loop for reports. Users need `websocket.connect`; file-only users still see their
authorized file transfers, but cannot read script output. Reports stay separate
from the authoritative pull/upload snapshots, so refreshing those snapshots never
removes an ongoing script operation.

Closing the page does not stop the script, but there is no independent durable
operation database or automatic notification inbox. Dock replay is limited by the
node log snapshot. Full saved-console history remains available on Console. A
script killed before its terminal event leaves a last-reported state, not confirmed
continuing progress. Server/session changes clear reports and reject late callbacks.

Install-container output uses separate node permissions and is parsed only if the
existing socket delivers it. Merely including this helper in an installer does not
make its events available through saved runtime console history. Other games,
shell/Python installers, SteamCMD, and node-managed pulls
still require their own producer wiring to this contract. No native FS25 download
or running game acceptance is claimed by the unit tests.
