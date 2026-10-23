# Independent parity acceptance

These scripts use Node built-ins. The reference PHP panel is read only. Mutations target the Go rewrite on loopback and port 8090 is rejected. No script prints request bodies, API keys, daemon secrets or database credentials.

Run from `ptero-go`:

```powershell
node tools/parity/inventory.mjs
node --test tests/parity/*.test.mjs
$env:PARITY_SERVER = 'dedicated-go-test-server-identifier'
node tools/parity/acceptance.mjs
node tools/parity/egg-corpus.mjs
$env:PARITY_ALLOW_RUNTIME = '1'
node tools/parity/runtime.mjs
node tools/parity/extended.mjs
$env:PARITY_RUN_CRON = '1'
node tools/parity/admin-database.mjs
node tools/parity/cli.mjs
node tools/parity/remote.mjs
node tools/parity/locales.mjs
$env:PARITY_VALIDATE_RUNTIME = '1'
node tools/parity/validation-compatibility.mjs
node tools/parity/dto.mjs
node tools/parity/equivalence.mjs
node tools/parity/feature-audit.mjs
node tools/parity/report.mjs
```

`PARITY_BASE_URL` defaults to `http://127.0.0.1:8088`. `PARITY_DEV_USER_HEADER` defaults to `X-Dev-User-ID`. The header is meaningful only in local development and allows tests to check account boundaries even though browser sign-in is deferred.

The inventory records every route from the pinned original route export, controller method, original client route, UI control instance, CLI command, permission and supplied PTDL egg. Pterodactyl product requirements begin `not_exercised`. Browser login, password/email identity changes and TOTP are deferred at the user's request. Laravel development/debug tooling is retained in the inventory as reference tooling.

HTTP checks assert persisted results and failures, rather than counting successful status codes. Each runner creates unique fixtures and removes only those fixtures. `PARITY_SERVER` must name a dedicated rewrite server. File tests write/delete uniquely named scratch files. The base acceptance suite creates inactive schedules; the extended and database suites execute their own schedules against their own servers. No runner resets a database, modifies reference Wings, or starts arbitrary corpus games.

The egg runner imports and exports all 321 supplied PTDL documents from `upstream/game-eggs`, `upstream/application-eggs` and `upstream/generic-eggs` through the Go API. It compares install script bytes, image choices, parsed config, variables, visibility and validation rules, and then removes its isolated nest. This proves corpus data compatibility, not that every game installs or runs. Actual installation depends on external images, downloads, licenses, credentials and runtime resources and must be reported separately.

`extended.mjs` creates its own isolated user/nest/egg/allocations and real daemon server, tests validation, startup visibility, server lifecycle, network allocation changes, actual public file pulls, suspension, reinstall, delayed task execution and failure continuation, then deletes those resources. It never changes the browser owner's server. It briefly enables automatic allocation assignment and restores that individual setting.

`admin-database.mjs` tests mount associations, offline node token rotation/deployment keys, typed settings, actual local SMTP delivery and real MariaDB provisioning with working generated SQL credentials. It launches an ephemeral `mariadb:11.8` container bound to loopback port53316, and deletes its databases, SQL users, host metadata, server and container. Mail test settings are restored in a `finally` block without changing an existing encrypted mail password. Set `PARITY_RUN_CRON=1` to wait for a real automatic due-minute schedule. Coordinate shared settings tests with browser/S3 owners before running.

`cli.mjs` compiles a separate temporary binary, loads private deployment environment in memory and tests the actual process commands against persisted data and a separately provisioned real Wings server. It checks secret-free diagnostic output and deletes its binary and fixtures. It never runs global maintenance mode or changes the browser owner's server power.

`equivalence.mjs` documents all97 original admin routes and their React/API replacements. Mappings are separate from behavioral and browser evidence.

`locales.mjs` compares the Go locale endpoint against the original PHP translation arrays using the existing Ubuntu WSL PHP interpreter only as a read-only reference parser. It also checks placeholder interpolation syntax, ETag304 responses, browser cache headers, invalid parameters and missing locales. PHP is a test-reference dependency for this comparison, not a Go application dependency.

`validation-compatibility.mjs` compares valid/invalid examples with the original installed Laravel validator and original HTTP JSON normalization middleware without booting the PHP panel. It imports the rule definitions unchanged. With `PARITY_VALIDATE_RUNTIME=1`, a separate real daemon server tests accepted/rejected application startup values, rejection without overwriting persisted values, whitespace normalization, and client startup values for scalar rules. Dependent rules use the native nested `environment` context on application startup; original client startup validation uses a different context.

`dto.mjs` checks required create fields, scalar types and bounds against read-only original request/model rules, then requires rejection through the actual Go HTTP endpoints. It tracks and removes exact IDs even when an older binary wrongly accepts invalid input. Its field-rule oracle excludes database presence/uniqueness, which other suites exercise against real PostgreSQL.

`feature-audit.mjs` reviews all 50 native feature groups and links implementation sources to named action evidence, separately produced browser/runtime artifacts and executed Go test reports. Original duplicate control lines do not define feature completeness. `report.mjs` preserves separate counts for independent checks, peer artifacts, route mappings, original control mappings and game data roundtrips. Generate the feature audit after the final Go JSONL reports are available.

The generated report fails closed. Missing checks and untested branches remain unverified. Source review and representative behavior evidence can establish an implemented feature group without claiming every original duplicate button was clicked. Route registration, compilation and a clean page screenshot never establish full parity.

After the integration owner explicitly reviews the pinned native feature baseline, `node tools/parity/report.mjs --native-baseline-reviewed` can record that scoped signoff. It additionally requires all 50 feature groups reviewed/exercised without known failures, zero failed/blocked independent checks, all 321 egg roundtrips, and passing full/race Go reports. Missing route/control branch mappings, individual game installation coverage, deferred authentication and native host constraints remain visible and are not promoted into tested coverage by that signoff.
