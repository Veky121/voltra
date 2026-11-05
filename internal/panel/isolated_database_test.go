package panel

import (
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Campaign-era tests inventory database schemas. Use a dedicated test database,
// rather than assuming that one particular TCP port makes a database disposable.
func isolatedTestDatabaseURL(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is required for isolated PostgreSQL integration")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid TEST_DATABASE_URL")
	}
	host, database := cfg.ConnConfig.Host, cfg.ConnConfig.Database
	if (host != "127.0.0.1" && host != "localhost" && host != "::1") ||
		(database != "voltra_test" && !strings.HasPrefix(database, "voltra_test_")) {
		t.Fatal("schema-inventory tests require a loopback database named voltra_test or voltra_test_<suffix>")
	}
	return dsn
}
