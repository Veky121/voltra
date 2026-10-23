<?php

/**
 * Read-only, private exporter. Never print snapshot contents or exceptions that
 * could contain database credentials. Run with PHP from the Laravel environment.
 */
declare(strict_types=1);

const PTERO_GO_SNAPSHOT_TABLES = ['users', 'api_keys', 'ssh_keys', 'locations', 'nodes', 'daemon_revocations', 'nests', 'eggs', 'egg_variables', 'servers', 'notification_jobs', 'allocations', 'server_variables', 'subusers', 'backups', 'schedules', 'tasks', 'schedule_runs', 'database_hosts', 'databases', 'mounts', 'mount_nodes', 'mount_eggs', 'mount_servers', 'activity_logs', 'settings', 'server_transfers'];

function migration_notice(string $code, string $table, string $detail, int $count = 0, int $row = 0): array
{
    return ['code' => $code, 'table' => $table, 'row_id' => $row, 'count' => $count, 'detail' => $detail];
}

function migration_json(mixed $value): mixed
{
    if ($value === null || !is_string($value)) {
        return $value;
    }
    // Preserve the distinction between {} and []; PostgreSQL and Wings care.
    return json_decode($value, false, 512, JSON_THROW_ON_ERROR);
}

function migration_timestamp(mixed $value, string $timezone, ?string $fallback = null): ?string
{
    if ($value === null || $value === '' || str_starts_with((string) $value, '0000-00-00')) {
        return $fallback;
    }
    return (new DateTimeImmutable((string) $value, new DateTimeZone($timezone)))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.u\Z');
}

/** Pure conversion entrypoint also used by the fixture test. */
function migration_convert(array $source, callable $decrypt, array $config = [], string $timezone = 'UTC'): array
{
    $exported = gmdate('Y-m-d\TH:i:s\Z');
    $snapshot = ['format' => 'ptero-go.snapshot', 'version' => 1, 'source' => 'pterodactyl-laravel', 'exported_at' => $exported, 'secret_encoding' => 'plaintext-private', 'tables' => [], 'notices' => [], 'unsupported' => []];
    foreach (PTERO_GO_SNAPSHOT_TABLES as $table) {
        $snapshot['tables'][$table] = [];
    }
    $notices = &$snapshot['notices'];
    $unsupported = &$snapshot['unsupported'];
    $archive = [];
    $fields = [
        'users' => 'id uuid external_id username email name_first name_last root_admin language created_at updated_at',
        'ssh_keys' => 'id user_id name public_key fingerprint created_at updated_at',
        'locations' => 'id short long created_at updated_at',
        'nodes' => 'id uuid name description location_id fqdn scheme behind_proxy public memory memory_overallocate disk disk_overallocate upload_size daemon_listen daemon_sftp daemon_base daemon_token_id daemon_token maintenance_mode created_at updated_at',
        'nests' => 'id uuid author name description created_at updated_at',
        'eggs' => 'id uuid nest_id author name description features docker_images file_denylist startup config_files config_startup config_logs config_stop config_from script_install script_entry script_container script_is_privileged copy_script_from force_outgoing_ip update_url created_at updated_at',
        'egg_variables' => 'id egg_id name description env_variable default_value user_viewable user_editable rules created_at updated_at',
        'servers' => 'id uuid uuid_short external_id name description owner_id node_id nest_id egg_id allocation_id startup image status skip_scripts installed_at memory swap disk io cpu threads oom_disabled allocation_limit database_limit backup_limit created_at updated_at',
        'allocations' => 'id node_id server_id ip ip_alias port notes created_at updated_at',
        'server_variables' => 'id server_id variable_id variable_value created_at updated_at',
        'subusers' => 'id user_id server_id permissions created_at updated_at',
        'backups' => 'id uuid server_id name ignored_files disk checksum bytes is_successful is_locked completed_at upload_id created_at updated_at',
        'schedules' => 'id server_id name cron_minute cron_hour cron_day_of_month cron_month cron_day_of_week is_active is_processing only_when_online last_run_at next_run_at created_at updated_at',
        'tasks' => 'id schedule_id sequence_id action payload time_offset continue_on_failure is_queued created_at updated_at',
        'database_hosts' => 'id name host port username password node_id max_databases created_at updated_at',
        'databases' => 'id server_id database_host_id database username remote password max_connections created_at updated_at',
        'mounts' => 'id uuid name description source target read_only user_mountable',
        'mount_nodes' => 'mount_id node_id', 'mount_eggs' => 'mount_id egg_id', 'mount_servers' => 'mount_id server_id',
        'server_transfers' => 'id server_id old_node new_node old_allocation new_allocation old_additional_allocations new_additional_allocations successful archived created_at updated_at',
    ];
    $sourceNames = ['ssh_keys' => 'user_ssh_keys', 'mount_nodes' => 'mount_node', 'mount_eggs' => 'egg_mount', 'mount_servers' => 'mount_server'];
    $aliases = ['nodes' => ['daemon_listen' => 'daemonListen', 'daemon_sftp' => 'daemonSFTP', 'daemon_base' => 'daemonBase'], 'servers' => ['uuid_short' => 'uuidShort']];
    $json = ['features', 'docker_images', 'file_denylist', 'config_files', 'config_startup', 'config_logs', 'permissions', 'ignored_files', 'old_additional_allocations', 'new_additional_allocations'];
    $bools = ['root_admin', 'behind_proxy', 'public', 'maintenance_mode', 'script_is_privileged', 'force_outgoing_ip', 'user_viewable', 'user_editable', 'skip_scripts', 'oom_disabled', 'is_successful', 'is_locked', 'is_active', 'is_processing', 'only_when_online', 'continue_on_failure', 'is_queued', 'read_only', 'user_mountable', 'successful', 'archived'];
    $nullable = ['external_id', 'config_from', 'copy_script_from', 'server_id', 'ip_alias', 'notes', 'status', 'installed_at', 'threads', 'checksum', 'completed_at', 'upload_id', 'last_run_at', 'next_run_at', 'node_id', 'max_databases', 'successful', 'description', 'features', 'file_denylist', 'config_files', 'config_startup', 'config_logs', 'config_stop', 'script_install', 'update_url'];
    $neverArchive = ['users' => ['password', 'remember_token', 'use_totp', 'totp_secret', 'totp_authenticated_at', 'two_factor_secret', 'two_factor_recovery_codes', 'two_factor_confirmed_at', 'recovery_codes'], 'ssh_keys' => ['deleted_at'], 'backups' => ['deleted_at']];
    foreach ($fields as $table => $list) {
        $sourceTable = $sourceNames[$table] ?? $table;
        $names = explode(' ', $list);
        foreach ($source[$sourceTable] ?? [] as $original) {
            if (in_array($table, ['ssh_keys', 'backups'], true) && !empty($original['deleted_at'])) {
                $archive['deleted_' . $sourceTable][] = $original;
                continue;
            }
            $row = [];
            $handled = $neverArchive[$table] ?? [];
            foreach ($names as $field) {
                $sourceField = $aliases[$table][$field] ?? $field;
                $handled[] = $sourceField;
                if (!array_key_exists($sourceField, $original)) {
                    continue;
                }
                $value = $original[$sourceField];
                if ($field === 'created_at' || $field === 'updated_at' || str_ends_with($field, '_at')) {
                    $value = migration_timestamp($value, $timezone, in_array($field, ['created_at', 'updated_at'], true) ? $exported : null);
                } elseif (in_array($field, $json, true)) {
                    $value = migration_json($value);
                    if ($value === null && in_array($field, ['permissions', 'ignored_files', 'old_additional_allocations', 'new_additional_allocations'], true)) {
                        $value = [];
                    }
                } elseif (in_array($field, $bools, true)) {
                    $value = $value === null && $field === 'successful' ? null : (bool) $value;
                } elseif ($field === 'id' || str_ends_with($field, '_id') || ($field === 'disk' && $table !== 'backups') || in_array($field, ['memory', 'swap', 'io', 'cpu', 'port', 'bytes', 'memory_overallocate', 'disk_overallocate', 'upload_size', 'daemon_listen', 'daemon_sftp', 'allocation_limit', 'database_limit', 'backup_limit', 'sequence_id', 'time_offset', 'max_connections', 'max_databases', 'old_node', 'new_node', 'old_allocation', 'new_allocation'], true)) {
                    // external_id and daemon_token_id are opaque strings.
                    if (!in_array($field, ['external_id', 'daemon_token_id'], true)) {
                        $value = $value === null && in_array($field, $nullable, true) ? null : (int) $value;
                    }
                }
                if ($value === null && in_array($field, ['name_first', 'name_last', 'long', 'startup', 'rules'], true)) {
                    $value = '';
                }
                if ($value === null && $field === 'description' && $table !== 'eggs') {
                    $value = '';
                }
                $row[$field] = $value;
            }
            if ($table === 'users') {
                $row['disabled'] = false;
            }
            if ($table === 'nodes') {
                $row['allowed_origins'] = [];
                $row['daemon_token'] = (string) $decrypt((string) $original['daemon_token']);
            }
            if ($table === 'database_hosts' || $table === 'databases') {
                $row['password'] = (string) $decrypt((string) $original['password']);
            }
            if ($table === 'servers') {
                $row['identifier'] = (string) $row['uuid_short'];
            }
            if ($table === 'egg_variables') {
                $row['field_type'] = 'text';
            }
            if ($table === 'eggs' && $row['docker_images'] === null) {
                $unsupported[] = migration_notice('missing_docker_images', $sourceTable, 'Egg lacks supported Docker image definitions', 0, (int) $row['id']);
            }
            if ($table === 'server_variables' && $row['server_id'] === null) {
                $archive['orphan_server_variables'][] = $original;
                continue;
            }
            $extra = array_diff_key($original, array_flip($handled));
            if ($extra !== []) {
                $archive['extra_columns'][$sourceTable][] = ['source_id' => $original['id'] ?? null, 'fields' => $extra];
            }
            $snapshot['tables'][$table][] = $row;
        }
    }

    foreach ($source['api_keys'] ?? [] as $original) {
        $type = (int) $original['key_type'];
        if (!in_array($type, [1, 2], true)) {
            $unsupported[] = migration_notice('unsupported_api_key_type', 'api_keys', 'Legacy key types 0, 3 and 4 cannot be granted new semantics; revoke or replace before export', 0, (int) $original['id']);
            continue;
        }
        $identifier = (string) $original['identifier'];
        $token = (string) $decrypt((string) $original['token']);
        if (strlen($identifier) !== 16 || $token === '') {
            $unsupported[] = migration_notice('unsupported_api_key_credential', 'api_keys', 'Cannot preserve API key with missing identifier or token', 0, (int) $original['id']);
            continue;
        }
        $permissions = new stdClass();
        if ($type === 2) {
            foreach ($original as $key => $value) {
                if (str_starts_with($key, 'r_')) {
                    $permissions->{substr($key, 2)} = (int) $value;
                }
            }
        }
        $snapshot['tables']['api_keys'][] = ['id' => (int) $original['id'], 'user_id' => (int) $original['user_id'], 'identifier' => $identifier, 'token_hash' => hash('sha256', $identifier . $token), 'type' => $type === 1 ? 'client' : 'application', 'memo' => (string) ($original['memo'] ?? ''), 'allowed_ips' => migration_json($original['allowed_ips'] ?? null) ?? [], 'permissions' => $permissions, 'last_used_at' => migration_timestamp($original['last_used_at'] ?? null, $timezone), 'expires_at' => migration_timestamp($original['expires_at'] ?? null, $timezone), 'created_at' => migration_timestamp($original['created_at'] ?? null, $timezone, $exported), 'updated_at' => migration_timestamp($original['updated_at'] ?? null, $timezone, $exported)];
    }

    $users = array_column($snapshot['tables']['users'], null, 'id');
    $servers = array_column($snapshot['tables']['servers'], null, 'id');
    $subjects = [];
    foreach ($source['activity_log_subjects'] ?? [] as $subject) {
        $subjects[(int) $subject['activity_log_id']][] = $subject;
    }
    $nextActivityID = 1;
    foreach ($source['activity_logs'] ?? [] as $original) {
        $id = (int) $original['id'];
        $nextActivityID = max($nextActivityID, $id + 1);
        $properties = (array) migration_json($original['properties']);
        $metadata = ['actor_type' => $original['actor_type'], 'actor_id' => $original['actor_id'], 'api_key_id' => $original['api_key_id'], 'subjects' => $subjects[$id] ?? []];
        $marker = '_ptero_go_legacy';
        while (array_key_exists($marker, $properties)) {
            $marker .= '_';
        }
        $properties[$marker] = $metadata;
        $serverID = null;
        foreach ($subjects[$id] ?? [] as $subject) {
            if ($subject['subject_type'] === 'Pterodactyl\\Models\\Server' && isset($servers[(int) $subject['subject_id']])) {
                $serverID ??= (int) $subject['subject_id'];
            }
        }
        $actor = $original['actor_type'] === 'Pterodactyl\\Models\\User' && isset($users[(int) $original['actor_id']]) ? (int) $original['actor_id'] : null;
        $snapshot['tables']['activity_logs'][] = ['id' => $id, 'batch' => $original['batch'], 'event' => $original['event'], 'ip' => $original['ip'], 'description' => $original['description'], 'actor_id' => $actor, 'server_id' => $serverID, 'properties' => (object) $properties, 'created_at' => migration_timestamp($original['timestamp'], $timezone, $exported)];
    }
    foreach (['audit_logs', 'api_logs', 'tasks_log'] as $table) {
        foreach ($source[$table] ?? [] as $original) {
            $userID = isset($users[(int) ($original['user_id'] ?? 0)]) ? (int) $original['user_id'] : null;
            $serverID = isset($servers[(int) ($original['server_id'] ?? 0)]) ? (int) $original['server_id'] : null;
            $snapshot['tables']['activity_logs'][] = ['id' => $nextActivityID++, 'batch' => null, 'event' => $table === 'audit_logs' ? (string) $original['action'] : 'legacy:' . $table, 'ip' => (string) ($original['request_ip'] ?? ''), 'description' => null, 'actor_id' => $userID, 'server_id' => $serverID, 'properties' => (object) ['_ptero_go_legacy' => ['source_table' => $table, 'record' => $original]], 'created_at' => migration_timestamp($original['created_at'] ?? $original['run_time'] ?? null, $timezone, $exported)];
        }
        if (!empty($source[$table])) {
            $notices[] = migration_notice('historical_logs_converted', $table, 'Preserved original records inside activity properties; source identifiers remain in metadata', count($source[$table]));
        }
    }
    if (!empty($source['activity_logs'])) {
        $notices[] = migration_notice('activity_subjects_archived', 'activity_logs', 'First existing server subject is indexed; all actor, API-key and polymorphic subject links are preserved in properties._ptero_go_legacy', count($source['activity_logs']));
    }

    $settings = [];
    $settingsAliases = ['mail:mailers:smtp:host' => 'mail:host', 'mail:mailers:smtp:port' => 'mail:port', 'mail:mailers:smtp:username' => 'mail:username', 'mail:mailers:smtp:password' => 'mail:password', 'mail:mailers:smtp:encryption' => 'mail:encryption'];
    foreach ($source['settings'] ?? [] as $original) {
        $key = preg_replace('/^settings::/', '', (string) $original['key']);
        $target = $settingsAliases[$key] ?? $key;
        $value = $original['value'];
        if ($key === 'mail:mailers:smtp:password' && $value !== '') {
            $value = $decrypt((string) $value);
        }
        if (in_array(strtolower((string) $value), ['true', '(true)', 'false', '(false)'], true)) {
            $value = in_array(strtolower((string) $value), ['true', '(true)'], true);
        }
        if (in_array($target, ['pterodactyl:guzzle:timeout', 'pterodactyl:guzzle:connect_timeout', 'pterodactyl:client_features:allocations:range_start', 'pterodactyl:client_features:allocations:range_end', 'mail:port'], true)) {
            $value = (int) $value;
        }
        $settings[$target] = $value;
    }
    // Values stored only in .env are part of the running panel configuration.
    foreach ($config as $key => $value) {
        if (!array_key_exists($key, $settings)) {
            $settings[$key] = $value;
        }
    }
    foreach (['notifications', 'failed_jobs'] as $table) {
        if (!empty($source[$table])) {
            $archive[$table] = $source[$table];
        }
    }
    if ($archive !== []) {
        $settings['legacy.migration.archive'] = $archive;
        foreach ($archive as $name => $records) {
            $notices[] = migration_notice('archived_not_reactivated', $name, 'Original records preserved in private legacy.migration.archive settings; deleted credentials/backups stay inactive and legacy notifications/jobs are historical only', count($records));
        }
    }
    foreach ($settings as $key => $value) {
        $snapshot['tables']['settings'][] = ['key' => $key, 'value' => $value];
    }
    if (!empty($source['jobs'])) {
        $unsupported[] = migration_notice('pending_php_jobs', 'jobs', 'Drain Laravel jobs before exporting; serialized PHP jobs cannot execute in Go', count($source['jobs']));
    }
    $notices[] = migration_notice('native_notification_queue_empty', 'notification_jobs', 'Legacy serialized PHP notification jobs are not portable; the native queue starts empty. Existing notification history is archived and pending PHP jobs block import');
    $notices[] = migration_notice('native_revocation_queue_empty', 'daemon_revocations', 'Legacy serialized RevokeSftpAccessJob jobs cannot become native durable revocations; the native queue starts empty. Drain all pending PHP jobs before export; any pending job blocks import');
    $handledTables = array_unique(array_merge(array_keys($fields), array_values($sourceNames), ['api_keys', 'activity_logs', 'activity_log_subjects', 'settings', 'audit_logs', 'api_logs', 'tasks_log', 'notifications', 'failed_jobs', 'jobs', 'users', 'sessions', 'password_resets', 'password_reset_tokens', 'recovery_tokens', 'migrations', 'cache', 'cache_locks']));
    foreach ($source as $table => $rows) {
        if (!in_array($table, $handledTables, true) && count($rows) > 0) {
            $unsupported[] = migration_notice('unknown_source_table', $table, 'No reviewed conversion exists for this nonempty source table', count($rows));
        }
    }
    foreach (['sessions', 'password_resets', 'password_reset_tokens', 'recovery_tokens', 'migrations', 'cache', 'cache_locks'] as $table) {
        if (!empty($source[$table])) {
            $notices[] = migration_notice('intentionally_excluded', $table, 'Local authentication, cached state and Laravel schema history are intentionally excluded', count($source[$table]));
        }
    }
    $notices[] = migration_notice('user_authentication_excluded', 'users', 'Password hashes, remember tokens, TOTP secrets and recovery material are excluded; account IDs, ownership and permissions are retained', count($source['users'] ?? []));
    $notices[] = migration_notice('api_keys_hashed', 'api_keys', 'Existing full bearer tokens remain compatible; only SHA256(identifier plus decrypted token) is exported', count($snapshot['tables']['api_keys']));
    $notices[] = migration_notice('null_text_normalized', '', 'Nullable legacy name, description, empty startup/rules and missing creation/update timestamps normalize to native defaults; all IDs and relationships are retained');
    return $snapshot;
}

function migration_export_main(array $argv): int
{
    $options = getopt('', ['app:', 'output:']);
    if (!isset($options['app'], $options['output'])) {
        fwrite(STDERR, "Usage: php export-laravel.php --app=/absolute/laravel/path --output=/private/.local/legacy-snapshot.json\n");
        return 2;
    }
    $appRoot = realpath((string) $options['app']);
    $output = (string) $options['output'];
    if ($appRoot === false || !is_file($appRoot . '/bootstrap/app.php') || $output === '' || $output === '-' || file_exists($output)) {
        fwrite(STDERR, "Export refused: provide an existing Laravel app and a new private output file, never stdout.\n");
        return 2;
    }
    $file = null;
    $pdo = null;
    try {
        require $appRoot . '/vendor/autoload.php';
        $app = require $appRoot . '/bootstrap/app.php';
        $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
        $connection = $app->make('db')->connection();
        if ($connection->getDriverName() !== 'mysql') {
            throw new RuntimeException('Unsupported source database driver');
        }
        $pdo = $connection->getPdo();
        // Normalize MySQL TIMESTAMP columns in this connection only. This does
        // not update rows or the server's global timezone configuration.
        $pdo->exec("SET time_zone = '+00:00'");
        $pdo->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        $pdo->exec('SET TRANSACTION READ ONLY');
        $pdo->beginTransaction();
        $source = [];
        foreach ($pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $table) {
            if (!preg_match('/^[A-Za-z0-9_]+$/', (string) $table)) {
                throw new RuntimeException('Unsupported table identifier');
            }
            $source[(string) $table] = $pdo->query('SELECT * FROM `' . $table . '`')->fetchAll(PDO::FETCH_ASSOC);
        }
        $configKeys = ['app:name' => 'app.name', 'app:locale' => 'app.locale', 'mail:host' => 'mail.mailers.smtp.host', 'mail:port' => 'mail.mailers.smtp.port', 'mail:username' => 'mail.mailers.smtp.username', 'mail:password' => 'mail.mailers.smtp.password', 'mail:encryption' => 'mail.mailers.smtp.encryption', 'mail:from:address' => 'mail.from.address', 'mail:from:name' => 'mail.from.name', 'pterodactyl:guzzle:timeout' => 'pterodactyl.guzzle.timeout', 'pterodactyl:guzzle:connect_timeout' => 'pterodactyl.guzzle.connect_timeout', 'pterodactyl:client_features:allocations:enabled' => 'pterodactyl.client_features.allocations.enabled', 'pterodactyl:client_features:allocations:range_start' => 'pterodactyl.client_features.allocations.range_start', 'pterodactyl:client_features:allocations:range_end' => 'pterodactyl.client_features.allocations.range_end', 'backups.default' => 'backups.default', 'backups.throttles.limit' => 'backups.throttles.limit', 'backups.throttles.period' => 'backups.throttles.period', 'backups.prune_age' => 'backups.prune_age', 'backups.presigned_url_lifespan' => 'backups.presigned_url_lifespan'];
        $configKeys += ['app:timezone' => 'app.timezone', 'pterodactyl:client_features:databases:enabled' => 'pterodactyl.client_features.databases.enabled', 'pterodactyl:client_features:databases:allow_random' => 'pterodactyl.client_features.databases.allow_random', 'pterodactyl:client_features:schedules:per_schedule_task_limit' => 'pterodactyl.client_features.schedules.per_schedule_task_limit', 'activity:hide_admin_activity' => 'activity.hide_admin_activity', 'pterodactyl:email:send_install_notification' => 'pterodactyl.email.send_install_notification', 'pterodactyl:email:send_reinstall_notification' => 'pterodactyl.email.send_reinstall_notification'];
        $config = [];
        foreach ($configKeys as $target => $key) {
            $value = $app->make('config')->get($key);
            if ($value !== null) {
                $config[$target] = $value;
            }
        }
        if (($config['mail:encryption'] ?? null) === null) {
            $config['mail:encryption'] = 'none';
        }
        $s3 = $app->make('config')->get('backups.disks.s3', []);
        $config['backups.s3'] = ['bucket' => $s3['bucket'] ?? '', 'region' => $s3['region'] ?? 'us-east-1', 'endpoint' => $s3['endpoint'] ?? '', 'access_key_id' => $s3['key'] ?? '', 'secret_access_key' => $s3['secret'] ?? '', 'session_token' => $s3['token'] ?? '', 'path_style' => (bool) ($s3['use_path_style_endpoint'] ?? false), 'part_size' => (int) $app->make('config')->get('backups.max_part_size', 5368709120), 'storage_class' => $s3['storage_class'] ?? ''];
        $snapshot = migration_convert($source, fn (string $value): mixed => $app->make('encrypter')->decrypt($value), $config, 'UTC');
        $pdo->rollBack();
        umask(0077);
        $file = fopen($output, 'x');
        if ($file === false || !chmod($output, 0600)) {
            throw new RuntimeException('Cannot create private snapshot');
        }
        $encoded = json_encode($snapshot, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
        $offset = 0;
        while ($offset < strlen($encoded)) {
            $written = fwrite($file, substr($encoded, $offset));
            if ($written === false || $written === 0) {
                throw new RuntimeException('Cannot write snapshot');
            }
            $offset += $written;
        }
        fflush($file);
        if (function_exists('fsync')) {
            fsync($file);
        }
        fclose($file);
        $file = null;
        fwrite(STDERR, json_encode(['exported' => true, 'tables' => array_map('count', $snapshot['tables']), 'notices' => count($snapshot['notices']), 'unsupported' => count($snapshot['unsupported']), 'contains_private_credentials' => true], JSON_THROW_ON_ERROR) . "\n");
        return count($snapshot['unsupported']) === 0 ? 0 : 3;
    } catch (Throwable $exception) {
        if ($pdo instanceof PDO && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if (is_resource($file)) {
            fclose($file);
            @unlink($output);
        }
        // Exception messages and traces may contain SQL bindings or secrets.
        fwrite(STDERR, 'Export failed safely (' . get_class($exception) . "). No source writes were issued.\n");
        return 1;
    }
}

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    exit(migration_export_main($argv));
}
