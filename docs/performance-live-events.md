# Panel performance baseline and first live-update slice

For the current expanded subscription transport, see [LIVE_EVENTS.md](LIVE_EVENTS.md).
This document retains the original benchmark and first-slice implementation history.

The opt-in `TestPanelPerformanceBaseline` creates and drops its own PostgreSQL
schema. It starts an ephemeral loopback panel and a controlled HTTP Wings
responder. It does not start, stop, or stress Docker containers, games, a deployed
panel, or real Wings. The database service itself is shared, so timings can vary
with unrelated host activity.

Run from `ptero-go` with `TEST_DATABASE_URL` pointing at a disposable/local test
database. Never point this harness at a production database:

```powershell
$env:GOTOOLCHAIN = 'local'
$env:GOPROXY = 'off'
$env:PANEL_PERF_TEST = '1'
$env:PANEL_PERF_REPORT = Join-Path (Get-Location) 'artifacts/performance/panel-baseline.json'
go test ./internal/panel -run '^TestPanelPerformanceBaseline$' -count=1 -v
```

The harness uses 30 synthetic servers, production's DescribeExec query mode,
four warmup requests and 32 measured requests at concurrency 1 and 8 per case.
It records full-body HTTP latency, failures, pgx SQL call counts, aggregate pool
acquisition duration and controlled upstream call counts. Pool acquisition
duration includes successful acquisitions, not exclusively time queued. SQL
counts are pgx query calls, not protocol round trips. This short sample identifies
expensive paths; it does not establish a capacity limit or reliable tail latency.

The full `/api/client` route assembles detailed server objects individually. The
UI overview already uses `summary=overview`; its much cheaper result must not be
presented as a new optimization delivered by this work. Priorities are batching
the full compatibility list and sharing telemetry collection across viewers.
Real Wings/Docker saturation, disk contention, remote network behavior, browser
boot time and long-lived socket capacity remain unmeasured.

## WebSocket protocol v1

`GET /api/client/events` accepts browser sessions, desktop credentials and the
existing pre-setup loopback development identity. Scoped machine API keys are
not supported by this first endpoint. The desktop host already proxies generic
WebSocket upgrades, supplying its saved credential.

The server sends `{ "type": "ready", "version": 1 }` after subscription and
`{ "type": "navigation.invalidated", "version": 1 }` after a successful favorite
or visit mutation by that account. Events have no server payload or secrets.
Connections are account-scoped, limited to 8 per account and 512 per App. A
one-slot queue coalesces invalidations. There is no client command protocol.

The navigation provider refreshes through its existing HTTP endpoint, coalesces
bursts, reconnects with jittered backoff and resynchronizes on every `ready`.
Its existing 60-second polling and focus refresh remain fallback behavior.
Authentication changes close the client connection. The server rechecks the
original credential, current user, access mode, origin and maintenance state
before events and every 20-second heartbeat. Revoked idle connections therefore
close on the next heartbeat; they are not allowed another event. Shutdown closes
the App's subscriptions. Messages, writes and idle reads are bounded.

Delivery is local to one panel process and best-effort. Reconnect requires an
HTTP snapshot; there is no replay. This is a transport foundation with one real
event source, not general live server lists, shared Wings telemetry, durable
notifications, or automatic SQL dependency tracking. It intentionally adds no
database schema or external service.

Before expanding: add committed lifecycle event sources and access-aware server
subscriptions, then shared per-server telemetry with bounded upstream work.
Multiple panel processes will need cross-process invalidation delivery. Durable
notifications need persisted delivery state rather than this transient queue.

## First performance implementation

The full compatibility list now preloads allocation lists, variable rows and
transfer flags for the selected page, which is capped at 100 servers. Response
shaping still uses the existing permission, masking and inheritance logic.
An allowlist of repeated metadata reads is reused within a finite GET request.
Returned maps are copied deeply so node token unsealing, secret masking and
server configuration overrides cannot mutate another server's response. The
read scope has a 1024-entry cap and is never attached to mutations or WebSocket
upgrades. User and subuser reads are fresh on the next request; setup and
maintenance decisions are still read directly from PostgreSQL.

Resource requests check each caller's access before joining a shared upstream
read. Only overlapping requests share a result; completed telemetry and errors
are not cached. Reads are keyed by server UUID and node ID, with at most 64
active upstream reads per App and a five-second deadline. Cancelling one viewer
does not cancel other viewers. The last departing viewer cancels the upstream
request; its slot remains occupied until that request terminates. Shutdown
cancels active reads. This is HTTP request coalescing, not yet socket telemetry
subscriptions or a persistent Wings collector.

The initial Client/Admin chunk now preloads during setup/session checks and
shares its load with React.lazy. A failed prefetch may retry at rendering.
Dashboard telemetry stops when hidden, resumes when visible, and backs off
failed reads from two seconds up to ten seconds. Visible successful reads keep
the one-second cadence. Bootstrap endpoints and authentication gates are
unchanged. Browser boot-time gains have not been measured.

The saved `panel-baseline-20261031.json` and `panel-optimized-20261031.json` runs
used the same 30-server workload and DescribeExec mode. At concurrency eight,
the full list went from 364 to 160 SQL calls per request and p95 from 362.4 ms to
198.0 ms. Overlapping resource requests made 4 Wings calls per 32 requests,
previously 32, with both immediate and 100 ms responders. Single resource calls
still contact Wings freshly. These short local samples are not production
capacity estimates or evidence of an app-wide percentage speed increase.

Verification covers owner and restricted-subuser response parity, per-request
freshness and map isolation, resource coalescing/cancellation/limits, outsider
denial while an authorized shared read is active, and existing socket credential
revocation tests. Frontend tests cover prefetch reuse/retry, visibility/backoff,
socket reconnect behavior and query-cache safety. Full TypeScript checking is
still blocked by the unrelated `Overview.tsx` use of the unsupported `plus` icon.
No deployment, desktop installation or real Docker/Wings load test was performed.
