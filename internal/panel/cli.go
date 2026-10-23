package panel

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"gopkg.in/yaml.v3"
)

// RunCommand provides the operational CLI. All output except an explicitly
// requested node configuration is safe to include in support diagnostics.
func (a *App) RunCommand(ctx context.Context, args []string, out io.Writer) error {
	if out == nil {
		out = io.Discard
	}
	if len(args) == 0 {
		return a.cliHelp(out)
	}
	command, rest := args[0], args[1:]
	switch command {
	case "help", "list", "--help", "-h":
		return a.cliHelp(out)
	case "p:info", "info", "env", "p:environment:database":
		return a.cliInfo(ctx, rest, out, command)
	case "health", "healthz":
		if len(rest) > 0 {
			return bad("health does not accept arguments.")
		}
		if e := a.DB.Ping(ctx); e != nil {
			return fmt.Errorf("PostgreSQL health check failed: %w", e)
		}
		return cliPrint(out, M{"status": "ok", "database": "postgresql"})
	case "migrate", "db:migrate":
		if _, p, e := cliParse(rest, nil, []string{"force"}); e != nil {
			return e
		} else if e = cliRequireNoPositionals(p); e != nil {
			return e
		}
		if e := a.migrate(ctx); e != nil {
			return e
		}
		return cliPrint(out, M{"schema": "current", "database": "postgresql"})
	case "db:seed":
		if _, p, e := cliParse(rest, nil, []string{"force"}); e != nil {
			return e
		} else if e = cliRequireNoPositionals(p); e != nil {
			return e
		}
		if !a.Config.DevMode {
			return bad("Production accounts are created with p:user:make; development seeding requires DEV_MODE=true.")
		}
		if e := a.SeedDevelopment(ctx); e != nil {
			return e
		}
		return cliPrint(out, M{"seeded": "development administrator", "password_login": false})
	case "p:user:make", "p:user:create", "p:user:update", "p:user:list", "p:user:delete":
		return a.cliUsers(ctx, command, rest, out)
	case "p:location:make", "p:location:delete":
		return a.cliLocation(ctx, command, rest, out)
	case "p:node:make", "p:node:list", "p:node:configuration":
		return a.cliNode(ctx, command, rest, out)
	case "p:server:bulk-power":
		return a.cliBulkPower(ctx, rest, out)
	case "p:schedule:process", "schedule:run":
		return a.cliScheduler(ctx, rest, out)
	case "p:maintenance:prune-backups":
		return a.cliPruneBackups(ctx, rest, out)
	case "p:maintenance:prune-activity":
		return a.cliPruneActivity(ctx, rest, out)
	case "down", "up":
		if _, p, e := cliParse(rest, nil, []string{"force"}); e != nil {
			return e
		} else if e = cliRequireNoPositionals(p); e != nil {
			return e
		}
		enabled := command == "down"
		if e := a.cliStoreSettings(ctx, M{"app.maintenance": enabled}); e != nil {
			return e
		}
		return cliPrint(out, M{"maintenance": enabled})
	case "p:environment:mail":
		return a.cliMail(ctx, rest, out)
	case "p:environment:setup":
		return a.cliSetup(ctx, rest, out)
	case "p:telemetry":
		return a.cliTelemetry(ctx, rest, out)
	case "p:environment:addons:run-hooks":
		return a.cliHooks(ctx, rest, out)
	case "import-legacy", "export-snapshot":
		return a.cliSnapshot(ctx, command, rest, out)
	case "p:user:disable2fa":
		return bad("Local password and two-factor authentication are intentionally absent. Cloudflare Access will manage sign-in after feature parity.")
	case "key:generate":
		return bad("ENCRYPTION_KEY is managed by the deployment environment. Automatic rotation is unavailable because existing encrypted node and database credentials must be re-encrypted deliberately.")
	case "p:upgrade":
		return bad("This Go service is upgraded by replacing its binary and frontend build, then running migrate. The PHP/composer archive upgrader is not applicable.")
	case "p:maintenance:clean-service-backups":
		return bad("Egg configuration is stored transactionally in PostgreSQL. This service has no PHP services/.bak directory to prune.")
	default:
		return bad("Unknown command: " + command + ". Run help to list supported commands.")
	}
}

func (a *App) cliHelp(out io.Writer) error {
	return cliPrint(out, M{"commands": []string{"p:info", "health", "migrate", "db:seed", "p:user:make", "p:user:list", "p:user:update", "p:user:delete", "p:location:make", "p:location:delete", "p:node:make", "p:node:list", "p:node:configuration", "p:server:bulk-power", "p:schedule:process", "p:maintenance:prune-backups", "p:maintenance:prune-activity", "down", "up", "p:environment:setup", "p:environment:database", "p:environment:mail", "p:environment:addons:run-hooks", "p:telemetry", "import-legacy", "export-snapshot"}, "notes": []string{"Commands are noninteractive. Supply required fields as --name=value or --name value.", "Bulk power and account/location deletion preview their selection unless --force is supplied.", "Node configuration intentionally contains the Wings authentication token; store it privately.", "Snapshots require --file and are never printed to standard output.", "Cloudflare authentication is deferred; account commands never set passwords."}})
}

func cliPrint(out io.Writer, v any) error {
	encoder := json.NewEncoder(out)
	encoder.SetIndent("", "  ")
	return encoder.Encode(v)
}

// cliParse supports options before and after positional arguments. Unknown and
// repeated options are rejected rather than silently changing a command.
func cliParse(args, values, booleans []string) (map[string]string, []string, error) {
	kinds := map[string]bool{}
	for _, key := range values {
		kinds[key] = false
	}
	for _, key := range booleans {
		kinds[key] = true
	}
	options := map[string]string{}
	positional := []string{}
	for i := 0; i < len(args); i++ {
		raw := args[i]
		if raw == "--" {
			positional = append(positional, args[i+1:]...)
			break
		}
		if !strings.HasPrefix(raw, "--") {
			positional = append(positional, raw)
			continue
		}
		key, value, hasValue := strings.Cut(strings.TrimPrefix(raw, "--"), "=")
		isBool, known := kinds[key]
		if !known {
			return nil, nil, bad("Unknown option --" + key)
		}
		if _, exists := options[key]; exists {
			return nil, nil, bad("Repeated option --" + key)
		}
		if !hasValue {
			if isBool {
				value = "true"
				if i+1 < len(args) && (args[i+1] == "true" || args[i+1] == "false" || args[i+1] == "0" || args[i+1] == "1") {
					i++
					value = args[i]
				}
			} else {
				if i+1 >= len(args) || strings.HasPrefix(args[i+1], "--") {
					return nil, nil, bad("Option --" + key + " requires a value.")
				}
				i++
				value = args[i]
			}
		}
		if isBool {
			b, e := strconv.ParseBool(value)
			if e != nil {
				return nil, nil, bad("Option --" + key + " must be boolean.")
			}
			value = strconv.FormatBool(b)
		}
		options[key] = value
	}
	return options, positional, nil
}

func cliRequireNoPositionals(p []string) error {
	if len(p) != 0 {
		return bad("Unexpected positional arguments.")
	}
	return nil
}
func cliPositive(value, name string, defaultValue int64) (int64, error) {
	if value == "" {
		return defaultValue, nil
	}
	n, e := strconv.ParseInt(value, 10, 64)
	if e != nil || n < 1 || n > 1000000000 {
		return 0, bad(name + " must be a positive integer at most 1000000000.")
	}
	return n, nil
}
func cliIDs(raw string) ([]int64, error) {
	ids := []int64{}
	if raw == "" {
		return ids, nil
	}
	seen := map[int64]bool{}
	for _, s := range strings.Split(raw, ",") {
		id, e := cliPositive(strings.TrimSpace(s), "IDs", 0)
		if e != nil || id == 0 {
			return nil, bad("Filters must be comma-separated positive IDs.")
		}
		if !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	return ids, nil
}
func cliBoolean(value string, defaultValue bool) (bool, error) {
	if value == "" {
		return defaultValue, nil
	}
	b, e := strconv.ParseBool(value)
	if e != nil {
		return false, bad("Expected a boolean option value.")
	}
	return b, nil
}

func (a *App) cliInfo(ctx context.Context, args []string, out io.Writer, command string) error {
	opts, p, e := cliParse(args, []string{"url"}, []string{"check"})
	if e != nil {
		return e
	}
	if e = cliRequireNoPositionals(p); e != nil {
		return e
	}
	pool := a.DB
	if target := opts["url"]; target != "" {
		candidate, err := pgxpool.New(ctx, target)
		if err != nil {
			return bad("The PostgreSQL connection URL is invalid.")
		}
		defer candidate.Close()
		pool = candidate
	}
	if e = pool.Ping(ctx); e != nil {
		return errors.New("PostgreSQL connection check failed; inspect the private service logs for connection details")
	}
	cfg := pool.Config().ConnConfig
	zone, e := a.timezone(ctx)
	if e != nil {
		return e
	}
	report := M{"application": "Voltra", "runtime": runtime.Version(), "os": runtime.GOOS, "architecture": runtime.GOARCH, "listen": a.Config.Listen, "public_url": cliSafeURL(a.Config.PublicURL), "identity_mode": map[bool]string{true: "local-development", false: "cloudflare-pending"}[a.Config.DevMode], "database": M{"driver": "postgresql", "host": cfg.Host, "port": cfg.Port, "database": cfg.Database, "healthy": true}, "encryption_key_configured": a.Config.EncryptionKey != "", "queue": "PostgreSQL durable scheduler", "sessions": "no local login", "telemetry_transmission": false}
	report["timezone"] = zone.String()
	if command == "p:environment:database" {
		report = M{"database": report["database"], "configuration": "Set DATABASE_URL in the deployment environment and restart; runtime credentials are never printed or rewritten."}
	}
	return cliPrint(out, report)
}
func cliSafeURL(raw string) string {
	u, e := url.Parse(raw)
	if e != nil {
		return "invalid URL"
	}
	u.User = nil
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}

func (a *App) cliUsers(ctx context.Context, command string, args []string, out io.Writer) error {
	values, booleans := []string{"user", "email", "username", "name-first", "name-last", "admin", "disabled", "language", "external-id"}, []string{"no-password"}
	if command == "p:user:list" {
		values = nil
		booleans = nil
	}
	if command == "p:user:delete" {
		values = []string{"user"}
		booleans = []string{"force"}
	}
	opts, p, e := cliParse(args, values, booleans)
	if e != nil {
		return e
	}
	if e = cliRequireNoPositionals(p); e != nil {
		return e
	}
	if command == "p:user:list" {
		users, e := a.query(ctx, "SELECT * FROM users ORDER BY id")
		if e != nil {
			return e
		}
		for i, u := range users {
			users[i] = userAttributes(u)
		}
		return cliPrint(out, collection("user", users))
	}
	if command == "p:user:make" || command == "p:user:create" || command == "p:user:update" {
		data := M{}
		for option, key := range map[string]string{"email": "email", "username": "username", "name-first": "first_name", "name-last": "last_name", "language": "language", "external-id": "external_id"} {
			if value, ok := opts[option]; ok {
				data[key] = value
			}
		}
		for option, key := range map[string]string{"admin": "root_admin", "disabled": "disabled"} {
			if value, ok := opts[option]; ok {
				b, e := cliBoolean(value, false)
				if e != nil {
					return e
				}
				data[key] = b
			}
		}
		create := command != "p:user:update"
		data, e = accountUserData(data, create)
		if e != nil {
			return e
		}
		var u M
		if create {
			u, e = a.insert(ctx, "users", data)
		} else {
			old, e := a.cliFindUser(ctx, opts["user"])
			if e != nil {
				return e
			}
			if boolean(old["root_admin"]) && (data["root_admin"] == false || data["disabled"] == true) {
				var admins int
				if e = a.DB.QueryRow(ctx, "SELECT count(*) FROM users WHERE root_admin AND NOT disabled AND id<>$1", old["id"]).Scan(&admins); e != nil {
					return e
				}
				if admins == 0 {
					return bad("The last enabled administrator cannot be disabled or demoted.")
				}
			}
			u, e = a.update(ctx, "users", num(old["id"]), data)
		}
		if e != nil {
			return e
		}
		return cliPrint(out, item("user", userAttributes(u)))
	}
	user, e := a.cliFindUser(ctx, opts["user"])
	if e != nil {
		return e
	}
	if opts["force"] != "true" {
		return cliPrint(out, M{"dry_run": true, "user": userAttributes(user), "execute_with": "--force"})
	}
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var owned int
	if e = tx.QueryRow(ctx, "SELECT count(*) FROM servers WHERE owner_id=$1", user["id"]).Scan(&owned); e != nil {
		return e
	}
	if owned > 0 {
		return bad("Transfer or delete this user's servers before deleting their account.")
	}
	if boolean(user["root_admin"]) {
		var admins int
		if e = tx.QueryRow(ctx, "SELECT count(*) FROM users WHERE root_admin AND NOT disabled AND id<>$1", user["id"]).Scan(&admins); e != nil {
			return e
		}
		if admins == 0 {
			return bad("The last enabled administrator cannot be deleted.")
		}
	}
	if _, e = tx.Exec(ctx, "DELETE FROM users WHERE id=$1", user["id"]); e != nil {
		return e
	}
	if e = tx.Commit(ctx); e != nil {
		return e
	}
	return cliPrint(out, M{"deleted": user["id"]})
}
func (a *App) cliFindUser(ctx context.Context, value string) (M, error) {
	if value == "" {
		return nil, bad("--user is required and accepts an ID, UUID, username or email.")
	}
	id, _ := strconv.ParseInt(value, 10, 64)
	return a.one(ctx, "SELECT * FROM users WHERE id=$1 OR uuid=$2 OR username=$2 OR email=$2", id, value)
}

func (a *App) cliLocation(ctx context.Context, command string, args []string, out io.Writer) error {
	opts, p, e := cliParse(args, []string{"short", "long"}, []string{"force"})
	if e != nil {
		return e
	}
	if e = cliRequireNoPositionals(p); e != nil {
		return e
	}
	if command == "p:location:make" {
		data, e := a.infraValidate(ctx, "locations", M{"short": opts["short"], "long": opts["long"]}, nil)
		if e != nil {
			return e
		}
		location, e := a.insert(ctx, "locations", data)
		if e != nil {
			return e
		}
		return cliPrint(out, item("location", location))
	}
	if opts["short"] == "" {
		return bad("--short is required.")
	}
	location, e := a.one(ctx, "SELECT * FROM locations WHERE short=$1", opts["short"])
	if e != nil {
		return e
	}
	if opts["force"] != "true" {
		return cliPrint(out, M{"dry_run": true, "location": location, "execute_with": "--force"})
	}
	if e = a.infraDelete(ctx, "locations", num(location["id"])); e != nil {
		return e
	}
	return cliPrint(out, M{"deleted": location["id"]})
}

func (a *App) cliNode(ctx context.Context, command string, args []string, out io.Writer) error {
	keys := []string{"format", "name", "description", "locationId", "fqdn", "public", "scheme", "proxy", "maintenance", "maxMemory", "overallocateMemory", "maxDisk", "overallocateDisk", "uploadSize", "daemonListeningPort", "daemonSFTPPort", "daemonBase"}
	if command != "p:node:make" {
		keys = []string{"format"}
	}
	opts, p, e := cliParse(args, keys, nil)
	if e != nil {
		return e
	}
	if command == "p:node:configuration" {
		if len(p) != 1 {
			return bad("A node ID or UUID is required.")
		}
		id, _ := strconv.ParseInt(p[0], 10, 64)
		node, e := a.one(ctx, "SELECT * FROM nodes WHERE id=$1 OR uuid=$2", id, p[0])
		if e != nil {
			return e
		}
		config, e := a.nodeConfiguration(ctx, node)
		if e != nil {
			return e
		}
		format := opts["format"]
		if format == "json" {
			return cliPrint(out, config)
		}
		if format != "" && format != "yaml" && format != "yml" {
			return bad("--format must be yaml or json.")
		}
		data, e := yaml.Marshal(config)
		if e != nil {
			return e
		}
		_, e = out.Write(data)
		return e
	}
	if e = cliRequireNoPositionals(p); e != nil {
		return e
	}
	if command == "p:node:list" {
		nodes, e := a.query(ctx, "SELECT id,uuid,name,description,location_id,fqdn,scheme,public,memory,disk,maintenance_mode FROM nodes ORDER BY id")
		if e != nil {
			return e
		}
		if format := opts["format"]; format != "" && format != "text" && format != "json" {
			return bad("--format must be text or json.")
		}
		if opts["format"] == "json" {
			return cliPrint(out, nodes)
		}
		for _, n := range nodes {
			if _, e = fmt.Fprintf(out, "%v\t%v\t%s\t%s\n", n["id"], n["location_id"], str(n["name"]), str(n["fqdn"])); e != nil {
				return e
			}
		}
		return nil
	}
	data := M{}
	for option, key := range map[string]string{"name": "name", "description": "description", "fqdn": "fqdn", "scheme": "scheme", "daemonBase": "daemon_base"} {
		if value, ok := opts[option]; ok {
			data[key] = value
		}
	}
	for option, key := range map[string]string{"locationId": "location_id", "maxMemory": "memory", "overallocateMemory": "memory_overallocate", "maxDisk": "disk", "overallocateDisk": "disk_overallocate", "uploadSize": "upload_size", "daemonListeningPort": "daemon_listen", "daemonSFTPPort": "daemon_sftp"} {
		if value, ok := opts[option]; ok {
			n, e := strconv.ParseInt(value, 10, 64)
			if e != nil {
				return bad("--" + option + " must be an integer.")
			}
			data[key] = n
		}
	}
	for option, key := range map[string]string{"public": "public", "proxy": "behind_proxy", "maintenance": "maintenance_mode"} {
		if value, ok := opts[option]; ok {
			b, e := cliBoolean(value, false)
			if e != nil {
				return e
			}
			data[key] = b
		}
	}
	data, e = a.infraValidate(ctx, "nodes", data, nil)
	if e != nil {
		return e
	}
	node, e := a.insert(ctx, "nodes", data)
	if e != nil {
		return e
	}
	return cliPrint(out, item("node", M{"id": node["id"], "uuid": node["uuid"], "name": node["name"], "location_id": node["location_id"], "fqdn": node["fqdn"]}))
}

func (a *App) cliBulkPower(ctx context.Context, args []string, out io.Writer) error {
	opts, p, e := cliParse(args, []string{"servers", "nodes"}, []string{"force", "dry-run"})
	if e != nil {
		return e
	}
	if len(p) != 1 {
		return bad("Provide one action: start, stop, restart or kill.")
	}
	action := p[0]
	if action != "start" && action != "stop" && action != "restart" && action != "kill" {
		return bad("Power action must be start, stop, restart or kill.")
	}
	servers, e := cliIDs(opts["servers"])
	if e != nil {
		return e
	}
	nodes, e := cliIDs(opts["nodes"])
	if e != nil {
		return e
	}
	selected, e := a.query(ctx, "SELECT * FROM servers WHERE status IS NULL AND (cardinality($1::bigint[])=0 AND cardinality($2::bigint[])=0 OR id=ANY($1::bigint[]) OR node_id=ANY($2::bigint[])) ORDER BY id", servers, nodes)
	if e != nil {
		return e
	}
	dryRun := opts["force"] != "true" || opts["dry-run"] == "true"
	results := []M{}
	failures := []error{}
	for _, server := range selected {
		row := M{"id": server["id"], "name": server["name"], "node_id": server["node_id"]}
		if !dryRun {
			if e = ctx.Err(); e != nil {
				return e
			}
			response, err := a.daemonServer(ctx, server, http.MethodPost, "/power", M{"action": action})
			if err != nil {
				row["success"] = false
				row["error"] = err.Error()
				failures = append(failures, fmt.Errorf("server %v power action failed", server["id"]))
			} else {
				response.Body.Close()
				row["success"] = true
				_ = a.audit(ctx, 0, num(server["id"]), "server:power."+action, M{"source": "cli"})
			}
		}
		results = append(results, row)
	}
	if e = cliPrint(out, M{"action": action, "dry_run": dryRun, "selected": len(selected), "servers": results}); e != nil {
		return e
	}
	return errors.Join(failures...)
}

func (a *App) cliPruneBackups(ctx context.Context, args []string, out io.Writer) error {
	opts, p, e := cliParse(args, []string{"prune-age"}, nil)
	if e != nil {
		return e
	}
	if e = cliRequireNoPositionals(p); e != nil {
		return e
	}
	age, e := cliPositive(opts["prune-age"], "--prune-age", 360)
	if e != nil {
		return e
	}
	result, e := a.DB.Exec(ctx, "UPDATE backups SET is_successful=false,completed_at=now(),updated_at=now() WHERE completed_at IS NULL AND created_at<=now()-$1::bigint*interval '1 minute'", age)
	if e != nil {
		return e
	}
	return cliPrint(out, M{"marked_failed": result.RowsAffected(), "age_minutes": age})
}
func (a *App) cliPruneActivity(ctx context.Context, args []string, out io.Writer) error {
	opts, p, e := cliParse(args, []string{"days"}, []string{"force"})
	if e != nil {
		return e
	}
	if e = cliRequireNoPositionals(p); e != nil {
		return e
	}
	days, e := cliPositive(opts["days"], "--days", 90)
	if e != nil {
		return e
	}
	if opts["force"] != "true" {
		count, e := a.one(ctx, "SELECT count(*) AS count FROM activity_logs WHERE created_at<now()-$1::bigint*interval '1 day'", days)
		if e != nil {
			return e
		}
		return cliPrint(out, M{"dry_run": true, "selected": count["count"], "days": days})
	}
	result, e := a.DB.Exec(ctx, "DELETE FROM activity_logs WHERE created_at<now()-$1::bigint*interval '1 day'", days)
	if e != nil {
		return e
	}
	return cliPrint(out, M{"deleted": result.RowsAffected(), "days": days})
}
func (a *App) cliScheduler(ctx context.Context, args []string, out io.Writer) error {
	opts, p, e := cliParse(args, []string{"max"}, nil)
	if e != nil {
		return e
	}
	if e = cliRequireNoPositionals(p); e != nil {
		return e
	}
	limit, e := cliPositive(opts["max"], "--max", 100)
	if e != nil || limit > 10000 {
		return bad("--max must be between 1 and 10000.")
	}
	due, e := a.query(ctx, "SELECT id FROM schedules WHERE is_active AND NOT is_processing AND next_run_at<=now() AND EXISTS(SELECT 1 FROM tasks WHERE schedule_id=schedules.id) ORDER BY next_run_at LIMIT $1", limit)
	if e != nil {
		return e
	}
	queued, processed := 0, 0
	failures := []error{}
	for _, s := range due {
		if e = a.collabQueueSchedule(ctx, num(s["id"]), false); e != nil {
			failures = append(failures, e)
		} else {
			queued++
		}
	}
	for i := int64(0); i < limit; i++ {
		ran, e := a.collabSchedulerStep(ctx)
		if e != nil {
			failures = append(failures, e)
			break
		}
		if !ran {
			break
		}
		processed++
	}
	if e = cliPrint(out, M{"queued": queued, "processed_tasks": processed, "errors": len(failures)}); e != nil {
		return e
	}
	return errors.Join(failures...)
}

func (a *App) cliStoreSettings(ctx context.Context, settings M) error {
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	for key, value := range settings {
		encoded, e := json.Marshal(value)
		if e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, "INSERT INTO settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, string(encoded)); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}

// Reuse the settings handler's validation, encryption, and persistence rather
// than growing a second mail-configuration implementation in the CLI.
func (a *App) cliApplySettings(ctx context.Context, data M, out io.Writer) error {
	admin, e := a.one(ctx, "SELECT id FROM users WHERE root_admin AND NOT disabled ORDER BY id LIMIT 1")
	if e != nil {
		return bad("Create an enabled administrator with p:user:make before updating settings.")
	}
	body, e := json.Marshal(data)
	if e != nil {
		return e
	}
	r, e := http.NewRequestWithContext(ctx, http.MethodPatch, "http://localhost/api/admin/settings", bytes.NewReader(body))
	if e != nil {
		return e
	}
	r = WithUser(r, num(admin["id"]))
	capture := &cliHTTPOutput{header: http.Header{}, code: 200}
	a.infraSettings(capture, r)
	if capture.code >= 400 {
		var response M
		_ = json.Unmarshal(capture.body.Bytes(), &response)
		for _, raw := range asSlice(response["errors"]) {
			if detail := str(asMap(raw)["detail"]); detail != "" {
				return bad(detail)
			}
		}
		return fmt.Errorf("settings update failed with HTTP %d", capture.code)
	}
	_, e = out.Write(capture.body.Bytes())
	return e
}

type cliHTTPOutput struct {
	header http.Header
	code   int
	body   bytes.Buffer
}

func (w *cliHTTPOutput) Header() http.Header            { return w.header }
func (w *cliHTTPOutput) WriteHeader(status int)         { w.code = status }
func (w *cliHTTPOutput) Write(data []byte) (int, error) { return w.body.Write(data) }
func (a *App) cliMail(ctx context.Context, args []string, out io.Writer) error {
	opts, p, e := cliParse(args, []string{"driver", "email", "from", "encryption", "host", "port", "username", "password"}, nil)
	if e != nil {
		return e
	}
	if e = cliRequireNoPositionals(p); e != nil {
		return e
	}
	if driver := opts["driver"]; driver != "" && driver != "smtp" {
		return bad("This service's notification transport is SMTP; provider APIs and sendmail are not configured.")
	}
	if len(opts) == 0 {
		settings, e := a.infraLoadSettings(ctx)
		if e != nil {
			return e
		}
		public := infraPublicSettings(settings)
		for key := range public {
			if !strings.HasPrefix(key, "mail:") {
				delete(public, key)
			}
		}
		return cliPrint(out, public)
	}
	data := M{}
	for option, key := range map[string]string{"host": "mail:host", "email": "mail:from:address", "from": "mail:from:name", "encryption": "mail:encryption", "username": "mail:username", "password": "mail:password"} {
		if value, ok := opts[option]; ok {
			data[key] = value
		}
	}
	if value, ok := opts["port"]; ok {
		port, e := cliPositive(value, "--port", 587)
		if e != nil {
			return e
		}
		data["mail:port"] = port
	}
	if len(data) == 0 {
		return bad("No mail settings were provided.")
	}
	return a.cliApplySettings(ctx, data, out)
}
func (a *App) cliSetup(ctx context.Context, args []string, out io.Writer) error {
	opts, p, e := cliParse(args, []string{"name", "locale", "url", "author", "timezone", "cache", "session", "queue", "redis-host", "redis-pass", "redis-port", "settings-ui", "telemetry"}, []string{"new-salt"})
	if e != nil {
		return e
	}
	if e = cliRequireNoPositionals(p); e != nil {
		return e
	}
	for _, key := range []string{"url", "author", "cache", "session", "queue", "redis-host", "redis-pass", "redis-port", "settings-ui", "telemetry", "new-salt"} {
		if _, ok := opts[key]; ok {
			return bad("--" + key + " belongs to the PHP deployment configuration. This Go service uses PUBLIC_URL, PostgreSQL queues and Cloudflare identity; change the deployment environment where applicable.")
		}
	}
	if len(opts) == 0 {
		settings, e := a.infraLoadSettings(ctx)
		if e != nil {
			return e
		}
		zone, e := a.timezone(ctx)
		if e != nil {
			return e
		}
		return cliPrint(out, M{"name": settings["app:name"], "locale": settings["app:locale"], "public_url": cliSafeURL(a.Config.PublicURL), "timezone": zone.String(), "queue": "postgresql", "configuration": "Use --name, --locale and --timezone to update panel settings; deployment settings come from environment variables."})
	}
	data := M{}
	if value, ok := opts["name"]; ok {
		data["app:name"] = value
	}
	if value, ok := opts["locale"]; ok {
		data["app:locale"] = value
	}
	if value, ok := opts["timezone"]; ok {
		if value == "" {
			return bad("--timezone must name a valid IANA timezone.")
		}
		if _, e := time.LoadLocation(value); e != nil {
			return bad("--timezone must name a valid IANA timezone.")
		}
		data["app:timezone"] = value
	}
	return a.cliApplySettings(ctx, data, out)
}
func (a *App) cliTelemetry(ctx context.Context, args []string, out io.Writer) error {
	if len(args) > 0 {
		return bad("p:telemetry accepts no arguments.")
	}
	counts := M{}
	for _, table := range []string{"users", "nodes", "servers", "nests", "eggs"} {
		row, e := a.one(ctx, "SELECT count(*) AS count FROM "+table)
		if e != nil {
			return e
		}
		counts[table] = row["count"]
	}
	return cliPrint(out, M{"transmitted": false, "counts": counts, "runtime": runtime.Version(), "os": runtime.GOOS, "architecture": runtime.GOARCH})
}

func (a *App) cliSnapshot(ctx context.Context, command string, args []string, out io.Writer) error {
	booleans := []string{}
	if command == "import-legacy" {
		booleans = []string{"dry-run"}
	}
	opts, p, e := cliParse(args, []string{"file"}, booleans)
	if e != nil {
		return e
	}
	if e = cliRequireNoPositionals(p); e != nil {
		return e
	}
	filename := opts["file"]
	if filename == "" || filename == "-" {
		return bad("--file must name a private snapshot file. Standard input/output snapshots are unavailable.")
	}
	if command == "import-legacy" {
		source, e := os.Open(filename)
		if e != nil {
			return fmt.Errorf("open snapshot: %w", e)
		}
		defer source.Close()
		info, e := source.Stat()
		if e != nil {
			return e
		}
		if !info.Mode().IsRegular() {
			return bad("The snapshot source must be a regular file.")
		}
		report, err := a.ImportLegacyWithOptions(ctx, source, LegacyImportOptions{DryRun: opts["dry-run"] == "true"})
		if e = cliPrint(out, report); e != nil {
			return e
		}
		return err
	}
	destination, e := os.OpenFile(filename, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return fmt.Errorf("create private snapshot; choose a new filename: %w", e)
	}
	keep := false
	defer func() {
		destination.Close()
		if !keep {
			os.Remove(filename)
		}
	}()
	if e = cliProtectSnapshot(ctx, destination); e != nil {
		return e
	}
	if e = a.ExportSnapshot(ctx, destination); e != nil {
		return e
	}
	if e = destination.Sync(); e != nil {
		return e
	}
	if e = destination.Close(); e != nil {
		return e
	}
	keep = true
	return cliPrint(out, M{"exported": true, "file": filename, "private": true})
}

func cliProtectSnapshot(ctx context.Context, file *os.File) error {
	if e := file.Chmod(0600); e != nil {
		return e
	}
	if runtime.GOOS != "windows" {
		return nil
	}
	// Windows ignores Unix permission bits. Remove inherited access and grant
	// only the current user's SID before any decrypted credentials are written.
	result, e := exec.CommandContext(ctx, "whoami", "/user", "/fo", "csv", "/nh").Output()
	if e != nil {
		return errors.New("cannot identify the current Windows account for a private snapshot")
	}
	records, e := csv.NewReader(bytes.NewReader(result)).ReadAll()
	if e != nil || len(records) != 1 || len(records[0]) != 2 {
		return errors.New("cannot parse the current Windows account SID")
	}
	sid := strings.TrimSpace(records[0][1])
	if !regexp.MustCompile(`^S-[0-9]+(?:-[0-9]+)+$`).MatchString(sid) {
		return errors.New("invalid Windows account SID")
	}
	if e = exec.CommandContext(ctx, "icacls", file.Name(), "/inheritance:r", "/grant:r", "*"+sid+":(F)").Run(); e != nil {
		return errors.New("cannot restrict snapshot permissions to the current Windows account")
	}
	return nil
}

var cliHookEvent = regexp.MustCompile(`^[a-z0-9-]+$`)

func (a *App) cliHooks(ctx context.Context, args []string, out io.Writer) error {
	opts, p, e := cliParse(args, []string{"directory"}, []string{"enabled"})
	if e != nil {
		return e
	}
	if len(p) != 1 || !cliHookEvent.MatchString(p[0]) {
		return bad("Provide one hook event using lowercase letters, numbers and hyphens.")
	}
	if opts["enabled"] != "true" {
		return cliPrint(out, M{"enabled": false, "executed": 0, "configuration": "Addon hook execution is opt-in. Add --enabled to run executable hooks."})
	}
	directory := opts["directory"]
	if directory == "" {
		directory = "addons"
	}
	root, e := filepath.Abs(directory)
	if e != nil {
		return e
	}
	entries, e := os.ReadDir(root)
	if os.IsNotExist(e) {
		return cliPrint(out, M{"enabled": true, "executed": 0})
	}
	if e != nil {
		return e
	}
	hooks := []string{}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		hook := filepath.Join(root, entry.Name(), "hooks", p[0])
		info, e := os.Lstat(hook)
		if e != nil {
			if os.IsNotExist(e) {
				continue
			}
			return e
		}
		if !info.Mode().IsRegular() || info.Mode()&0111 == 0 {
			continue
		}
		resolved, e := filepath.EvalSymlinks(hook)
		if e != nil {
			return e
		}
		relative, e := filepath.Rel(root, resolved)
		if e != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return bad("Addon hook resolves outside its configured directory.")
		}
		hooks = append(hooks, resolved)
	}
	sort.Strings(hooks)
	failures := []error{}
	for _, hook := range hooks {
		command := exec.CommandContext(ctx, hook)
		command.Dir = filepath.Dir(root)
		command.Stdout = out
		command.Stderr = out
		if e = command.Run(); e != nil {
			failures = append(failures, fmt.Errorf("addon hook %s failed: %w", filepath.Base(filepath.Dir(filepath.Dir(hook))), e))
		}
	}
	if e = cliPrint(out, M{"enabled": true, "executed": len(hooks), "failed": len(failures)}); e != nil {
		return e
	}
	return errors.Join(failures...)
}
