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
func TestWave32FixtureCleanup(t *testing.T) {
	cfg, err := pgxpool.ParseConfig(os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal("invalid test database")
	}
	if cfg.ConnConfig.Port != 55439 || cfg.ConnConfig.Host != "127.0.0.1" {
		t.Fatal("expected isolated local55439")
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal("database unavailable")
	}
	defer pool.Close()
	logs, err := os.ReadDir("../../artifacts/game-parity-20261029/wave32-settings-integration")
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, entry := range logs {
		if !strings.HasSuffix(entry.Name(), ".log") {
			continue
		}
		data, err := os.ReadFile("../../artifacts/game-parity-20261029/wave32-settings-integration/" + entry.Name())
		if err != nil {
			t.Fatal(err)
		}
		for _, name := range regexp.MustCompile(`infra_[a-f0-9]{32}`).FindAllString(strings.ReplaceAll(string(data), "\x00", ""), -1) {
			var exists bool
			if err := pool.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name=$1)", name).Scan(&exists); err != nil {
				t.Fatal("cleanup query failed")
			}
			if exists {
				t.Fatalf("fixture schema remains: %s", name)
			}
			count++
		}
	}
	t.Logf("verified %d recorded schema references absent", count)
}
