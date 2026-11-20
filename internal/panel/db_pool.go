package panel

import (
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Pool limits used when neither the configuration nor DATABASE_URL sets one.
// pgx alone would allow max(4, CPUs) connections, which a small host reaches
// with a few concurrent page loads, and keeps no idle connection warm.
const (
	defaultDatabaseMaxConns        = 16
	defaultDatabaseMinIdleConns    = 2
	defaultDatabaseMaxConnLifetime = time.Hour
	defaultDatabaseMaxConnIdleTime = 10 * time.Minute
	databaseMaxConnLifetimeJitter  = 5 * time.Minute
)

// applyPoolLimits sets explicit pool limits. A value in Config wins (the
// DATABASE_* environment variables); otherwise a pool_* parameter in
// DATABASE_URL is kept; otherwise the default above applies.
func applyPoolLimits(pool *pgxpool.Config, databaseURL string, cfg Config) error {
	inURL := func(key string) bool { return strings.Contains(databaseURL, key+"=") }
	switch {
	case cfg.DatabaseMaxConns > 0:
		pool.MaxConns = int32(cfg.DatabaseMaxConns)
	case !inURL("pool_max_conns"):
		pool.MaxConns = defaultDatabaseMaxConns
	}
	switch {
	case cfg.DatabaseMinIdleConns > 0:
		pool.MinIdleConns = int32(cfg.DatabaseMinIdleConns)
	case !inURL("pool_min_idle_conns"):
		pool.MinIdleConns = defaultDatabaseMinIdleConns
	}
	switch {
	case cfg.DatabaseMaxConnLifetime > 0:
		pool.MaxConnLifetime = cfg.DatabaseMaxConnLifetime
	case !inURL("pool_max_conn_lifetime"):
		pool.MaxConnLifetime = defaultDatabaseMaxConnLifetime
	}
	if !inURL("pool_max_conn_lifetime_jitter") {
		// Spread reconnects so the whole pool does not expire at once.
		pool.MaxConnLifetimeJitter = min(databaseMaxConnLifetimeJitter, pool.MaxConnLifetime/4)
	}
	switch {
	case cfg.DatabaseMaxConnIdleTime > 0:
		pool.MaxConnIdleTime = cfg.DatabaseMaxConnIdleTime
	case !inURL("pool_max_conn_idle_time"):
		pool.MaxConnIdleTime = defaultDatabaseMaxConnIdleTime
	}
	if pool.MinIdleConns > pool.MaxConns {
		pool.MinIdleConns = pool.MaxConns
	}
	if pool.MinConns > pool.MaxConns {
		return fmt.Errorf("database pool: minimum connections exceed maximum connections")
	}
	return nil
}
