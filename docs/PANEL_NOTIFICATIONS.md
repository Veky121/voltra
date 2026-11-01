# Panel notifications and error inventory

Implemented 2026-10-31. This is an error-path inventory, not a claim that every
backend failure was reproduced or fixed. The linked TSV lists source locations
for catches, throws, shared error states, raw requests, and transport callbacks.

## UI

The global layer uses the official shadcn **base-mira Toast** registry component,
Base UI Toast, and the existing Mira Sheet/Button components. Registry source:
https://ui.shadcn.com/r/styles/base-mira/toast.json. Imports, Lucide icons, and
Tailwind `scn:` utilities are adapted to this workspace. No new dependency.

The sidebar Notifications button opens history with message, origin page, source,
request method/path/status, first/last occurrence, repeat count, and recovery
state. Export log downloads those records as JSON. Toasts last six seconds;
dismissing a toast keeps its history entry. A successful retry marks a request
error recovered. An error after recovery creates a new entry.

History lives above routes and setup/desktop gates, in this window's memory.
It keeps the latest 200 grouped issues, survives client-side page navigation,
and clears on logout, rejected session, identity change, or document reload.
It is not a backend audit log or durable multi-device notification inbox.

## Capture points

| Path | What is captured | Origin |
| --- | --- | --- |
| `lib.api` | HTTP failure, network exception, invalid JSON | Captured before request starts; survives navigation/unmount |
| `notifications/observedFetch` | Direct binary/desktop fetch failures | Original route and query-free endpoint; no body cloning |
| `notifications/useErrorState` | Local validation/action failures, console errors | Component filename and originating route/session |
| `hooks/liveEvents` | Failed authorized v1 snapshots, repeated disconnects | Existing topic subscription and socket; no second connection |
| `client/FileTransfers` | Uppy/Tus upload failures | Upload collection endpoint and starting route |
| `RouteRecovery` | React render/lazy route errors | Failed route |
| `notifications/browserErrors` | Unhandled errors and promise rejections | Current route |
| `ui/CopyButton` | Clipboard failures | Starting route; copied value is never logged |

Polling repeats update the count without another toast. A local display of an
already-reported request error is coalesced. Abort/cancel exceptions are omitted.
Empty-file range status 416 and already-deleted transfer status 404 remain expected
in their specific callers. ResizeObserver loop warnings enter history quietly to
avoid notification-layout feedback loops. Existing inline validation and retry
controls remain in place; notifications never replay a mutation automatically.

## Session and sensitive data

Requests carry the notification epoch from their start. Late results from a
previous identity are discarded. Source links and request paths omit query/hash
values. Request bodies, response bodies, headers, cookies, stack traces and
console output are not retained. Known credential formats are redacted from
messages. Sensitive endpoints (auth, keys, licences, startup/configuration and
integrations) use a generic stored error instead of server error detail; the
original page continues to handle its error. Invalid JSON records a safe generic
message instead of the browser's payload excerpt.

## Websocket coverage

The bridge consumes the existing v1 `snapshot` / `invalidated` error status after
revision and active-subscription checks. Successful snapshots mark matching
request errors recovered. Intentional unsubscribe/auth close is not an error.
HTTP fallback stays unchanged. Raw Wings console `jwt error`, `daemon error`,
invalid events and connection failures flow through Console's shared error state.

No new server event name, database table, persistent subscription, or background
job collector is introduced. Errors from jobs after their view unsubscribes, other
windows, closed browsers, backend-only logs, or game log text are **not** collected
by this frontend history. Those require a durable server notification contract.
See [LIVE_EVENTS.md](LIVE_EVENTS.md) for the current transport limits.

## Source inventory

[PANEL_ERROR_INVENTORY.tsv](PANEL_ERROR_INVENTORY.tsv) lists every matching frontend
error-handling location from the scan, including intentional fallback catches.
Not every catch is a user error: image fallback, storage availability, canceled
reads, parse probes, feature detection and preloading retain their behavior.
This scan does not claim failures from those fallback paths were reproduced.

The following existing error states now report globally:

| File | Error states |
| --- | ---: |
| `web/src/desktop.tsx` | 3 |
| `web/src/ServerNavigation.tsx` | 1 |
| `web/src/setup.tsx` | 5 |
| `web/src/ThemeProvider.tsx` | 1 |
| `web/src/admin/eggs.tsx` | 2 |
| `web/src/admin/FS25Licences.tsx` | 1 |
| `web/src/admin/GameLicences.tsx` | 1 |
| `web/src/admin/GatewaySubdomains.tsx` | 1 |
| `web/src/admin/integrations.tsx` | 1 |
| `web/src/admin/JavaEgg.tsx` | 1 |
| `web/src/admin/JavaRuntimes.tsx` | 1 |
| `web/src/admin/MinecraftRuntimeRules.tsx` | 1 |
| `web/src/admin/node-pairing.tsx` | 2 |
| `web/src/admin/ProxyGateways.tsx` | 1 |
| `web/src/admin/ProxyGatewayWizard.tsx` | 1 |
| `web/src/admin/ProxyInstallGuide.tsx` | 1 |
| `web/src/admin/servers.tsx` | 3 |
| `web/src/admin/shared.tsx` | 3 |
| `web/src/client/Appearance.tsx` | 1 |
| `web/src/client/common.tsx` | 1 |
| `web/src/client/Console.tsx` | 2 |
| `web/src/client/FileDocument.tsx` | 1 |
| `web/src/client/FileEditor.tsx` | 1 |
| `web/src/client/FileManager.tsx` | 1 |
| `web/src/client/FilesV0.tsx` | 1 |
| `web/src/client/FileTransfers.tsx` | 1 |
| `web/src/client/GameQuickSetup.tsx` | 1 |
| `web/src/client/MinecraftContent.tsx` | 2 |
| `web/src/client/MinecraftSetup.tsx` | 1 |
| `web/src/client/Overview.tsx` | 1 |
| `web/src/client/PendingSettings.tsx` | 1 |
| `web/src/client/PrivateSteamMaintenance.tsx` | 1 |
| `web/src/client/ServerAdminTools.tsx` | 1 |
| `web/src/client/ServerDashboard.tsx` | 1 |
| `web/src/client/ServerStartup.tsx` | 2 |
| `web/src/client/ServerSubdomain.tsx` | 1 |
| `web/src/client/SteamGames.tsx` | 1 |
| `web/src/client/SteamMaintenance.tsx` | 1 |
| `web/src/client/TemplateGames.tsx` | 1 |
| `web/src/components/AppSidebar.tsx` | 1 |

## Verification

- TypeScript check and isolated production build at `.local/notifications-build`.
  Build warnings: existing mixed JSON import attributes for Minecraft artwork and
  an existing chunk above 500 kB.
- Notification store tests: origin metadata, repetition, limits, aborts, rethrows,
  local duplicate displays, account isolation, redaction/export, recovery.
- Existing query cache and live-event tests preserve authorization and revision fencing.
- Browser fixtures cover delayed HTTP failure after navigation, websocket errors,
  repeat grouping, network/invalid JSON failures, abort suppression, history/export,
  session clearing, desktop/mobile sizing and reduced motion. All writes and
  socket frames are intercepted; these tests do not run real server power actions.
- No deployment, service restart, backend schema mutation, or full backend failure
  campaign was performed.

Reconnect notices are retained in history without interrupting the user with a toast while HTTP fallback remains available. See `UI_UX_CONSISTENCY.md` for the shared UI follow-up. The error inventory is a source snapshot from the initial notification audit; subsequent edits can shift its line numbers.
