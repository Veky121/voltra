# Shared UI pass

- Both overviews use `ui/ResourceSummary`. Admin shows managed CPU load and configured node capacity; Servers shows live usage against accessible server limits. It never requests administrator capacity endpoints. Missing readings remain unavailable, and unlimited limits have no invented percentage.
- Admin navigation no longer includes Manage servers. Direct server management routes remain. Client navigation uses Game settings, Server settings, Access and Updates & repair; server tabs use Startup and Transfer. Template navigation uses Game templates, with template groups and templates inside.
- The app owns one `PendingSettings` provider. Existing game/startup fields, shared admin Editor forms, profile, appearance, runtime image/configuration, network notes, Java catalog and Minecraft runtime rules register with it. Creation, credential changes and operational actions keep explicit controls.
- Saves run sequentially, retain failed/later drafts and defer refresh callbacks until every write succeeds. Background form refreshes preserve dirty values. Route changes and destructive internal tab changes ask before discarding. The raw panel JSON editor cannot share conflicting drafts with the structured forms.
- `ui/ConfirmAction` composes the official base-mira AlertDialog. Native confirm calls were migrated. Cancel receives initial focus; navigation and authentication changes cancel pending consent. Controlled tabs require activation rather than changing on focus, avoiding repeated discard dialogs on focus restoration.
- Compact forms use 14px control text and 34px controls. Settings descriptions remain separate from control sizing. Artwork cards, file explorer and console layouts were preserved.
- Schedules show readable timing and next run; raw cron lives under Advanced timing. Daily/weekly timing has a direct selector. Custom cron remains intact.
- Websocket reconnect notices stay in notification history without a toast. The existing shared socket, HTTP fallback and authorization/revision boundaries remain. No new websocket protocol or Tasks center was added.

## Verification

- `npm --prefix web run check`.
- Isolated production build in `.local/ux-consistency-build` passed. Existing warnings remain for mixed Minecraft artwork JSON import attributes and a chunk over 500 kB.
- 22 focused tests for save ordering/failure, schedule semantics, CPU aggregation, notification behavior and live-event boundaries.
- `.local/ux-consistency-check.mjs`: mocked browser checks for shared metrics, navigation, failed saves and retry, multi-section saves, draft retention, route/internal-tab cancellation, confirmations, schedules, and mobile/ultrawide bounds.
- `.local/account-bell-check.mjs`: account menu, unread marker, keyboard, collapsed sidebar and mobile.
- Browser requests and sockets were intercepted. No live game actions, deployment or service changes.
