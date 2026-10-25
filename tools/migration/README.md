# Laravel migration

The exporter reads the existing Laravel/MariaDB panel. The Go importer requires a new, empty PostgreSQL database or schema. It never merges into an existing panel, calls Wings, moves game files, restores backups, changes game databases, or updates MariaDB.

## Export

Run PHP in the existing Laravel environment so its application key can decrypt node and database credentials:

```sh
php tools/migration/export-laravel.php \
  --app=/absolute/path/to/pterodactyl-vite \
  --output=/private/path/.local/legacy-snapshot.json
```

The output file must not exist. The exporter opens it exclusively with mode `0600`, writes the snapshot directly to the file, and prints only counts. On Windows mounted storage, use a directory restricted to the account by its Windows ACL; POSIX mode bits are not enforced on every mount.

The file contains decrypted Wings, database and configured S3 credentials. Keep it outside source control. `.local/` is ignored by this repository. Existing API keys are exported as SHA256 hashes of the full bearer token, which preserves existing key use without storing raw API tokens. Password hashes, TOTP secrets, recovery tokens, sessions and password-reset tokens are excluded.

The database read uses a repeatable-read, read-only transaction. Connection-local UTC timestamps prevent timezone shifts. No source rows, daemon configuration or server files are changed.

## Validate and import

Configure `DATABASE_URL` for a separate empty PostgreSQL database or schema and set the destination `ENCRYPTION_KEY`. Leave `DEV_MODE=false` for migration. The CLI creates the current schema and does not seed the development admin.

```sh
go run ./cmd/panel import-legacy --file=/private/path/.local/legacy-snapshot.json --dry-run
go run ./cmd/panel import-legacy --file=/private/path/.local/legacy-snapshot.json
```

Dry-run executes every insert, type check and foreign-key relationship inside a transaction, then rolls it back. It does not change ID sequences. A real import commits atomically, preserves source IDs, restores egg inheritance and server/allocation links, advances sequences, and encrypts imported credentials with the destination key.

Both commands produce a sanitized report containing row counts and conversion notices. The importer refuses an occupied target, unsupported snapshot versions, unknown fields, incompatible API keys, pending PHP jobs and in-flight schedules, installations, restores or transfers. Finish those operations before taking the final migration export.

Running containers and backup/game files remain on their existing Wings nodes. Actual cutover still requires configuring those daemons to use the new panel URL and validating connectivity. This tooling performs no cutover automatically.

## Coverage

The portable version-1 snapshot includes accounts, application/client API keys with scopes/IP restrictions/expiry, active SSH keys, locations, nodes, nests, eggs and duplicate variable definitions, server ownership/build/startup/status/environment, allocations, subusers and permissions, schedules/tasks, backup metadata, database hosts/game database credentials, mounts and their assignments, activity, settings and completed transfer history. Native Go snapshots also preserve completed schedule-run records. Outbound email is removed; imports discard legacy mail settings and notification jobs.

Native durable daemon revocations are preserved with their UUIDs, generations, attempts, retry deadlines and completion state. A pending revocation with a lease later than import time blocks migration. Stop the source worker and finish the operation or wait for its lease to expire. Expired leases, including their timestamps, are retained so the destination worker can reclaim them using its normal `lease_until <= now()` rule. Laravel `RevokeSftpAccessJob` payloads are not portable; drain PHP jobs first. The native revocation queue starts empty for legacy exports, with an explicit conversion notice.

The internal `panel_schema_versions` table belongs to the destination runtime. Snapshots omit it, and its checksum records do not make an otherwise empty product database count as occupied.

Legacy SMTP settings are excluded. Effective S3 configuration supplied by `.env` is included. Known credentials are decrypted through the original Laravel encrypter and sealed on destination import.

Legacy polymorphic activity links are retained in activity properties. The first existing server subject is indexed as the native `server_id`; all subjects, actor types and API-key references remain in metadata. Older audit/API/task logs are converted into activity entries with their original records intact.

Soft-deleted SSH keys and backups stay inactive. Their original records, notifications, failed PHP jobs and unmapped non-authentication columns are archived under the private `legacy.migration.archive` setting. Reports identify these records as historical data; they do not become active Go jobs or notifications. Unknown nonempty source tables and unsupported legacy API key types block import rather than disappear silently.

Database metadata is migrated, not the contents of external game databases. Backup metadata is migrated, not backup archive bytes. Source nullable text/default fields and missing creation/update timestamps normalize to native defaults with a conversion notice.

## Native snapshots

```sh
go run ./cmd/panel export-snapshot --file=/private/path/.local/native-snapshot.json
```

Native exports use the same private portable format. They can be imported into a fresh schema using a different encryption key. Snapshot files are never printed to stdout.

## Checks

```sh
php tools/migration/export-laravel-test.php
TEST_DATABASE_URL='postgresql://...' go test ./internal/panel -run 'TestMigration|TestCLISnapshot' -count=1
```

Tests create and remove isolated PostgreSQL schemas. The full fixture covers all tables, inherited eggs, cyclic server/allocation references, ID sequences, credential re-encryption, existing API bearer tokens, JSON scalar settings, transaction rollback and explicit refusal cases.

Set `TEST_LEGACY_SNAPSHOT` to an explicit private export path to also validate the actual legacy snapshot. That test uses a fresh isolated schema and rollback-only import, leaving the active Go database untouched.
