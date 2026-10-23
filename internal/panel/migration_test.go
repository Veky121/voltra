package panel

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

func migrationFixture() LegacySnapshot {
	s := LegacySnapshot{Format: LegacySnapshotFormat, Version: LegacySnapshotVersion, Source: "pterodactyl-laravel", ExportedAt: "2026-10-21T00:00:00Z", SecretEncoding: "plaintext-private", Tables: map[string][]M{}, Notices: []LegacyMigrationNotice{}, Unsupported: []LegacyMigrationNotice{}}
	for _, table := range migrationTables {
		s.Tables[table] = []M{}
	}
	s.Tables["users"] = []M{{"id": 101, "uuid": "11111111-1111-4111-8111-111111111111", "username": "migration-admin", "email": "migration@example.test", "root_admin": true}, {"id": 102, "uuid": "11111111-1111-4111-8111-111111111112", "username": "migration-subuser", "email": "subuser@example.test", "root_admin": false}}
	token := "ptla_MIGRATETEST1fixture-secret-for-api-key"
	hash := sha256.Sum256([]byte(token))
	s.Tables["api_keys"] = []M{{"id": 1901, "user_id": 101, "identifier": "ptla_MIGRATETEST1", "token_hash": hex.EncodeToString(hash[:]), "type": "application", "permissions": M{"servers": int64(3)}, "allowed_ips": []any{"127.0.0.1"}, "expires_at": "2999-01-01T00:00:00Z"}}
	s.Tables["ssh_keys"] = []M{{"id": 2001, "user_id": 101, "name": "migrated-key", "public_key": "ssh-ed25519 migration-fixture-public-key", "fingerprint": "SHA256:migration-fixture"}}
	s.Tables["locations"] = []M{{"id": 201, "short": "migration", "long": "Migrated location"}}
	s.Tables["nodes"] = []M{{"id": 301, "uuid": "33333333-3333-4333-8333-333333333333", "name": "migration-node", "location_id": 201, "fqdn": "127.0.0.1", "daemon_token_id": "MIGRATIONNODEKEY1", "daemon_token": "migration-daemon-secret"}}
	s.Tables["daemon_revocations"] = []M{{"id": 2201, "node_id": 301, "server_uuid": "77777777-7777-4777-8777-777777777777", "user_uuid": "11111111-1111-4111-8111-111111111112", "generation": 3, "attempts": 7, "next_attempt_at": "2999-01-01T00:00:00Z", "lease_until": "2020-01-01T00:00:00Z", "lease_token": "expired-fixture-lease", "last_error": "previous offline node", "completed_at": nil}, {"id": 2202, "node_id": 301, "server_uuid": "77777777-7777-4777-8777-777777777777", "user_uuid": "11111111-1111-4111-8111-111111111112", "generation": 2, "attempts": 1, "completed_at": "2026-10-20T12:00:00Z"}}
	s.Tables["nests"] = []M{{"id": 401, "uuid": "44444444-4444-4444-8444-444444444444", "author": "migration@example.test", "name": "Migrated nest"}}
	s.Tables["eggs"] = []M{{"id": 501, "uuid": "55555555-5555-4555-8555-555555555551", "nest_id": 401, "author": "migration@example.test", "name": "Child egg", "config_from": 502, "copy_script_from": 502, "config_files": nil, "script_install": nil}, {"id": 502, "uuid": "55555555-5555-4555-8555-555555555552", "nest_id": 401, "author": "migration@example.test", "name": "Parent egg", "docker_images": M{"Alpine": "alpine:3.23"}, "config_files": M{}, "config_startup": M{"done": "ready"}, "config_stop": "stop", "script_install": "echo install"}}
	s.Tables["egg_variables"] = []M{{"id": 601, "egg_id": 501, "name": "Migrated variable", "env_variable": "VARIABLE", "default_value": "default", "rules": "required|string"}}
	s.Tables["servers"] = []M{{"id": 701, "uuid": "77777777-7777-4777-8777-777777777777", "uuid_short": "77777777", "identifier": "77777777", "name": "Migrated server", "owner_id": 101, "node_id": 301, "nest_id": 401, "egg_id": 501, "allocation_id": 801, "image": "alpine:3.23", "startup": "echo {{VARIABLE}}"}}
	s.Tables["notification_jobs"] = []M{{"id": 2101, "user_id": 101, "server_id": 701, "event": "server:installed", "payload": M{"recipient": "migration@example.test", "subject": "Server installed", "message": "Fixture installation completed"}, "status": "sent", "delivered_at": "2026-10-20T12:00:00Z"}, {"id": 2102, "user_id": 101, "server_id": 701, "event": "server:backup", "payload": M{"recipient": "migration@example.test", "message": "Fixture backup completed"}, "status": "pending"}}
	s.Tables["allocations"] = []M{{"id": 801, "node_id": 301, "server_id": 701, "ip": "127.0.0.1", "port": 25565}}
	s.Tables["server_variables"] = []M{{"id": 901, "server_id": 701, "variable_id": 601, "variable_value": "saved-value"}}
	s.Tables["subusers"] = []M{{"id": 902, "server_id": 701, "user_id": 102, "permissions": []any{"websocket.connect", "control.start"}}}
	s.Tables["backups"] = []M{{"id": 1001, "uuid": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "server_id": 701, "name": "Migrated backup", "is_successful": true, "is_locked": true, "bytes": int64(1234567), "completed_at": "2026-10-20T12:00:00Z", "ignored_files": []any{"*.log"}}}
	s.Tables["schedules"] = []M{{"id": 1101, "server_id": 701, "name": "Daily backup", "cron_hour": "3", "cron_minute": "0", "next_run_at": "2026-10-22T03:00:00Z"}}
	s.Tables["tasks"] = []M{{"id": 1201, "schedule_id": 1101, "sequence_id": 1, "action": "backup", "payload": "*.tmp", "continue_on_failure": false}}
	s.Tables["schedule_runs"] = []M{{"id": 1801, "schedule_id": 1101, "server_id": 701, "status": "completed", "last_error": nil}}
	s.Tables["database_hosts"] = []M{{"id": 1301, "node_id": 301, "name": "Migrated host", "host": "127.0.0.1", "username": "root", "password": "migration-host-secret"}}
	s.Tables["databases"] = []M{{"id": 1401, "server_id": 701, "database_host_id": 1301, "database": "s701_game", "username": "u701_game", "password": "migration-game-secret", "remote": "%", "max_connections": 100}}
	s.Tables["mounts"] = []M{{"id": 1501, "uuid": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "name": "Migrated mount", "source": "/srv/shared", "target": "/mnt/shared", "read_only": true}}
	s.Tables["mount_nodes"] = []M{{"mount_id": 1501, "node_id": 301}}
	s.Tables["mount_eggs"] = []M{{"mount_id": 1501, "egg_id": 501}}
	s.Tables["mount_servers"] = []M{{"mount_id": 1501, "server_id": 701}}
	s.Tables["activity_logs"] = []M{{"id": 1601, "actor_id": 101, "server_id": 701, "event": "server:import", "properties": M{"_ptero_go_legacy": M{"subjects": []any{M{"subject_type": "Pterodactyl\\Models\\Server", "subject_id": 701}}}}}}
	s.Tables["settings"] = []M{{"key": "app:name", "value": "Migrated Panel"}, {"key": "mail:password", "value": "migration-mail-secret"}, {"key": "backups.s3", "value": M{"bucket": "migration-bucket", "secret_access_key": "migration-s3-secret", "session_token": "migration-session-secret"}}, {"key": "boolean", "value": true}, {"key": "number", "value": json.Number("12")}, {"key": "json-null", "value": nil}}
	s.Tables["server_transfers"] = []M{{"id": 1701, "server_id": 701, "old_node": 301, "new_node": 301, "old_allocation": 801, "new_allocation": 801, "successful": true, "archived": true, "old_additional_allocations": []any{}, "new_additional_allocations": []any{}}}
	return s
}
func migrationReader(t *testing.T, s LegacySnapshot) *bytes.Reader {
	t.Helper()
	data, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	return bytes.NewReader(data)
}
func migrationTestApp(t *testing.T) *App {
	t.Helper()
	a := eggDatabaseApp(t)
	a.Config.EncryptionKey = "migration-fixture-encryption-key"
	return a
}
func migrationAssertEmpty(t *testing.T, a *App) {
	t.Helper()
	for _, table := range migrationTables {
		row, err := a.one(context.Background(), "SELECT count(*) AS count FROM \""+table+"\"")
		if err != nil || num(row["count"]) != 0 {
			t.Fatalf("expected empty %s: %v", table, err)
		}
	}
}

func TestMigrationPostgresRoundtrip(t *testing.T) {
	ctx := context.Background()
	a := migrationTestApp(t)
	s := migrationFixture()
	before, err := a.one(ctx, "SELECT last_value,is_called FROM users_id_seq")
	if err != nil {
		t.Fatal(err)
	}
	dry, err := a.ImportLegacyWithOptions(ctx, migrationReader(t, s), LegacyImportOptions{DryRun: true})
	if err != nil {
		t.Fatal(err)
	}
	if dry.Imported || !dry.DryRun || dry.Counts["users"] != 2 {
		t.Fatal(dry)
	}
	migrationAssertEmpty(t, a)
	after, err := a.one(ctx, "SELECT last_value,is_called FROM users_id_seq")
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("dry-run changed sequence", err)
	}
	report, err := a.ImportLegacyWithOptions(ctx, migrationReader(t, s), LegacyImportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if !report.Imported || report.Counts["eggs"] != 2 {
		t.Fatal(report)
	}
	for _, table := range migrationTables {
		got, err := a.one(ctx, "SELECT count(*) AS count FROM \""+table+"\"")
		if err != nil || num(got["count"]) != int64(len(s.Tables[table])) {
			t.Fatalf("%s count mismatch: %v", table, err)
		}
	}
	for table, column := range migrationSecrets {
		rows, err := a.query(ctx, "SELECT \""+column+"\" AS secret FROM \""+table+"\"")
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != len(s.Tables[table]) {
			t.Fatal(table)
		}
		if len(rows) == 0 {
			continue
		}
		sealed := str(rows[0]["secret"])
		if !strings.HasPrefix(sealed, "enc:v1:") {
			t.Fatalf("%s credential was not sealed", table)
		}
		plain, err := a.unseal(sealed)
		if err != nil || !strings.HasPrefix(plain, "migration-") {
			t.Fatalf("%s credential mismatch: %v", table, err)
		}
	}
	mail, err := a.one(ctx, "SELECT value FROM settings WHERE key='mail:password'")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(str(mail["value"]), "enc:v1:") {
		t.Fatal("mail credential not sealed")
	}
	effective, err := a.effectiveEgg(ctx, 501)
	if err != nil || str(effective["script_install"]) != "echo install" {
		t.Fatal("egg links not restored", err)
	}
	server, err := a.one(ctx, "SELECT * FROM servers WHERE id=701")
	if err != nil || num(server["allocation_id"]) != 801 {
		t.Fatal("allocation link not restored", err)
	}
	request := httptest.NewRequest("GET", "/api/application/servers", nil)
	request.RemoteAddr = "127.0.0.1:12345"
	request.Header.Set("Authorization", "Bearer ptla_MIGRATETEST1fixture-secret-for-api-key")
	request, err = a.AuthenticateAPIKey(request)
	if err != nil || UserID(request) != 101 {
		t.Fatal("existing bearer token did not migrate", err)
	}
	var exported bytes.Buffer
	if err = a.ExportSnapshot(ctx, &exported); err != nil {
		t.Fatal(err)
	}
	var first LegacySnapshot
	if err = json.Unmarshal(exported.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(exported.String(), "fixture-secret-for-api-key") {
		t.Fatal("snapshot contains plaintext API key")
	}
	if !strings.Contains(exported.String(), "migration-daemon-secret") {
		t.Fatal("snapshot omitted decrypted daemon credentials")
	}
	b := migrationTestApp(t)
	b.Config.EncryptionKey = "different-destination-encryption-key"
	if err = b.ImportLegacy(ctx, bytes.NewReader(exported.Bytes())); err != nil {
		t.Fatal(err)
	}
	var reexported bytes.Buffer
	if err = b.ExportSnapshot(ctx, &reexported); err != nil {
		t.Fatal(err)
	}
	var second LegacySnapshot
	if err = json.Unmarshal(reexported.Bytes(), &second); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first.Tables, second.Tables) {
		for _, table := range migrationTables {
			if !reflect.DeepEqual(first.Tables[table], second.Tables[table]) {
				t.Errorf("%s changed in snapshot roundtrip", table)
			}
		}
	}
	created, err := b.insert(ctx, "users", M{"uuid": newUUID(), "username": "after-migration", "email": "after@example.test"})
	if err != nil || num(created["id"]) <= 102 {
		t.Fatal("sequence was not advanced", err)
	}
	revocation, err := b.insert(ctx, "daemon_revocations", M{"node_id": 301, "server_uuid": "another-server", "user_uuid": "another-user"})
	if err != nil || num(revocation["id"]) <= 2202 {
		t.Fatal("revocation sequence was not advanced", err)
	}
	if err = a.ImportLegacy(ctx, migrationReader(t, s)); err == nil || !strings.Contains(err.Error(), "not empty") {
		t.Fatal("occupied target not refused", err)
	}
}

func TestMigrationPostgresRefusalRollback(t *testing.T) {
	tests := []struct {
		name     string
		alter    func(*LegacySnapshot)
		contains string
	}{
		{"version", func(s *LegacySnapshot) { s.Version = 99 }, "format or version"},
		{"encoding", func(s *LegacySnapshot) { s.SecretEncoding = "laravel-encrypted" }, "decrypted"},
		{"missing-table", func(s *LegacySnapshot) { delete(s.Tables, "mount_nodes") }, "missing required table"},
		{"unknown-table", func(s *LegacySnapshot) { s.Tables["dangerous"] = []M{} }, "unsupported table"},
		{"unknown-column", func(s *LegacySnapshot) { s.Tables["nodes"][0]["not_a_column"] = "private-secret-value" }, "Unsupported column"},
		{"foreign-key", func(s *LegacySnapshot) {
			s.Tables["nodes"][0]["location_id"] = 999999
			s.Tables["nodes"][0]["daemon_token"] = "private-secret-value"
		}, "constraint/type error 23503"},
		{"duplicate-user", func(s *LegacySnapshot) { s.Tables["users"][1]["email"] = s.Tables["users"][0]["email"] }, "constraint/type error 23505"},
		{"in-flight-task", func(s *LegacySnapshot) { s.Tables["tasks"][0]["is_queued"] = true }, "in-flight"},
		{"in-flight-schedule", func(s *LegacySnapshot) { s.Tables["schedules"][0]["is_processing"] = true }, "in-flight"},
		{"in-flight-notification", func(s *LegacySnapshot) { s.Tables["notification_jobs"][0]["status"] = "sending" }, "in-flight"},
		{"in-flight-revocation", func(s *LegacySnapshot) { s.Tables["daemon_revocations"][0]["lease_until"] = "2999-01-01T00:00:00Z" }, "in-flight"},
		{"api-hash", func(s *LegacySnapshot) { s.Tables["api_keys"][0]["token_hash"] = "private-secret-value" }, "Unsupported API key"},
		{"api-ip-restrictions", func(s *LegacySnapshot) { s.Tables["api_keys"][0]["allowed_ips"] = []any{"bad-address"} }, "Unsupported API IP restriction"},
		{"application-permissions", func(s *LegacySnapshot) { s.Tables["api_keys"][0]["permissions"] = M{"extension-resource": int64(3)} }, "Unsupported application API permissions"},
		{"subuser-permissions", func(s *LegacySnapshot) { s.Tables["subusers"][0]["permissions"] = []any{"*"} }, "Unsupported subuser permission"},
		{"unsupported-conversion", func(s *LegacySnapshot) {
			s.Unsupported = []LegacyMigrationNotice{{Code: "unsupported_api_key_type", Table: "api_keys", RowID: 99, Detail: "Unsupported legacy machine key type"}}
		}, "unsupported conversions"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			a := migrationTestApp(t)
			s := migrationFixture()
			tt.alter(&s)
			report, err := a.ImportLegacyWithOptions(context.Background(), migrationReader(t, s), LegacyImportOptions{})
			if err == nil || !strings.Contains(err.Error(), tt.contains) {
				t.Fatalf("expected %q, got %v", tt.contains, err)
			}
			if strings.Contains(err.Error(), "private-secret-value") {
				t.Fatal("failure leaked credential")
			}
			if report.Imported {
				t.Fatal("failed import marked committed")
			}
			migrationAssertEmpty(t, a)
		})
	}
}
func TestMigrationParserRejectsTrailingAndUnknown(t *testing.T) {
	a := &App{}
	for _, text := range []string{`{"unknown":"private-secret-value"}`, `{} {}`, `broken`} {
		_, err := a.ImportLegacyWithOptions(context.Background(), strings.NewReader(text), LegacyImportOptions{})
		if err == nil || strings.Contains(err.Error(), "private-secret-value") {
			t.Fatal(err)
		}
	}
}
func TestMigrationSettingsSecretTransform(t *testing.T) {
	a := &App{Config: Config{EncryptionKey: "fixture-key"}}
	input := M{"secret_access_key": "private-value", "session_token": "session-value", "bucket": "public-bucket", "nested": M{"password": "nested-password"}}
	sealed, err := a.migrationSettingsSecret("backups.s3", input, true)
	if err != nil {
		t.Fatal(err)
	}
	if str(asMap(sealed)["bucket"]) != "public-bucket" || !strings.HasPrefix(str(asMap(sealed)["secret_access_key"]), "enc:v1:") {
		t.Fatal("settings sealing mismatch")
	}
	plain, err := a.migrationSettingsSecret("backups.s3", sealed, false)
	if err != nil || !reflect.DeepEqual(plain, input) {
		t.Fatal("settings decrypt roundtrip mismatch", err)
	}
	if _, err = a.migrationSettingsSecret("mail:password", "enc:v1:broken", false); err == nil {
		t.Fatal("corrupt encrypted credential accepted")
	}
	if _, err = migrationValue(time.Now(), migrationColumn{Kind: "timestamp with time zone"}); err != nil {
		t.Fatal(err)
	}
}

// Optional private snapshot check never imports into the configured live schema.
// The database helper creates and removes a unique isolated schema and this call
// runs a complete rollback-only migration inside it.
func TestMigrationLegacyPrivateSnapshotPostgres(t *testing.T) {
	path := os.Getenv("TEST_LEGACY_SNAPSHOT")
	if path == "" {
		t.Skip("TEST_LEGACY_SNAPSHOT not set; private Laravel export check requires an explicit file")
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal("Cannot open explicitly configured private snapshot")
	}
	defer file.Close()
	a := migrationTestApp(t)
	report, err := a.ImportLegacyWithOptions(context.Background(), file, LegacyImportOptions{DryRun: true})
	if err != nil {
		t.Fatal(err)
	}
	if report.Counts["users"] == 0 || report.Counts["eggs"] == 0 {
		t.Fatal("Private source fixture is incomplete")
	}
	migrationAssertEmpty(t, a)
	t.Logf("Validated private Laravel snapshot: %d users, %d nodes, %d eggs, %d servers, %d activity records. All changes rolled back.", report.Counts["users"], report.Counts["nodes"], report.Counts["eggs"], report.Counts["servers"], report.Counts["activity_logs"])
}

func TestMigrationDaemonRevocationLeaseBoundaries(t *testing.T) {
	at := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name      string
		lease     any
		completed any
		blocked   bool
	}{
		{"unleased", nil, nil, false},
		{"expired", at.Add(-time.Nanosecond).Format(time.RFC3339Nano), nil, false},
		{"boundary", at.Format(time.RFC3339Nano), nil, false},
		{"future", at.Add(time.Nanosecond).Format(time.RFC3339Nano), nil, true},
		{"native-timestamp-future", at.Add(time.Minute), nil, true},
		{"completed", at.Add(time.Minute).Format(time.RFC3339Nano), at.Add(-time.Hour).Format(time.RFC3339Nano), false},
		{"invalid", "not-a-timestamp", nil, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := LegacySnapshot{Tables: map[string][]M{"daemon_revocations": {{"id": 1, "lease_until": tt.lease, "lease_token": "private-fixture-lease-token", "completed_at": tt.completed}}}}
			report := LegacyImportReport{}
			err := migrationValidateStateAt(s, &report, at)
			if (err != nil) != tt.blocked {
				t.Fatalf("blocked=%v err=%v", tt.blocked, err)
			}
			if err != nil && strings.Contains(err.Error(), "private-fixture-lease-token") {
				t.Fatal("lease token leaked")
			}
		})
	}
}

func TestMigrationPostgresIgnoresSchemaVersionMetadata(t *testing.T) {
	ctx := context.Background()
	a := migrationTestApp(t)
	if err := a.migrate(ctx); err != nil {
		t.Fatal(err)
	}
	metadata, err := a.query(ctx, "SELECT * FROM panel_schema_versions ORDER BY version")
	if err != nil || len(metadata) == 0 {
		t.Fatal("schema version metadata absent", err)
	}
	if err = a.ImportLegacy(ctx, migrationReader(t, migrationFixture())); err != nil {
		t.Fatal("schema metadata made empty product database look occupied", err)
	}
	var output bytes.Buffer
	if err = a.ExportSnapshot(ctx, &output); err != nil {
		t.Fatal(err)
	}
	var snapshot LegacySnapshot
	if err = json.Unmarshal(output.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if _, ok := snapshot.Tables["panel_schema_versions"]; ok {
		t.Fatal("internal schema metadata was exported")
	}
	after, err := a.query(ctx, "SELECT * FROM panel_schema_versions ORDER BY version")
	if err != nil || !reflect.DeepEqual(metadata, after) {
		t.Fatal("migration modified target schema version metadata", err)
	}
}
