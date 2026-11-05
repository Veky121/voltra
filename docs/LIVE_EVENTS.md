# Live events

The panel exposes one authenticated `/api/client/events` WebSocket per browser
or desktop window. React consumers share the connection. HTTP remains the
source for initial snapshots, actions, file transfers, secrets and recovery.
The existing Wings console WebSocket is unchanged.

## Read policies

This policy covers the registered client, admin, application, authentication,
setup, daemon and download endpoint families. The route audit expands registration
loops as well as literal routes. A route's ability to serve HTTP does not imply
that it may publish a WebSocket payload.

| Read family | Delivery and recovery |
| --- | --- |
| CPU, RAM, disk, network and uptime (`resources`) | Shared server collector at 1 second while watched; existing visible HTTP fallback when unavailable |
| Saved console (`console-history`) | Cursor batches checked at 1 second; direct Wings console events remain in place |
| Fleet lifecycle states | Immediate invalidation on observed Wings state changes and server/database changes; 15-second safety collection |
| Server detail and overview metadata | Change hint followed by authorized HTTP; 60-second reconciliation |
| Backups, including paginated lists | Initial snapshot, then commit/action-driven snapshots; 60-second reconciliation |
| Schedules and included tasks | Initial snapshot, then schedule/task/run commits; 60-second reconciliation |
| Steam maintenance jobs | Sanitized status snapshots on committed job changes; 60-second reconciliation |
| Subuser lists and activity pages | Authorized snapshots on commits; 60-second reconciliation |
| File directory listings | Snapshot on panel file actions, completion and server changes; 15-second reconciliation for game/SFTP/external edits |
| Database metadata, allocations, public routes, mounts, node/server/user lists and supported catalogs | Scoped change hint, ordinary authorized HTTP, 60-second reconciliation through the shared read hook |
| Private Steam job/readiness views | Hints followed by authorized HTTP; private data never enters the snapshot cache; existing active-job polling may also apply |
| Transfer progress | Existing Wings progress messages; HTTP reconciliation at 5 seconds for active uploads/disconnected downloads, otherwise 30 seconds |
| Node enrollment/connection and runtime operations | Existing operation-specific polling; pairing expiry clocks are local UI clocks, not server polls |
| Editable startup, configuration, game settings, quick setup, Java settings, account/profile and admin detail/settings forms | On-demand HTTP and explicit post-save refresh; background updates must not replace drafts |
| Passwords, licences, API/SSH keys, signed URLs and installer/config exports | On-demand authorized HTTP; no shared snapshots or automatic secret refresh |
| File contents, previews, artwork bytes, uploads and downloads | Existing HTTP/stream contracts; directory metadata updates do not reload an open file editor |
| Authentication, setup, remote daemon/connector APIs and health checks | Existing protocol/request cadence; excluded from view subscriptions |
| All mutation endpoints | Remain HTTP. Successful mutations invalidate relevant read domains; uncertain file failures also reconcile possible partial changes |

`readPolicy.ts` defines shared-hook hint interests and reconciliation intervals.
Specialized console, resource, transfer and enrollment readers retain their own
controllers. Catalogs can still change externally, so their mounted readers
retain reconciliation. Unmounted consumers do no work. Configuration is explicitly
on demand rather than claiming live synchronization of editable drafts.

The payload allowlist is narrower than the hint policy: server resources, saved
console, detail revision, Steam status, backups, schedules, users, activity and
file lists. Supported query variants include `schedules?include=tasks`, backup
and activity pagination, backup sorting/origin, and `files/list?directory=...`.
Duplicate or unknown query keys are rejected. Arbitrary includes, file bytes,
credentials and private Steam payloads are not subscribable.

## Protocol

The `ready` packet advertises `capabilities: ["snapshots", "event-driven"]`,
with `version: 1`. The client sends its complete desired subscription set:

```json
{"type":"subscribe","revision":3,"paths":["/api/client/servers/abcd1234/backups?page=1&per_page=20"],"domains":["backups","access","servers"]}
```

Snapshots carry their exact path, subscription revision, HTTP-compatible status
and JSON envelope. Server details send `invalidated`, followed by authorized
HTTP, rather than caching their full response. `reads.invalidated` carries only
domain names. A 20-second authenticated heartbeat confirms connection health.
Unchanged bodies are not repeated: small acknowledgements confirm a changed
collection has settled and reconcile quiet subscriptions approximately once a
minute. This is deliberately not a one-second broadcast of unchanged lists.

## Collection and event sources

Resource collectors are shared by canonical server UUID across authorized
accounts. Other collectors are scoped by account and exact path, including
pagination and directory. They retain current data only while watched, and stop
when their final subscriber leaves. The browser cache remains bounded and scoped
to the authenticated session.

PostgreSQL AFTER triggers send schema/table hints on committed INSERT, UPDATE,
DELETE and TRUNCATE operations. Rollbacks do not publish. This covers scheduler
runs, background workers, daemon callbacks, administrative writes and other panel
processes, not just the user who clicked a button. Timestamp-only heartbeat
updates are suppressed; console log rows are excluded from this mechanism.
No row values or credentials enter the notification payload.

Each App uses one dedicated LISTEN connection outside the request pool. Reconnect
invalidates active readers to recover missed notifications. Successful HTTP
mutations also wake local readers. File mutations publish a cross-process hint,
because filesystem writes have no database row trigger. Failed file operations
also refresh metadata when partial changes are possible. Upload chunks do not
invalidate directory lists; completion does.

Hints are scoped by resource domain, not individual server ID. They can refresh
another watched server in the same domain; this favors correctness but leaves
room for finer targeting. Client refreshes coalesce over 250 ms, and each worker
has a bounded wake signal. In-flight and queued snapshots are fenced by the
worker's change generation. Slow-client queue overflow forces reconnect and a
fresh read instead of silently leaving a client behind.

Notifications are best-effort, not a durable event log or transactional outbox.
The 15/60-second reconciliation intervals are required recovery mechanisms.
These intervals are targets while dependencies respond, not freshness guarantees
through a database/node outage. Failed collections retry after ten seconds and
HTTP recovery remains available. No Redis or additional service is required;
the database schema migration installs the notification triggers.

## Security and bounds

Credentials are checked before each delivery and heartbeat. Topic access is
checked both on subscription and immediately before delivery. Current membership
is re-read before an account server-state list is sent. Revoked subscribers
receive no subsequent protected payload; their topic is removed or connection
closed. Reconnect always rebuilds subscriptions and fetches current data.

The limits are 8 connections per account, 512 per App, 64 topics per connection,
256 active collectors per App, 16 concurrent collector loads, 16 KiB inbound
frames, 1 MiB snapshot bodies and bounded delivery queues. Collection and writes
have five-second deadlines. Subscription messages are rate limited. Slow clients may miss intermediate states, but queue overflow closes their
connection so they reconnect and fetch current state; queues cannot grow without
bound. Shutdown cancels collectors and closes connections.

## Frontend recovery

The console loads saved history once over HTTP, then consumes `console.entries`.
Batches include `after`, `cursor` and `head` string cursors. IDs are global, so
they need not be contiguous for one server. A batch starting beyond the client's
cursor means delivery was missed; the client recovers through paginated HTTP.
Reset buffers also trigger HTTP recovery. Overlapping entry IDs are ignored.
New subscriptions start at the current head rather than replaying the whole
buffer. Each batch has at most eight entries to fit escaped maximum-length
lines within the frame bound. Installer output remains administrator-only.

Console history responses also carry `run_start`, a decimal-string boundary ID
persisted in `console_log_collectors.run_start_id`. On a confirmed new start,
the capture worker flushes pending shutdown output, keeps up to 250 previous
lines, and writes a new-run marker plus the observed state in one transaction.
Power requests, initial attachment, duplicate status and starting-to-running
do not rotate history. Stopped/crashed servers retain the current buffer until
the next start. Game-owned log files are unaffected.

A changed `run_start` tells an open console to reload from cursor zero and
replace its displayed buffer with the retained tail and new output. The same
check applies to HTTP fallback. The previous tail remains part of the ordinary
rolling history budget; it is not a permanent crash archive. Browser history is
bounded at 5,000 lines and 4 MiB of UTF-16 text. Older panels without `run_start`
continue using cursor recovery without inferred run boundaries.
These entries come from the existing persistent Wings collector, including
panel and installer messages. The direct Wings socket remains for status,
feature handling and live fallback. Hidden consoles pause HTTP history polling.

The shared fleet CPU summary consumes the same resource subscriptions as server
cards. It waits briefly for the first snapshot and only reads HTTP resources
when the topic is stale or unavailable. Node CPU capacity is read on mount and
cached for five minutes while mounted; failed capacity reads retry sooner.
Hidden summaries stop polling. This removes duplicate browser requests, but
does not replace the panel's shared upstream Wings polling. Overview metadata
uses change hints and a 60-second HTTP reconciliation to catch missed updates.

Overview and dashboard resource polling is suppressed while fresh socket samples
arrive. Snapshot consumers check HTTP recovery every five seconds. Fast telemetry
is stale after twelve seconds; event-driven topics need both a recent heartbeat
and a collection acknowledgement within ninety seconds. A change hint immediately
marks the relevant topic pending, allowing HTTP recovery if collection stalls.

Reconciliation ticks coalesce with slow HTTP requests rather than repeatedly
aborting them. Actual change hints fence older responses. Subscription revisions,
worker generations, query versions and authentication epochs prevent old route,
user or request results from replacing newer state. Transient failures retain
loaded content and show an error; 401/403/404 clear protected data.

Hidden windows unsubscribe from topics and hint interests. Visibility restoration
resubscribes and refreshes mounted views. Authentication changes close the socket
and clear subscriptions and cached authority. Reconnect fetches current state;
there is no reliance on replaying every missed event. Subscription/collector limits
leave excess reads on HTTP recovery. Older panels retain the conservative
snapshot-age fallback when they do not advertise event-driven support.

Backups, schedules, databases, subusers and expanded file folders use the shared
Mira-based `CollectionSkeleton` for initial loads. Background refresh retains
existing rows, expansion, selections and drafts. Skeletons have an accessible
loading label and respect reduced-motion preferences. Database metadata is live;
passwords are requested only when revealed and hidden again when list data changes.
The uploads layout and existing transfer controls are unchanged.

## Failure cases and verification

The focused automated suite covers real PostgreSQL commit/rollback notifications,
two listeners, cross-user backup/task changes, query allowlisting, permission
revocation, shared resource collectors, last-viewer cleanup, queue overflow,
in-flight and queued response fencing, coalescing, hidden windows, reconnect,
heartbeat expiry, slow HTTP recovery, retained file rows and cache/session changes.
PostgreSQL tests use isolated schemas and controlled Wings HTTP responders.

Additional boundaries to preserve:

- A game or SFTP client changing files is discovered by directory reconciliation;
  editing a file in the UI does not authorize overwriting its unsaved editor draft.
- A database listener disconnect or panel restart resynchronizes on reconnect;
  reconciliation also covers a lost notification or disabled notification source.
- Bulk actions coalesce wake-ups. New pagination/filter paths have separate
  authorized state; changing pages never reuses another page's snapshot.
- Revoked access is rechecked before payload delivery. Hints contain no resource
  identity or data, and HTTP rechecks permissions independently.
- A failed mutation is never retried automatically. File metadata may refresh
  after a partial failure; the original operation error stays visible.
- Unknown future endpoint families use conservative HTTP read recovery; adding
  a snapshot topic requires an explicit payload/permission/query review.

These checks do not prove native game behavior, browser/desktop appearance,
production throughput or every possible failure interleaving. Race instrumentation
requires a CGO-capable test environment. No publication, installation, deployment
or running-app restart is part of this change.
