# Rewrite coordination

## Update publication policy

- There are two update channels: Release and Nightly. Beta describes product maturity; versioned beta builds can be published on Release.
- Always default agent development updates and publication to Nightly. Update Release only when Veky explicitly requests a Release publication for that work. General instructions to push, publish, update the desktop, or restart a service do not authorize a Release publication.
- Do not create or push final or beta release tags, advance `update-release`, or advance its legacy `update-beta`/`update-stable` compatibility feeds without that explicit Release instruction. Use a versioned nightly tag or the existing nightly workflow for routine updates.
- Keep each desktop user's selected update channel. This agent publication policy does not authorize changing user preferences, promoting Nightly automatically, or installing updates without the applicable task authorization.
- Before publication, verify scoped changes and required checks. Keep unrelated dirty files out of release checkouts. Report the published version/channel and distinguish tests, builds, browser checks, installation, and live deployment.

The user requests full Pterodactyl parity on Go/PostgreSQL/React/Vite, keeping Wings. The user subsequently approved first-run administrator setup, password/session sign-in and HTTPS configuration. Cloudflare Access remains deferred. Existing development installations open as an admin on loopback until the first-run wizard is explicitly completed; completed setup must always require authentication, even with DEV_MODE=true. Preserve accounts, ownership, fine-grained permissions and daemon/API machine authentication.

Reference application: ../pterodactyl-vite. Do not modify or replace it. Never reset its database or touch its running daemon. The new project is ptero-go. Root owns shared core, PostgreSQL schema, startup, integration, global tests and final claims. Domain owners must implement and verify their assigned files, not just produce plans. No stub-success responses or fake daemon results. Mark gaps explicitly.

All backend domain files are package panel under internal/panel. Read CONTRACT.md before implementation. Do not edit shared core.go, schema.sql, main.go, web/src/lib.tsx, web/src/App.tsx, web/src/styles.css, package manifests or other owners' files without coordinating. Shared checkout: never revert another agent's edits, delete unknown files, or run a whole-workspace formatter. Format only your files. Request shared changes by message. Do not commit.

Ownership:
- root: core, schema, runtime, shared UI shell, integration.
- accounts: accounts.go, accounts_test.go; users, API keys, SSH keys, permissions.
- eggs: eggs.go, eggs_test.go; nests/eggs/variables/import-export/configuration.
- infrastructure: infrastructure.go, infrastructure_test.go; locations/nodes/allocations/mounts/hosts/settings.
- lifecycle: lifecycle.go, lifecycle_test.go; server CRUD/build/startup/suspension/transfers, Wings configuration, remote APIs.
- operations: operations.go, operations_test.go; client console/resources/files/backups/network/startup/settings and socket proxy.
- collaboration: collaboration.go, collaboration_test.go; subusers/schedules/tasks/database provisioning/activity.
- client UI: web/src/client/**, web/src/Client.tsx.
- admin UI: web/src/admin/**, web/src/Admin.tsx.
- parity: tools/parity/**, tests/parity/**, artifacts/parity/**; independent inventory and acceptance.

Any applicable child delegation needs explicit user or parent authorization. Root has user authorization for subagents. Prefer finishing your assigned implementation and reporting gaps over creating more subagents.

## Memory and storage units

Use GB for user-facing memory, heap, swap, storage, capacity and upload-limit forms and resource summaries. Entering `8` must request 8 GB. Convert at API boundaries with the shared resource-unit helpers; existing Wings/panel limits remain integer MiB, with 1 displayed GB representing 1024 MiB. Preserve zero/unlimited and swap sentinel semantics, existing saved capacities, and appropriate file-size/network units. Never require users to calculate or enter MiB.

## Egg setting descriptions

For every game egg, write one short, plain-language sentence explaining what a setting does. Obvious labels such as "Web portal username" need little explanation. Keep implementation details, native-file authority rules, and engineering terminology out of descriptions. Put validation rules and defaults in Details. Keep licence credentials admin-only.

## UI components: Mira first

- Reuse and extend the existing shadcn `base-mira` components in `web/src/components/ui` before creating page-specific controls. Shared adapters belong in `web/src/ui`; preserve their public contracts.
- Add missing standard primitives from the official base-mira registry using the existing `scn:` prefix, aliases, semantic theme tokens and Lucide icons. Do not install a second style system.
- For Voltra-specific behavior, compose a reusable owned component from Mira primitives. Keep game/server logic separate from presentation. Do not duplicate controls across pages.
- Preserve form submission, refs, validation, keyboard/focus behavior, permissions, secrets, loading/error/empty states and confirmation safeguards during migration.
- Keep the current artwork server cards, file explorer, server artwork header/power layout and console presentation visually stable. Make only necessary component/accessibility changes there; preserve terminal rendering, editor behavior and file interaction semantics.
- Keep UI copy and spacing compact. Verify shared changes at their consumers and report actual verification limits.

- For settings and configuration options, use the shared `SettingsSection`, `SettingsRow` and `SettingsField` compositions. Keep option groups in a bounded column around 880px, with labels and concise descriptions together and their controls beside them. Stack wide editors and narrow-screen text fields; keep switches next to their labels. Avoid full-viewport label/control separation or page-specific copies of the same settings layout.

- Game settings and Runtime & resources use the shared `settings-responsive` modifier: one column below 960px of available content, two from 960px, and three from 1680px, centered with a 2200px page maximum. Keep wide editors full-width, preserve DOM/tab order, and respect reduced motion. Reuse this modifier for comparable configuration pages instead of adding separate breakpoint rules.

- Runtime & resources wraps shared admin forms in `SettingsLayout`. Inside it, `Panel` and `Editor` use `SettingsSection`; use Editor groups to separate related fields and `SettingsRow` for actions. Keep section titles outside their cards instead of nesting every runtime form in one card.

- Report panel failures through the global notification layer. Use `api` for JSON requests, `observedFetch` for direct streams/desktop requests, and `useErrorState` for local string errors. For other async sources, capture `captureErrorContext` when the operation starts and pass it to `reportPanelError`. Keep inline validation/retry controls, never log credentials or payloads, and never automatically retry mutations from a notification. Reuse the Mira Toast and notification history instead of adding page-specific toast systems. See `docs/PANEL_NOTIFICATIONS.md`.

- Reuse the app-level `PendingSettings` Save/Discard bar for editable settings. Register drafts with `usePendingSetting`; failed saves must throw and retain the draft. Defer reloads through `afterSave` until the whole batch succeeds. Keep creation, credential rotation and destructive operations as explicit actions. Use `useDiscardSettings` when an internal tab would unmount dirty fields. Do not silently replace drafts during background refresh.
- For new game download/install integrations, use the shared operation-reporting contract in `docs/GAME_OPERATION_REPORTING.md`. Node scripts can use `game_library/scripts/operation-report.mjs`; other runtimes must emit the same bounded, validated protocol through a transport the panel actually consumes. Report real phases and measured bytes, keep unknown totals unknown, and use safe error codes with recovery guidance. Never equate request acceptance, downloaded files, or a running process with completed installation, applied settings, or public reachability. Verify producer packaging and delivery as well as parsing; install-container output is not automatically runtime console output.
- Use `confirmAction` from `ui/ConfirmAction` for confirmations, with an action-specific label and the affected item in the message. Await its result before a mutation. Do not use browser `confirm()` or automatically activate guarded tabs on focus.
- Use `ResourceSummary` and `ResourceMetric` for overview summaries. Keep data permissions and units explicit: administrator node capacity differs from a user's server limits and live usage.
