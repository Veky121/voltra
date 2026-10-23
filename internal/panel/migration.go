package panel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const LegacySnapshotFormat = "ptero-go.snapshot"
const LegacySnapshotVersion = 1
const legacySnapshotLimit = 512 << 20

type LegacyMigrationNotice struct {
	Code   string `json:"code"`
	Table  string `json:"table,omitempty"`
	RowID  int64  `json:"row_id,omitempty"`
	Count  int64  `json:"count,omitempty"`
	Detail string `json:"detail"`
}
type LegacySnapshot struct {
	Format         string                  `json:"format"`
	Version        int                     `json:"version"`
	Source         string                  `json:"source"`
	ExportedAt     string                  `json:"exported_at"`
	SecretEncoding string                  `json:"secret_encoding"`
	Tables         map[string][]M          `json:"tables"`
	Notices        []LegacyMigrationNotice `json:"notices"`
	Unsupported    []LegacyMigrationNotice `json:"unsupported"`
}
type LegacyImportOptions struct{ DryRun bool }
type LegacyImportReport struct {
	Version     int                     `json:"version"`
	Source      string                  `json:"source"`
	Counts      map[string]int          `json:"counts"`
	Notices     []LegacyMigrationNotice `json:"notices"`
	Unsupported []LegacyMigrationNotice `json:"unsupported"`
	DryRun      bool                    `json:"dry_run"`
	Imported    bool                    `json:"imported"`
}
type LegacyImportError struct {
	Report LegacyImportReport
	Detail string
}

func (e *LegacyImportError) Error() string { return e.Detail }

// All names are fixed here; a snapshot can never inject a SQL identifier. Egg
// parent links and the server/allocation cycle are restored after the inserts.
var migrationTables = []string{"users", "api_keys", "ssh_keys", "locations", "nodes", "daemon_revocations", "nests", "eggs", "egg_variables", "servers", "notification_jobs", "allocations", "server_variables", "subusers", "backups", "schedules", "tasks", "schedule_runs", "database_hosts", "databases", "mounts", "mount_nodes", "mount_eggs", "mount_servers", "activity_logs", "settings", "server_transfers", "integrations", "server_integration_secrets"}
var migrationSecrets = map[string]string{"nodes": "daemon_token", "database_hosts": "password", "databases": "password", "integrations": "credentials", "server_integration_secrets": "value"}
var migrationNoID = map[string]bool{"settings": true, "mount_nodes": true, "mount_eggs": true, "mount_servers": true, "server_integration_secrets": true}

func (a *App) ImportLegacy(ctx context.Context, reader io.Reader) error {
	_, err := a.ImportLegacyWithOptions(ctx, reader, LegacyImportOptions{})
	return err
}

// ImportLegacyWithOptions never merges, truncates or updates an occupied panel.
// DryRun runs the complete inserts and foreign-key checks in a transaction and
// rolls them back without changing any PostgreSQL sequence.
func (a *App) ImportLegacyWithOptions(ctx context.Context, reader io.Reader, options LegacyImportOptions) (LegacyImportReport, error) {
	report := LegacyImportReport{Version: LegacySnapshotVersion, Counts: map[string]int{}, Notices: []LegacyMigrationNotice{}, Unsupported: []LegacyMigrationNotice{}, DryRun: options.DryRun}
	reject := func(detail string) (LegacyImportReport, error) {
		return report, &LegacyImportError{Report: report, Detail: detail}
	}
	if reader == nil {
		return reject("A private snapshot reader is required")
	}
	limited := io.LimitReader(reader, legacySnapshotLimit+1)
	decoder := json.NewDecoder(limited)
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	var snapshot LegacySnapshot
	if err := decoder.Decode(&snapshot); err != nil {
		return reject("Invalid migration snapshot JSON")
	}
	if decoder.InputOffset() > legacySnapshotLimit {
		return reject("Migration snapshot exceeds the 512 MiB limit")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return reject("Migration snapshot must contain exactly one JSON document")
	}
	report.Source = snapshot.Source
	report.Notices = snapshot.Notices
	report.Unsupported = snapshot.Unsupported
	if snapshot.Format != LegacySnapshotFormat || snapshot.Version != LegacySnapshotVersion {
		return reject("Unsupported migration snapshot format or version")
	}
	if snapshot.Source != "pterodactyl-laravel" && snapshot.Source != "ptero-go" {
		return reject("Unknown migration snapshot source")
	}
	if snapshot.SecretEncoding != "plaintext-private" {
		return reject("Snapshot credentials must be decrypted by the private exporter before import")
	}
	if _, err := time.Parse(time.RFC3339, snapshot.ExportedAt); err != nil {
		return reject("Snapshot exported_at must be an RFC3339 timestamp")
	}
	if len(snapshot.Unsupported) > 0 {
		return reject(fmt.Sprintf("Migration refused: snapshot reports %d unsupported conversions; inspect the sanitized unsupported report", len(snapshot.Unsupported)))
	}
	known := map[string]bool{}
	for _, table := range migrationTables {
		known[table] = true
		rows, present := snapshot.Tables[table]
		// These tables did not exist in older native or Laravel snapshots.
		if !present && table != "integrations" && table != "server_integration_secrets" {
			return reject("Snapshot is missing required table " + table)
		}
		report.Counts[table] = len(rows)
	}
	for table := range snapshot.Tables {
		if !known[table] {
			return reject("Snapshot contains unsupported table " + table)
		}
	}
	if a.Config.EncryptionKey == "" {
		return reject("ENCRYPTION_KEY is required to re-encrypt imported credentials")
	}
	if err := migrationValidateState(snapshot, &report); err != nil {
		return reject(err.Error())
	}
	tx, err := a.DB.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return reject("Could not begin migration transaction")
	}
	defer tx.Rollback(ctx)
	// Locks make the emptiness check atomic with respect to concurrent writers.
	locks := make([]string, 0, len(migrationTables))
	for _, table := range migrationTables {
		locks = append(locks, `"`+table+`"`)
	}
	if _, err = tx.Exec(ctx, "LOCK TABLE "+strings.Join(locks, ",")+" IN ACCESS EXCLUSIVE MODE"); err != nil {
		return reject("Target schema is missing required tables; apply schema migrations first")
	}
	for _, table := range migrationTables {
		var occupied bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM \""+table+"\" LIMIT 1)").Scan(&occupied); err != nil {
			return reject("Could not inspect target table " + table)
		}
		if occupied {
			return reject("Target database is not empty: " + table + " contains records. Import into a new empty schema with development seeding disabled")
		}
	}
	columns, err := migrationColumns(ctx, tx)
	if err != nil {
		return reject("Could not inspect target schema columns")
	}
	links := map[string][]M{"eggs": {}, "servers": {}}
	for _, table := range migrationTables {
		for index, original := range snapshot.Tables[table] {
			row := M{}
			for key, value := range original {
				column, ok := columns[table][key]
				if !ok {
					return reject(fmt.Sprintf("Unsupported column %s.%s in snapshot row %d", table, key, index+1))
				}
				normalized, err := migrationValue(value, column)
				if err != nil {
					return reject(fmt.Sprintf("Invalid value type in %s.%s row %d", table, key, index+1))
				}
				row[key] = normalized
			}
			if !migrationNoID[table] && num(row["id"]) < 1 {
				return reject(fmt.Sprintf("Snapshot %s row %d must preserve a positive source id", table, index+1))
			}
			if table == "api_keys" {
				if !migrationHash(str(row["token_hash"])) || (str(row["type"]) != "client" && str(row["type"]) != "application") {
					return reject(fmt.Sprintf("Unsupported API key credential or type in row %d; export a compatible SHA256 full-token hash", index+1))
				}
				if _, err := validateAllowedIPs(row["allowed_ips"]); err != nil {
					return reject(fmt.Sprintf("Unsupported API IP restriction in row %d", index+1))
				}
				if str(row["type"]) == "application" {
					if _, err := validateApplicationScopes(row["permissions"]); err != nil {
						return reject(fmt.Sprintf("Unsupported application API permissions in row %d", index+1))
					}
				}
			}
			if table == "subusers" {
				for _, permission := range asSlice(row["permissions"]) {
					if !validServerPermission(str(permission)) {
						return reject(fmt.Sprintf("Unsupported subuser permission in row %d; review legacy extension grants before import", index+1))
					}
				}
			}
			if table == "eggs" {
				link := M{"id": row["id"]}
				for _, key := range []string{"config_from", "copy_script_from"} {
					if value, ok := row[key]; ok {
						link[key] = value
						row[key] = nil
					}
				}
				links[table] = append(links[table], link)
			}
			if table == "servers" {
				if value, ok := row["allocation_id"]; ok {
					links[table] = append(links[table], M{"id": row["id"], "allocation_id": value})
					row["allocation_id"] = nil
				}
			}
			if secret, ok := migrationSecrets[table]; ok {
				plain, ok := row[secret].(string)
				if !ok {
					return reject(fmt.Sprintf("Missing plaintext credential in %s row %d", table, index+1))
				}
				sealed, err := a.seal(plain)
				if err != nil {
					return reject("Could not seal imported credentials")
				}
				row[secret] = sealed
			}
			if table == "settings" {
				row["value"], err = a.migrationSettingsSecret(str(row["key"]), row["value"], true)
				if err != nil {
					return reject("Could not seal imported settings credentials")
				}
			}
			for key, value := range row {
				column := columns[table][key]
				if value != nil && (column.Kind == "jsonb" || column.Kind == "json") {
					encoded, err := json.Marshal(value)
					if err != nil {
						return reject(fmt.Sprintf("Cannot encode JSON in %s.%s row %d", table, key, index+1))
					}
					row[key] = json.RawMessage(encoded)
				}
			}
			if err = migrationInsert(ctx, tx, table, row); err != nil {
				return reject(migrationSafeError(table, index+1, err))
			}
		}
	}
	for _, table := range []string{"eggs", "servers"} {
		for _, row := range links[table] {
			keys := []string{}
			for key := range row {
				if key != "id" {
					keys = append(keys, key)
				}
			}
			sort.Strings(keys)
			if len(keys) == 0 {
				continue
			}
			sets := []string{}
			args := []any{}
			for _, key := range keys {
				args = append(args, row[key])
				sets = append(sets, fmt.Sprintf("\"%s\"=$%d", key, len(args)))
			}
			args = append(args, row["id"])
			if _, err = tx.Exec(ctx, "UPDATE \""+table+"\" SET "+strings.Join(sets, ",")+" WHERE id=$"+strconv.Itoa(len(args)), args...); err != nil {
				return reject(migrationSafeError(table, 0, err))
			}
		}
	}
	if options.DryRun {
		if err = tx.Rollback(ctx); err != nil {
			return reject("Could not roll back migration dry-run")
		}
		report.Notices = append(report.Notices, LegacyMigrationNotice{Code: "dry_run_rolled_back", Detail: "All rows and foreign-key relationships were validated; no records or sequences were changed"})
		return report, nil
	}
	// IDs are explicit on every imported row. Advance sequences only after a
	// successful non-dry-run import so the next created object cannot collide.
	for _, table := range migrationTables {
		if migrationNoID[table] {
			continue
		}
		var sequence *string
		if err = tx.QueryRow(ctx, "SELECT pg_get_serial_sequence($1,'id')", table).Scan(&sequence); err != nil {
			return reject("Could not inspect imported ID sequence for " + table)
		}
		if sequence != nil {
			if _, err = tx.Exec(ctx, "SELECT setval($1::regclass,COALESCE((SELECT max(id) FROM \""+table+"\"),1),EXISTS(SELECT 1 FROM \""+table+"\"))", *sequence); err != nil {
				return reject("Could not advance imported ID sequence for " + table)
			}
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return reject("Migration transaction could not commit")
	}
	report.Imported = true
	return report, nil
}

func migrationHash(hash string) bool {
	if len(hash) != 64 {
		return false
	}
	for _, c := range hash {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}
func migrationSafeError(table string, row int, err error) string {
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		return fmt.Sprintf("Migration failed for %s row %d: PostgreSQL constraint/type error %s; transaction rolled back", table, row, pg.Code)
	}
	return fmt.Sprintf("Migration failed for %s row %d; transaction rolled back", table, row)
}

func migrationValidateState(s LegacySnapshot, report *LegacyImportReport) error {
	return migrationValidateStateAt(s, report, time.Now().UTC())
}
func migrationValidateStateAt(s LegacySnapshot, report *LegacyImportReport, at time.Time) error {
	block := func(table string, row M, detail string) {
		report.Unsupported = append(report.Unsupported, LegacyMigrationNotice{Code: "in_flight_operation", Table: table, RowID: num(row["id"]), Detail: detail})
	}
	for _, row := range s.Tables["daemon_revocations"] {
		if row["completed_at"] != nil || row["lease_until"] == nil {
			continue
		}
		lease, err := migrationValue(row["lease_until"], migrationColumn{Kind: "timestamp with time zone", Nullable: true})
		if err != nil {
			return fmt.Errorf("Invalid daemon_revocations lease timestamp")
		}
		if lease.(time.Time).After(at) {
			block("daemon_revocations", row, "A daemon revocation lease is active; stop the source worker and finish or let its lease expire before importing. Expired leases and retry generations are preserved")
		}
	}
	for _, row := range s.Tables["schedules"] {
		if boolean(row["is_processing"]) {
			block("schedules", row, "A schedule is processing; let the legacy worker finish before exporting")
		}
	}
	for _, row := range s.Tables["tasks"] {
		if boolean(row["is_queued"]) {
			block("tasks", row, "A Laravel task is queued; serialized PHP queue jobs cannot execute in Go")
		}
	}
	for _, row := range s.Tables["schedule_runs"] {
		if status := str(row["status"]); status == "pending" || status == "running" {
			block("schedule_runs", row, "A native schedule run is in flight; finish it before exporting")
		}
	}
	for _, row := range s.Tables["notification_jobs"] {
		if str(row["status"]) == "sending" {
			block("notification_jobs", row, "A notification delivery is in flight; finish sending before export to avoid duplicate email delivery")
		}
	}
	for _, row := range s.Tables["servers"] {
		if status := str(row["status"]); status == "installing" || status == "restoring_backup" {
			block("servers", row, "A daemon installation or backup restore is in flight; finish it before exporting")
		}
	}
	for _, row := range s.Tables["server_transfers"] {
		if row["successful"] == nil && !boolean(row["archived"]) {
			block("server_transfers", row, "An active node transfer must finish before migration")
		}
	}
	if len(report.Unsupported) > 0 {
		return fmt.Errorf("Migration refused: %d in-flight operations cannot safely resume on another panel", len(report.Unsupported))
	}
	return nil
}

type migrationColumn struct {
	Kind     string
	Nullable bool
}

func migrationColumns(ctx context.Context, tx pgx.Tx) (map[string]map[string]migrationColumn, error) {
	rows, err := tx.Query(ctx, "SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema=current_schema()")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]map[string]migrationColumn{}
	for rows.Next() {
		var table, column, kind, nullable string
		if err = rows.Scan(&table, &column, &kind, &nullable); err != nil {
			return nil, err
		}
		if out[table] == nil {
			out[table] = map[string]migrationColumn{}
		}
		out[table][column] = migrationColumn{kind, nullable == "YES"}
	}
	return out, rows.Err()
}
func migrationValue(value any, column migrationColumn) (any, error) {
	if value == nil {
		if !column.Nullable {
			if column.Kind == "jsonb" || column.Kind == "json" {
				return json.RawMessage("null"), nil
			}
			return nil, fmt.Errorf("null not allowed")
		}
		return nil, nil
	}
	switch column.Kind {
	case "bigint", "integer", "smallint":
		s := str(value)
		n, err := strconv.ParseInt(s, 10, 64)
		return n, err
	case "boolean":
		if v, ok := value.(bool); ok {
			return v, nil
		}
		switch str(value) {
		case "1":
			return true, nil
		case "0":
			return false, nil
		}
		return nil, fmt.Errorf("boolean required")
	case "timestamp with time zone", "timestamp without time zone":
		if t, ok := value.(time.Time); ok {
			return t, nil
		}
		for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05.999999", "2006-01-02 15:04:05"} {
			if t, err := time.Parse(layout, str(value)); err == nil {
				return t, nil
			}
		}
		return nil, fmt.Errorf("timestamp required")
	case "jsonb", "json": // A Go nil would become SQL NULL, so preserve a JSON null value explicitly.
		if _, err := json.Marshal(value); err != nil {
			return nil, err
		}
		return value, nil
	case "text", "character varying", "character":
		if s, ok := value.(string); ok {
			return s, nil
		}
		return nil, fmt.Errorf("text required")
	}
	return nil, fmt.Errorf("unsupported type")
}
func migrationInsert(ctx context.Context, tx pgx.Tx, table string, row M) error {
	keys := []string{}
	for key := range row {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		return fmt.Errorf("empty row")
	}
	columns, holders := []string{}, []string{}
	args := []any{}
	for _, key := range keys {
		columns = append(columns, `"`+key+`"`)
		args = append(args, row[key])
		holders = append(holders, "$"+strconv.Itoa(len(args)))
	}
	_, err := tx.Exec(ctx, "INSERT INTO \""+table+"\" ("+strings.Join(columns, ",")+") VALUES ("+strings.Join(holders, ",")+")", args...)
	return err
}

func migrationSecretName(key string) bool {
	parts := strings.FieldsFunc(strings.ToLower(key), func(c rune) bool { return c == '.' || c == ':' || c == '/' })
	if len(parts) == 0 {
		return false
	}
	switch parts[len(parts)-1] {
	case "password", "secret", "secret_key", "secret_access_key", "session_token", "token":
		return true
	}
	return false
}
func (a *App) migrationSettingsSecret(key string, value any, encrypt bool) (any, error) {
	switch v := value.(type) {
	case map[string]any:
		out := M{}
		for name, x := range v {
			converted, err := a.migrationSettingsSecret(key+"."+name, x, encrypt)
			if err != nil {
				return nil, err
			}
			out[name] = converted
		}
		return out, nil
	case []any:
		out := make([]any, len(v))
		for i, x := range v {
			converted, err := a.migrationSettingsSecret(key, x, encrypt)
			if err != nil {
				return nil, err
			}
			out[i] = converted
		}
		return out, nil
	case string:
		if !encrypt && strings.HasPrefix(v, "enc:v1:") {
			return a.unseal(v)
		}
		if encrypt && migrationSecretName(key) && v != "" {
			return a.seal(v)
		}
	}
	return value, nil
}

// ExportSnapshot writes private plaintext credentials only to the explicit
// caller-supplied writer. CLI integration must create a mode-0600 file, never
// direct this stream to stdout or an HTTP response.
func (a *App) ExportSnapshot(ctx context.Context, writer io.Writer) error {
	if writer == nil {
		return fmt.Errorf("A private snapshot writer is required")
	}
	tx, err := a.DB.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return fmt.Errorf("Could not begin snapshot transaction")
	}
	defer tx.Rollback(ctx)
	snapshot := LegacySnapshot{Format: LegacySnapshotFormat, Version: LegacySnapshotVersion, Source: "ptero-go", ExportedAt: time.Now().UTC().Format(time.RFC3339), SecretEncoding: "plaintext-private", Tables: map[string][]M{}, Notices: []LegacyMigrationNotice{}, Unsupported: []LegacyMigrationNotice{}}
	for _, table := range migrationTables {
		rows, err := migrationSnapshotRows(ctx, tx, table)
		if err != nil {
			return fmt.Errorf("Could not export table %s", table)
		}
		for _, row := range rows {
			if secret, ok := migrationSecrets[table]; ok {
				raw := str(row[secret])
				if raw != "" {
					plain, err := a.unseal(raw)
					if err != nil {
						return fmt.Errorf("Cannot decrypt %s credential for snapshot", table)
					}
					row[secret] = plain
				}
			}
			if table == "settings" {
				row["value"], err = a.migrationSettingsSecret(str(row["key"]), row["value"], false)
				if err != nil {
					return fmt.Errorf("Cannot decrypt settings credentials for snapshot")
				}
			}
		}
		snapshot.Tables[table] = rows
	}
	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("Could not complete snapshot transaction")
	}
	encoder := json.NewEncoder(writer)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	return encoder.Encode(snapshot)
}
func migrationSnapshotRows(ctx context.Context, tx pgx.Tx, table string) ([]M, error) {
	order := "id"
	if table == "settings" {
		order = "key"
	}
	if strings.HasPrefix(table, "mount_") {
		order = "mount_id"
	}
	if table == "server_integration_secrets" {
		order = "server_id"
	}
	rows, err := tx.Query(ctx, "SELECT * FROM \""+table+"\" ORDER BY \""+order+"\"")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fields := rows.FieldDescriptions()
	out := []M{}
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, err
		}
		row := M{}
		for i, value := range values {
			if n, ok := value.(int32); ok {
				value = int64(n)
			}
			row[fields[i].Name] = value
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
