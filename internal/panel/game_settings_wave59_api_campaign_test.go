//go:build campaign_audit

package panel

import (
	"context"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Historical campaign receipts require the original private capture and database.
func TestWave59FixtureCleanup(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("TEST_DATABASE_URL is required for isolated PostgreSQL protocol tests")
	}
	cfg, e := pgxpool.ParseConfig(os.Getenv("TEST_DATABASE_URL"))
	if e != nil || cfg.ConnConfig.Host != "127.0.0.1" || cfg.ConnConfig.Port != 55439 {
		t.Fatal("isolated database required")
	}
	pool, e := pgxpool.NewWithConfig(context.Background(), cfg)
	if e != nil {
		t.Fatal("database unavailable")
	}
	defer pool.Close()
	data, e := os.ReadFile("../../artifacts/game-parity-20261029/wave59-four-settings-integration/api-tests.log")
	if e != nil {
		t.Fatal(e)
	}
	entries, _ := os.ReadDir("../../artifacts/game-parity-20261029/wave59-four-settings-integration")
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".log") {
			other, e := os.ReadFile("../../artifacts/game-parity-20261029/wave59-four-settings-integration/" + entry.Name())
			if e != nil {
				t.Fatal(e)
			}
			data = append(data, other...)
		}
	}

	names := regexp.MustCompile(`infra_[a-f0-9]{32}`).FindAllString(strings.ReplaceAll(string(data), "\x00", ""), -1)
	if len(names) == 0 {
		t.Fatal("no recorded schemas")
	}
	for _, name := range names {
		var exists bool
		if e := pool.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name=$1)", name).Scan(&exists); e != nil || exists {
			t.Fatal("schema cleanup failed")
		}
	}
	t.Logf("verified %d recorded schema references absent", len(names))
}
