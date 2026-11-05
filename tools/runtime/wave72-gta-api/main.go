// Runs source tests with a private outer schema. Never starts the panel or games.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
"regexp"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func run() int {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "expected output directory")
		return 2
	}
	directory := os.Args[1]
	data, err := os.ReadFile(".local/game-parity-20261029/runtime/panel-private-env.json")
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot read private test environment")
		return 2
	}
	var private map[string]string
	if json.Unmarshal(data, &private) != nil || private["DATABASE_URL"] == "" {
		fmt.Fprintln(os.Stderr, "test database URL unavailable")
		return 2
	}
	dsn, err := url.Parse(private["DATABASE_URL"])
	if err != nil || dsn.Hostname() != "127.0.0.1" || dsn.Port() != "55439" {
		fmt.Fprintln(os.Stderr, "expected isolated loopback PostgreSQL port 55439")
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn.String())
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot open isolated test database")
		return 2
	}
	defer pool.Close()
	schema := fmt.Sprintf("wave72_gta_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err = pool.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		fmt.Fprintln(os.Stderr, "cannot create private outer test schema")
		return 2
	}
	cleanupOK := false
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cleanupCancel()
		_, cleanupErr := pool.Exec(cleanupCtx, "DROP SCHEMA "+quoted+" CASCADE")
		cleanupOK = cleanupErr == nil
		b, _ := json.Marshal(map[string]any{"schema": schema, "cleanup": cleanupOK, "scope": "owned outer fixture schema only"})
		_ = os.WriteFile(filepath.Join(directory, "schema-cleanup.json"), append(b, '\n'), 0600)
	}()
	query := dsn.Query()
	query.Set("search_path", schema)
	dsn.RawQuery = query.Encode()
	log, err := os.Create(filepath.Join(directory, "go-test.jsonl"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot create source test log")
		return 2
	}
	defer log.Close()
	command := exec.CommandContext(ctx, "go", "test", "-json", "./internal/panel", "-run", "TestGTAC|TestRagecoop|TestWave57SettingsPublicationAPI/gta/ragecoop|TestWave59SettingsPublicationAPI/gta/gtac", "-count=1", "-timeout=3m", "-v")
	command.Env = append(os.Environ(), "TEST_DATABASE_URL="+dsn.String())
	command.Stdout, command.Stderr = log, log
	exit := 0
	if err = command.Run(); err != nil {
		exit = 1
	}
	content, _ := os.ReadFile(filepath.Join(directory, "go-test.jsonl"))
for _, name := range regexp.MustCompile(`infra_[a-f0-9]{32}`).FindAllString(string(content), -1) { var exists bool; if e := pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1)", name).Scan(&exists); e != nil || exists { exit=1; fmt.Fprintln(os.Stderr,"fixture schema cleanup failed") } }; fmt.Fprintln(os.Stdout,"All current infra schema references absent after test cleanup.")
result, _ := json.Marshal(map[string]any{"exit_code": exit, "outer_schema": schema, "database": "127.0.0.1:55439", "command": "go test -json ./internal/panel -run TestGTAC|TestRagecoop|TestWave57SettingsPublicationAPI/gta/ragecoop|TestWave59SettingsPublicationAPI/gta/gtac -count=1 -timeout=3m -v", "native_game": false})
	_ = os.WriteFile(filepath.Join(directory, "command.json"), append(result, '\n'), 0600)
	fmt.Printf("Source regression finished, exit %d.\n", exit)
	return exit
}

func main() { os.Exit(run()) }
