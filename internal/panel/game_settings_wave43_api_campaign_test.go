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
func TestWave43FixtureCleanup(t *testing.T) {
	cfg, e := pgxpool.ParseConfig(os.Getenv("TEST_DATABASE_URL"))
	if e != nil || cfg.ConnConfig.Host != "127.0.0.1" || cfg.ConnConfig.Port != 55439 {
		t.Fatal("isolated database required")
	}
	pool, e := pgxpool.NewWithConfig(context.Background(), cfg)
	if e != nil {
		t.Fatal("database unavailable")
	}
	defer pool.Close()
	data, e := os.ReadFile("../../artifacts/game-parity-20261029/wave43-three-settings-integration/api-tests.log")
	if e != nil {
		t.Fatal(e)
	}
	for _, log := range []string{"regression-tests.log", "final-tests.log", "tuple-tests.log", "tuple-final-tests.log"} {
		other, e := os.ReadFile("../../artifacts/game-parity-20261029/wave43-three-settings-integration/" + log)
		if e != nil {
			t.Fatal(e)
		}
		data = append(data, other...)
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
