<?php
declare(strict_types=1);
require __DIR__ . '/export-laravel.php';

function migration_assert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$source = [
    'users' => [['id' => 1, 'uuid' => 'user-uuid', 'external_id' => 'opaque-user-42', 'username' => 'admin', 'email' => 'admin@example.test', 'root_admin' => 1, 'name_first' => null, 'name_last' => null, 'language' => 'en', 'password' => 'EXCLUDED_AUTH_SECRET', 'remember_token' => 'EXCLUDED_AUTH_SECRET', 'totp_secret' => 'EXCLUDED_AUTH_SECRET', 'totp_authenticated_at' => null, 'use_totp' => 1, 'gravatar' => 0, 'created_at' => null, 'updated_at' => null]],
    'locations' => [['id' => 1, 'short' => 'test', 'long' => null]],
    'nodes' => [['id' => 1, 'uuid' => 'node-uuid', 'name' => 'Node', 'location_id' => 1, 'fqdn' => '127.0.0.1', 'daemonListen' => 8080, 'daemonSFTP' => 2022, 'daemonBase' => '/srv/wings', 'daemon_token_id' => 'opaque-node-id', 'daemon_token' => 'encrypted:daemon-secret', 'public' => 1]],
    'nests' => [['id' => 1, 'uuid' => 'nest-uuid', 'name' => 'Nest', 'author' => 'admin@example.test', 'description' => null]],
    'eggs' => [['id' => 1, 'uuid' => 'egg-uuid', 'nest_id' => 1, 'name' => 'Egg', 'author' => 'admin@example.test', 'docker_images' => '{"Alpine":"alpine:3.23"}', 'features' => '[]', 'config_files' => '{}', 'config_startup' => '{"done":"ready"}', 'config_logs' => '{}', 'startup' => null]],
    'egg_variables' => [['id' => 1, 'egg_id' => 1, 'name' => 'Variable', 'env_variable' => 'VAR', 'default_value' => 'value', 'rules' => null, 'user_viewable' => 1, 'user_editable' => 0]],
    'servers' => [['id' => 1, 'uuid' => 'server-uuid', 'uuidShort' => '12345678', 'external_id' => 'external-server-42', 'name' => 'Server', 'owner_id' => 1, 'node_id' => 1, 'nest_id' => 1, 'egg_id' => 1, 'allocation_id' => 1, 'allocation_limit' => null, 'image' => 'alpine:3.23', 'status' => null]],
    'database_hosts' => [['id' => 1, 'name' => 'Host', 'host' => '127.0.0.1', 'username' => 'root', 'port' => 3306, 'password' => 'encrypted:host-secret']],
    'databases' => [['id' => 1, 'server_id' => 1, 'database_host_id' => 1, 'database' => 's1_game', 'username' => 'u1_game', 'password' => 'encrypted:game-secret']],
    'backups' => [['id' => 1, 'uuid' => 'backup-uuid', 'server_id' => 1, 'name' => 'Active backup', 'disk' => 'wings', 'bytes' => '1234', 'ignored_files' => '[]', 'is_successful' => 1, 'is_locked' => 0, 'deleted_at' => null]],
    'api_keys' => [['id' => 1, 'user_id' => 1, 'key_type' => 2, 'identifier' => 'ptla_12345678901', 'token' => 'encrypted:api-secret', 'r_servers' => 3, 'r_users' => 1, 'allowed_ips' => '["127.0.0.1"]', 'expires_at' => '2027-01-01 00:00:00']],
    'user_ssh_keys' => [['id' => 1, 'user_id' => 1, 'name' => 'Active', 'public_key' => 'ssh-ed25519 key', 'fingerprint' => 'SHA256:test', 'deleted_at' => null], ['id' => 2, 'user_id' => 1, 'name' => 'Deleted', 'public_key' => 'ssh-ed25519 deleted', 'fingerprint' => 'SHA256:deleted', 'deleted_at' => '2026-01-01 00:00:00']],
    'settings' => [['id' => 1, 'key' => 'settings::mail:mailers:smtp:password', 'value' => 'encrypted:smtp-secret'], ['id' => 2, 'key' => 'settings::mail:mailers:smtp:port', 'value' => '587'], ['id' => 3, 'key' => 'settings::pterodactyl:client_features:allocations:enabled', 'value' => 'true']],
    'activity_logs' => [['id' => 1, 'batch' => null, 'event' => 'server:start', 'ip' => '127.0.0.1', 'description' => null, 'actor_type' => 'Pterodactyl\Models\User', 'actor_id' => 1, 'api_key_id' => 1, 'properties' => '{"_ptero_go_legacy":"existing-user-data"}', 'timestamp' => '2026-01-01 00:00:00']],
    'activity_log_subjects' => [['id' => 1, 'activity_log_id' => 1, 'subject_type' => 'Pterodactyl\Models\Server', 'subject_id' => 1], ['id' => 2, 'activity_log_id' => 1, 'subject_type' => 'Pterodactyl\Models\Node', 'subject_id' => 1]],
    'audit_logs' => [['id' => 1, 'uuid' => 'old-audit-uuid', 'user_id' => 1, 'server_id' => 1, 'action' => 'server:old', 'metadata' => '{}', 'created_at' => '2026-01-01 00:00:00']],
    'recovery_tokens' => [['id' => 1, 'user_id' => 1, 'token' => 'EXCLUDED_AUTH_SECRET']],
    'sessions' => [['id' => 'session', 'payload' => 'EXCLUDED_AUTH_SECRET']],
];
$decrypt = static function (string $value): string {
    if (!str_starts_with($value, 'encrypted:')) {
        throw new RuntimeException('Invalid fixture envelope');
    }
    return substr($value, strlen('encrypted:'));
};
$snapshot = migration_convert($source, $decrypt, ['app:name' => 'Fixture Panel']);
migration_assert(count($snapshot['unsupported']) === 0, 'Unexpected unsupported conversion');
migration_assert(count($snapshot['tables']) === count(PTERO_GO_SNAPSHOT_TABLES), 'Required native table omitted');
migration_assert($snapshot['tables']['nodes'][0]['daemon_token'] === 'daemon-secret', 'Node credential not decrypted');
migration_assert($snapshot['tables']['nodes'][0]['daemon_token_id'] === 'opaque-node-id', 'Opaque daemon ID was coerced');
migration_assert($snapshot['tables']['nodes'][0]['daemon_listen'] === 8080, 'Node port alias lost');
migration_assert($snapshot['tables']['users'][0]['external_id'] === 'opaque-user-42', 'Opaque user external ID was coerced');
migration_assert($snapshot['tables']['servers'][0]['identifier'] === '12345678', 'Server identifier alias lost');
migration_assert($snapshot['tables']['servers'][0]['allocation_limit'] === 0, 'Unlimited legacy allocation value not normalized');
migration_assert($snapshot['tables']['backups'][0]['disk'] === 'wings' && $snapshot['tables']['backups'][0]['bytes'] === 1234, 'Backup adapter was coerced or size lost');
migration_assert($snapshot['tables']['egg_variables'][0]['rules'] === '', 'Nullable rules not normalized');
migration_assert($snapshot['tables']['eggs'][0]['config_files'] instanceof stdClass, 'Empty configuration object became array');
migration_assert($snapshot['tables']['eggs'][0]['features'] === [], 'Empty feature array changed');
migration_assert($snapshot['tables']['api_keys'][0]['token_hash'] === hash('sha256', 'ptla_12345678901api-secret'), 'Bearer hash is incompatible');
migration_assert($snapshot['tables']['api_keys'][0]['permissions']->servers === 3, 'Application permissions lost');
migration_assert($snapshot['tables']['api_keys'][0]['expires_at'] === '2027-01-01T00:00:00.000000Z', 'API expiration lost');
migration_assert(count($snapshot['tables']['ssh_keys']) === 1, 'Deleted SSH credential reactivated');
migration_assert(count($snapshot['tables']['activity_logs']) === 2, 'Historical audit log lost');
$activity = $snapshot['tables']['activity_logs'][0];
migration_assert($activity['actor_id'] === 1 && $activity['server_id'] === 1, 'Activity links lost');
migration_assert($activity['properties']->_ptero_go_legacy === 'existing-user-data', 'User activity metadata overwritten');
migration_assert(count($activity['properties']->_ptero_go_legacy_->subjects ?? $activity['properties']->_ptero_go_legacy_['subjects'] ?? []) === 2, 'Polymorphic subjects not preserved');
$settings = array_column($snapshot['tables']['settings'], 'value', 'key');
migration_assert(!isset($settings['mail:password']) && !isset($settings['mail:port']), 'Obsolete SMTP settings exported');
migration_assert($settings['pterodactyl:client_features:allocations:enabled'] === true, 'Boolean settings not normalized');
migration_assert(isset($settings['legacy.migration.archive']['deleted_user_ssh_keys']), 'Deleted credentials not archived');
$json = json_encode($snapshot, JSON_THROW_ON_ERROR);
migration_assert(!str_contains($json, 'EXCLUDED_AUTH_SECRET'), 'Local authentication material leaked');
migration_assert(!str_contains($json, 'api-secret'), 'Raw API key leaked');

$unsupported = $source;
$unsupported['api_keys'][0]['key_type'] = 3;
$unsupported['jobs'] = [['id' => 1, 'payload' => 'not-portable']];
$unsupported['unrecognized_plugin_table'] = [['id' => 1]];
$blocked = migration_convert($unsupported, $decrypt);
migration_assert(count($blocked['unsupported']) === 3, 'Unsupported key, pending job or unknown table silently dropped');
fwrite(STDOUT, "Laravel migration exporter fixture checks passed.\n");
