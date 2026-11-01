# Live events

The panel exposes one authenticated `/api/client/events` WebSocket per browser
or desktop window. React consumers share the connection. HTTP remains the
source for initial snapshots, actions, file transfers, secrets and recovery.
The existing Wings console WebSocket is unchanged.

## Topics

| Event | Subscription path | Delivery |
| --- | --- | --- |
| `server.resources` | `/api/client/servers/{server}/resources` | Resource snapshot every second while watched |
| `servers.state` | `/api/client?summary=overview&states=1` | Current authorized membership and lifecycle states every second |
| `server.updated` | `/api/client/servers/{server}` | Invalidate HTTP detail when the server or permission revision changes |
| `jobs.updated` | `/api/client/servers/{server}/steam` | Sanitized Steam job status/progress every two seconds |
| `backups.updated` | `/api/client/servers/{server}/backups` | Authorized list, checked every five seconds |
| `schedules.updated` | `/api/client/servers/{server}/schedules` | Authorized list, checked every five seconds |
| `activity.updated` | `/api/client/servers/{server}/activity` | Authorized first activity page, checked every five seconds |
| `navigation.invalidated` | Account-local connection event | Successful favorites/visits and server mutations |

These are live read subscriptions, not a replacement command API. File contents,
startup variables, credentials, private Steam sessions, downloads and arbitrary
query strings are not subscribable. Existing permission checks remain in force.
Filtered/paginated activity, private Steam status and other unsupported paths
continue using HTTP.

## Protocol

The `ready` packet advertises `capabilities: ["snapshots"]`, with `version: 1`.
The client sends a complete desired subscription set:

```json
{"type":"subscribe","revision":3,"paths":["/api/client/servers/abcd1234/resources"]}
```

Each response carries the path and the matching subscription revision. This
fences old deliveries after route changes or unsubscribe/resubscribe. New data
uses `type: "snapshot"`, an event name, HTTP-compatible status and JSON response
envelope. Unchanged lists send `type: "unchanged"` without repeating the body.
Server details use `type: "invalidated"`, followed by an ordinary authorized
HTTP read. Full detail payloads, including masked variables, never enter the
shared snapshot cache. The internal revision digest is not sent to clients.

## Collection and event sources

Resource collectors are shared by canonical server UUID across authorized
accounts. Other collectors are scoped by account and exact path. They exist
only while subscribed, retain the latest result only for active consumers and
stop when the last subscriber leaves. This is Go process memory; no Redis,
database schema change or new service is required.

Collectors poll the existing panel/Wings readers at the intervals above.
Successful HTTP mutations wake appropriate collectors early. Successful daemon
callbacks also wake collectors. Polling catches scheduler/background changes
that do not pass through HTTP, and failures back off to ten seconds. This is
not yet a subscription to native Wings telemetry frames or a transactional
outbox. Events are best-effort, have no durable replay, and remain local to one
panel process. Persistent notifications are not implemented by this transport.

## Security and bounds

Credentials are checked before each delivery and heartbeat. Topic access is
checked both on subscription and immediately before delivery. Current membership
is re-read before an account server-state list is sent. Revoked subscribers
receive no subsequent protected payload; their topic is removed or connection
closed. Reconnect always rebuilds subscriptions and fetches current data.

The limits are 8 connections per account, 512 per App, 64 topics per connection,
256 active collectors per App, 16 concurrent collector loads, 16 KiB inbound
frames, 1 MiB snapshot bodies and bounded delivery queues. Collection and writes
have five-second deadlines. Subscription messages are rate limited. Slow clients
can miss intermediate snapshots and receive a later state; they cannot grow an
unbounded queue. Shutdown cancels collectors and closes connections.

## Frontend recovery

Overview and dashboard resource polling is suppressed while fresh socket samples
arrive. Installation and Steam status polling likewise defers to live events.
Other subscribed `useAPI` views receive snapshots or invalidations automatically.
A five-second HTTP recovery check remains for those views; live data is considered
stale after twelve seconds. Manual refresh still uses HTTP.

Hidden windows unsubscribe from snapshot topics and pause resource polling.
Visibility restoration resubscribes. Authentication changes close the connection
and discard its subscriptions. Older HTTP responses are fenced when a newer
socket snapshot arrives, including in the existing query cache.

## Verification

Automated tests cover topic allowlisting, collector/payload bounds, two-account
resource sharing, revocation during an active stream, last-viewer cleanup,
lifecycle invalidation, Steam job updates, stale subscription revisions, hidden
windows, reconnect and HTTP/cache response fencing. Real PostgreSQL tests use
isolated schemas and a controlled HTTP Wings responder. They do not prove native
game-server behavior, browser/desktop runtime operation or production capacity.
No publication, installation, deployment or service restart is part of this work.
