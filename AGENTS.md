# Rewrite coordination

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
