package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCLIOptionParsing(t *testing.T) {
	options, p, e := cliParse([]string{"restart", "--nodes", "1,2", "--force", "--servers=3"}, []string{"nodes", "servers"}, []string{"force"})
	if e != nil {
		t.Fatal(e)
	}
	if len(p) != 1 || p[0] != "restart" || options["nodes"] != "1,2" || options["force"] != "true" {
		t.Fatalf("unexpected parse %v %v", options, p)
	}
	for _, args := range [][]string{{"--unknown"}, {"--nodes"}, {"--force=maybe"}, {"--nodes=1", "--nodes=2"}} {
		if _, _, e = cliParse(args, []string{"nodes"}, []string{"force"}); e == nil {
			t.Fatalf("accepted invalid arguments %v", args)
		}
	}
	if ids, e := cliIDs("1,2,1"); e != nil || len(ids) != 2 {
		t.Fatalf("deduplication: %v %v", ids, e)
	}
	for _, raw := range []string{"0", "1,-2", "a", "1,,2", "1;DROP TABLE users"} {
		if _, e := cliIDs(raw); e == nil {
			t.Fatalf("accepted malformed IDs %q", raw)
		}
	}
	a := &App{}
	for _, args := range [][]string{{"unknown"}, {"p:upgrade"}, {"key:generate"}, {"p:user:disable2fa"}, {"p:maintenance:clean-service-backups"}, {"p:user:make", "--password=secret"}, {"migrate", "rollback"}} {
		if e = a.RunCommand(context.Background(), args, &bytes.Buffer{}); e == nil {
			t.Fatalf("unsupported command returned success: %v", args)
		}
	}
	if got := cliSafeURL("https://user:secret@example.test/path?token=secret#secret"); got != "https://example.test/path" {
		t.Fatalf("credential leak in URL %q", got)
	}
}

func TestCLIAddonHooksOptIn(t *testing.T) {
	a := &App{}
	ctx := context.Background()
	root := t.TempDir()
	hooks := filepath.Join(root, "example", "hooks")
	if e := os.MkdirAll(hooks, 0700); e != nil {
		t.Fatal(e)
	}
	event := filepath.Join(hooks, "post-install")
	marker := filepath.Join(root, "executed")
	if runtime.GOOS == "windows" {
		if e := os.WriteFile(event, []byte("this must never run"), 0700); e != nil {
			t.Fatal(e)
		}
	} else {
		script := "#!/bin/sh\nprintf executed > '" + strings.ReplaceAll(marker, "'", "'\\''") + "'\n"
		if e := os.WriteFile(event, []byte(script), 0700); e != nil {
			t.Fatal(e)
		}
	}
	var output bytes.Buffer
	if e := a.RunCommand(ctx, []string{"p:environment:addons:run-hooks", "post-install", "--directory", root}, &output); e != nil {
		t.Fatal(e)
	}
	if _, e := os.Stat(marker); !os.IsNotExist(e) {
		t.Fatal("hook ran without opt-in")
	}
	if e := a.RunCommand(ctx, []string{"p:environment:addons:run-hooks", "../escape", "--enabled", "--directory", root}, &output); e == nil {
		t.Fatal("hook path traversal accepted")
	}
	if runtime.GOOS != "windows" {
		if e := a.RunCommand(ctx, []string{"p:environment:addons:run-hooks", "post-install", "--enabled", "--directory", root}, &output); e != nil {
			t.Fatal(e)
		}
		if _, e := os.Stat(marker); e != nil {
			t.Fatalf("opt-in executable hook did not run: %v", e)
		}
	}
}

func cliTestApp(t *testing.T) *App {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is required for CLI PostgreSQL integration")
	}
	ctx := context.Background()
	admin, e := pgxpool.New(ctx, databaseURL)
	if e != nil {
		t.Fatal(e)
	}
	schemaName := "cli_test_" + randomToken(6)
	quotedSchema, e := quoted(schemaName)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = admin.Exec(ctx, "CREATE SCHEMA "+quotedSchema); e != nil {
		admin.Close()
		t.Fatal(e)
	}
	config, e := pgxpool.ParseConfig(databaseURL)
	if e != nil {
		t.Fatal(e)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schemaName
	pool, e := pgxpool.NewWithConfig(ctx, config)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { pool.Close(); admin.Exec(ctx, "DROP SCHEMA "+quotedSchema+" CASCADE"); admin.Close() })
	if _, e = pool.Exec(ctx, schema); e != nil {
		t.Fatal(e)
	}
	return &App{DB: pool, HTTP: http.DefaultClient, Config: Config{DevMode: true, EncryptionKey: "cli-private-encryption-secret", PublicURL: "https://admin:public-secret@example.test/panel?token=query-secret", Listen: "127.0.0.1:8088"}}
}
func cliRunJSON(t *testing.T, a *App, args ...string) M {
	t.Helper()
	var output bytes.Buffer
	if e := a.RunCommand(context.Background(), args, &output); e != nil {
		t.Fatalf("%v: %v output=%s", args, e, output.String())
	}
	var result M
	if e := json.Unmarshal(output.Bytes(), &result); e != nil {
		t.Fatalf("%v output not JSON: %s", args, output.String())
	}
	return result
}

func TestCLIAccountsSettingsMaintenancePostgres(t *testing.T) {
	a := cliTestApp(t)
	ctx := context.Background()
	owner := asMap(cliRunJSON(t, a, "p:user:make", "--username=cliadmin", "--email=cliadmin@example.test", "--name-first=CLI", "--name-last=Admin", "--admin=true")["attributes"])
	ownerID := num(owner["id"])
	if e := a.RunCommand(ctx, []string{"p:user:update", "--user", str(ownerID), "--disabled=true"}, &bytes.Buffer{}); e == nil {
		t.Fatal("last administrator disabled")
	}
	user := asMap(cliRunJSON(t, a, "p:user:make", "--username=cliuser", "--email=cliuser@example.test", "--name-first=CLI", "--name-last=User", "--no-password")["attributes"])
	cliRunJSON(t, a, "p:user:update", "--user=cliuser", "--name-first=Updated")
	preview := cliRunJSON(t, a, "p:user:delete", "--user=cliuser")
	if preview["dry_run"] != true {
		t.Fatal("deletion preview not marked")
	}
	if _, e := a.one(ctx, "SELECT id FROM users WHERE id=$1", user["id"]); e != nil {
		t.Fatal("preview deleted user")
	}
	cliRunJSON(t, a, "p:user:delete", "--user=cliuser", "--force")
	if _, e := a.one(ctx, "SELECT id FROM users WHERE id=$1", user["id"]); e == nil {
		t.Fatal("forced user delete failed")
	}
	if e := a.RunCommand(ctx, []string{"p:user:delete", "--user=cliadmin", "--force"}, &bytes.Buffer{}); e == nil {
		t.Fatal("last administrator deleted")
	}
	cliRunJSON(t, a, "p:environment:setup", "--name=CLI Panel", "--locale=en")
	settings, e := a.infraLoadSettings(ctx)
	if e != nil || settings["app:name"] != "CLI Panel" || settings["app:locale"] != "en" {
		t.Fatalf("CLI identity settings not persisted: %v", e)
	}
	for _, args := range [][]string{
		{"--name=", "--locale=de"},
		{"--name=Partial update", "--locale=x"},
		{"--name=Partial update", "--timezone=Not/A-Timezone"},
	} {
		if e := a.RunCommand(ctx, append([]string{"p:environment:setup"}, args...), &bytes.Buffer{}); e == nil {
			t.Fatalf("invalid deployment settings accepted: %v", args)
		}
		settings, e = a.infraLoadSettings(ctx)
		if e != nil || settings["app:name"] != "CLI Panel" || settings["app:locale"] != "en" {
			t.Fatal("invalid CLI settings partially changed panel identity")
		}
	}
	cliRunJSON(t, a, "p:environment:setup", "--timezone=Europe/Berlin")
	timezone, e := a.one(ctx, "SELECT value FROM settings WHERE key='app:timezone'")
	if e != nil || str(timezone["value"]) != "Europe/Berlin" {
		t.Fatalf("timezone not persisted: %v %v", timezone, e)
	}
	if e = a.RunCommand(ctx, []string{"p:environment:setup", "--timezone=Not/A-Timezone"}, &bytes.Buffer{}); e == nil {
		t.Fatal("invalid IANA timezone accepted")
	}
	timezone, e = a.one(ctx, "SELECT value FROM settings WHERE key='app:timezone'")
	if e != nil || str(timezone["value"]) != "Europe/Berlin" {
		t.Fatal("invalid timezone mutated stored setting")
	}
	for _, command := range []string{"p:info", "p:environment:setup"} {
		report := cliRunJSON(t, a, command)
		if report["timezone"] != "Europe/Berlin" {
			t.Fatalf("%s does not report effective timezone: %v", command, report)
		}
	}
	for _, command := range []string{"p:info", "env", "p:environment:database", "p:telemetry"} {
		var output bytes.Buffer
		if e = a.RunCommand(ctx, []string{command}, &output); e != nil {
			t.Fatal(e)
		}
		for _, secret := range []string{"cli-private-encryption-secret", "public-secret", "query-secret"} {
			if strings.Contains(output.String(), secret) {
				t.Fatalf("%s leaked %s", command, secret)
			}
		}
	}
	cliRunJSON(t, a, "down")
	maintenance, e := a.one(ctx, "SELECT value FROM settings WHERE key='app.maintenance'")
	if e != nil || !boolean(maintenance["value"]) {
		t.Fatal("down did not persist maintenance")
	}
	cliRunJSON(t, a, "up")
	maintenance, e = a.one(ctx, "SELECT value FROM settings WHERE key='app.maintenance'")
	if e != nil || boolean(maintenance["value"]) {
		t.Fatal("up did not clear maintenance")
	}
	cliRunJSON(t, a, "migrate")
	cliRunJSON(t, a, "migrate")
	versions, e := a.one(ctx, "SELECT count(*) AS count FROM panel_schema_versions")
	if e != nil || num(versions["count"]) != 1 {
		t.Fatalf("migrations did not use shared checksum ledger: %v %v", versions, e)
	}
	cliRunJSON(t, a, "health")
}

func TestCLIBulkPowerPruningSchedulerPostgres(t *testing.T) {
	a := cliTestApp(t)
	ctx := context.Background()
	var mu sync.Mutex
	requests := []string{}
	failUUID := ""
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			http.Error(w, "missing credentials", 401)
			return
		}
		requests = append(requests, r.URL.Path)
		if failUUID != "" && strings.Contains(r.URL.Path, failUUID) {
			http.Error(w, "daemon action failed", 500)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/power") {
			var payload M
			if e := json.NewDecoder(r.Body).Decode(&payload); e != nil {
				t.Error(e)
			}
			if payload["action"] != "restart" {
				t.Errorf("bad power payload %v", payload)
			}
			if _, wrong := payload["signal"]; wrong {
				t.Error("unsupported Wings power signal field")
			}
		}
		w.WriteHeader(204)
	}))
	defer daemon.Close()
	address, _ := url.Parse(daemon.URL)
	host, port, _ := net.SplitHostPort(address.Host)
	owner := asMap(cliRunJSON(t, a, "p:user:make", "--username=bulkowner", "--email=bulkowner@example.test", "--name-first=Bulk", "--name-last=Owner", "--admin=true")["attributes"])
	location := asMap(cliRunJSON(t, a, "p:location:make", "--short=clibulk", "--long=CLI tests")["attributes"])
	nodeArgs := []string{"p:node:make", "--name=cli-node-1", "--locationId=" + str(location["id"]), "--fqdn=" + host, "--daemonListeningPort=" + port, "--maxMemory=4096", "--maxDisk=20480"}
	node := asMap(cliRunJSON(t, a, nodeArgs...)["attributes"])
	nodeArgs[1] = "--name=cli-node-2"
	otherNode := asMap(cliRunJSON(t, a, nodeArgs...)["attributes"])
	if e := a.RunCommand(ctx, []string{"p:location:delete", "--short=clibulk", "--force"}, &bytes.Buffer{}); e == nil {
		t.Fatal("location with nodes deleted")
	}
	var listing bytes.Buffer
	if e := a.RunCommand(ctx, []string{"p:node:list", "--format=json"}, &listing); e != nil {
		t.Fatal(e)
	}
	if strings.Contains(listing.String(), "daemon_token") {
		t.Fatal("node listing leaked daemon credentials")
	}
	insert := func(table string, data M) M {
		t.Helper()
		row, e := a.insert(ctx, table, data)
		if e != nil {
			t.Fatalf("fixture %s: %v", table, e)
		}
		return row
	}
	nest := insert("nests", M{"uuid": newUUID(), "name": "CLI", "author": "cli@example.test"})
	egg := insert("eggs", M{"uuid": newUUID(), "nest_id": nest["id"], "name": "CLI", "author": "cli@example.test"})
	server := func(name string, nodeID any, status any, installed bool) M {
		short := randomToken(4)
		data := M{"uuid": newUUID(), "uuid_short": short, "identifier": short, "name": name, "owner_id": owner["id"], "node_id": nodeID, "nest_id": nest["id"], "egg_id": egg["id"], "image": "alpine:3", "status": status}
		if installed {
			data["installed_at"] = time.Now().UTC()
		}
		return insert("servers", data)
	}
	first := server("first", node["id"], nil, true)
	second := server("second", otherNode["id"], nil, true)
	server("suspended", node["id"], "suspended", true)
	server("not installed", otherNode["id"], "installing", false)
	preview := cliRunJSON(t, a, "p:server:bulk-power", "restart", "--servers="+str(first["id"]), "--nodes="+str(otherNode["id"]))
	if preview["dry_run"] != true || num(preview["selected"]) != 2 {
		t.Fatalf("bad union/status filtering %v", preview)
	}
	if len(requests) != 0 {
		t.Fatal("preview contacted daemon")
	}
	executed := cliRunJSON(t, a, "p:server:bulk-power", "restart", "--servers="+str(first["id"]), "--nodes="+str(otherNode["id"]), "--force")
	if executed["dry_run"] != false || len(requests) != 2 {
		t.Fatalf("bulk execution failed %v %v", executed, requests)
	}
	mu.Lock()
	failUUID = str(first["uuid"])
	requests = nil
	mu.Unlock()
	var failed bytes.Buffer
	if e := a.RunCommand(ctx, []string{"p:server:bulk-power", "restart", "--force"}, &failed); e == nil {
		t.Fatal("daemon failure did not make command fail")
	}
	mu.Lock()
	count := len(requests)
	failUUID = ""
	requests = nil
	mu.Unlock()
	if count != 2 {
		t.Fatal("first daemon failure aborted remaining servers")
	}
	if e := a.RunCommand(ctx, []string{"p:user:delete", "--user", str(owner["id"]), "--force"}, &bytes.Buffer{}); e == nil {
		t.Fatal("server owner deleted")
	}
	old := insert("backups", M{"uuid": newUUID(), "server_id": first["id"], "name": "old", "created_at": time.Now().Add(-8 * time.Hour)})
	recent := insert("backups", M{"uuid": newUUID(), "server_id": first["id"], "name": "recent"})
	completed := insert("backups", M{"uuid": newUUID(), "server_id": second["id"], "name": "completed", "created_at": time.Now().Add(-8 * time.Hour), "completed_at": time.Now(), "is_successful": true})
	pruned := cliRunJSON(t, a, "p:maintenance:prune-backups", "--prune-age=360")
	if num(pruned["marked_failed"]) != 1 {
		t.Fatalf("bad prune selection %v", pruned)
	}
	for _, tt := range []struct {
		id                        any
		wantComplete, wantSuccess bool
	}{{old["id"], true, false}, {recent["id"], false, false}, {completed["id"], true, true}} {
		row, e := a.one(ctx, "SELECT completed_at,is_successful FROM backups WHERE id=$1", tt.id)
		if e != nil {
			t.Fatal(e)
		}
		if (row["completed_at"] != nil) != tt.wantComplete || boolean(row["is_successful"]) != tt.wantSuccess {
			t.Fatalf("prune corrupted backup %v", row)
		}
	}
	schedule := insert("schedules", M{"server_id": first["id"], "name": "CLI schedule", "cron_minute": "*", "cron_hour": "*", "cron_day_of_month": "*", "cron_month": "*", "cron_day_of_week": "*", "next_run_at": time.Now().Add(-time.Minute)})
	insert("tasks", M{"schedule_id": schedule["id"], "sequence_id": int64(1), "action": "command", "payload": "say cli scheduler", "time_offset": int64(0)})
	result := cliRunJSON(t, a, "p:schedule:process")
	if num(result["queued"]) != 1 || num(result["processed_tasks"]) < 1 {
		t.Fatalf("scheduler not executed %v", result)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(requests) == 0 || !strings.HasSuffix(requests[0], "/commands") {
		t.Fatalf("scheduler did not contact daemon %v", requests)
	}
	cliRunJSON(t, a, "p:maintenance:prune-activity", "--days=90")
	var configuration bytes.Buffer
	if e := a.RunCommand(ctx, []string{"p:node:configuration", str(node["id"]), "--format=json"}, &configuration); e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(configuration.String(), "token") {
		t.Fatal("explicit node configuration lacks authentication configuration")
	}
}

func TestCLISnapshotFilesPostgres(t *testing.T) {
	source := cliTestApp(t)
	target := cliTestApp(t)
	target.Config.EncryptionKey = "different-target-key"
	ctx := context.Background()
	cliRunJSON(t, source, "p:user:make", "--username=snapshot-user", "--email=snapshot-private@example.test", "--name-first=Snapshot", "--name-last=User", "--admin=true")
	if err := source.cliApplySettings(ctx, M{"backups.s3": M{"secret_access_key": "snapshot-private-secret"}}, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(t.TempDir(), "private-snapshot.json")
	var report bytes.Buffer
	if e := source.RunCommand(ctx, []string{"export-snapshot", "--file", filename}, &report); e != nil {
		t.Fatal(e)
	}
	for _, secret := range []string{"snapshot-private@example.test", "snapshot-private-secret"} {
		if strings.Contains(report.String(), secret) {
			t.Fatal("export report leaked snapshot content")
		}
	}
	info, e := os.Stat(filename)
	if e != nil {
		t.Fatal(e)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Fatalf("snapshot permissions %o", info.Mode().Perm())
	}
	before, e := os.ReadFile(filename)
	if e != nil {
		t.Fatal(e)
	}
	if e = source.RunCommand(ctx, []string{"export-snapshot", "--file", filename}, &bytes.Buffer{}); e == nil {
		t.Fatal("export overwrote existing snapshot")
	}
	after, e := os.ReadFile(filename)
	if e != nil || !bytes.Equal(before, after) {
		t.Fatal("existing snapshot changed")
	}
	dryRun := cliRunJSON(t, target, "import-legacy", "--file", filename, "--dry-run")
	if dryRun["dry_run"] != true || dryRun["imported"] == true {
		t.Fatalf("wrong import dry run report %v", dryRun)
	}
	row, e := target.one(ctx, "SELECT count(*) AS count FROM users")
	if e != nil || num(row["count"]) != 0 {
		t.Fatal("dry-run changed target users")
	}
	imported := cliRunJSON(t, target, "import-legacy", "--file", filename)
	if imported["imported"] != true {
		t.Fatalf("snapshot not imported %v", imported)
	}
	row, e = target.one(ctx, "SELECT username FROM users")
	if e != nil || row["username"] != "snapshot-user" {
		t.Fatal("snapshot user not restored")
	}
	setting, e := target.one(ctx, "SELECT value FROM settings WHERE key='backups.s3'")
	if e != nil {
		t.Fatal(e)
	}
	plain, e := target.unseal(str(asMap(setting["value"])["secret_access_key"]))
	if e != nil || plain != "snapshot-private-secret" {
		t.Fatal("snapshot secret not re-encrypted for target")
	}
	for _, args := range [][]string{{"export-snapshot"}, {"export-snapshot", "--file=-"}, {"import-legacy", "--file=-"}} {
		if e = source.RunCommand(ctx, args, &bytes.Buffer{}); e == nil {
			t.Fatalf("accepted snapshot standard stream %v", args)
		}
	}
}
