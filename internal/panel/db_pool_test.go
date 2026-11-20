package panel

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestApplyPoolLimits(t *testing.T) {
	parse := func(url string) *pgxpool.Config {
		t.Helper()
		cfg, err := pgxpool.ParseConfig(url)
		if err != nil {
			t.Fatal(err)
		}
		return cfg
	}
	base := "postgres://user@127.0.0.1:5432/db"
	cfg := parse(base)
	if err := applyPoolLimits(cfg, base, Config{}); err != nil {
		t.Fatal(err)
	}
	if cfg.MaxConns != defaultDatabaseMaxConns || cfg.MinIdleConns != defaultDatabaseMinIdleConns || cfg.MaxConnLifetime != time.Hour || cfg.MaxConnIdleTime != 10*time.Minute || cfg.MaxConnLifetimeJitter != 5*time.Minute {
		t.Fatalf("defaults %+v", cfg)
	}
	withURL := base + "?pool_max_conns=7&pool_min_idle_conns=1&pool_max_conn_lifetime=20m&pool_max_conn_idle_time=2m"
	cfg = parse(withURL)
	if err := applyPoolLimits(cfg, withURL, Config{}); err != nil {
		t.Fatal(err)
	}
	if cfg.MaxConns != 7 || cfg.MinIdleConns != 1 || cfg.MaxConnLifetime != 20*time.Minute || cfg.MaxConnIdleTime != 2*time.Minute {
		t.Fatalf("DATABASE_URL limits were replaced: %+v", cfg)
	}
	cfg = parse(withURL)
	if err := applyPoolLimits(cfg, withURL, Config{DatabaseMaxConns: 40, DatabaseMinIdleConns: 4, DatabaseMaxConnLifetime: 2 * time.Hour, DatabaseMaxConnIdleTime: time.Minute}); err != nil {
		t.Fatal(err)
	}
	if cfg.MaxConns != 40 || cfg.MinIdleConns != 4 || cfg.MaxConnLifetime != 2*time.Hour || cfg.MaxConnIdleTime != time.Minute {
		t.Fatalf("configured limits not applied: %+v", cfg)
	}
	cfg = parse(base)
	if err := applyPoolLimits(cfg, base, Config{DatabaseMaxConns: 1, DatabaseMinIdleConns: 5}); err != nil || cfg.MinIdleConns != 1 {
		t.Fatalf("idle floor must not exceed the maximum: %+v %v", cfg, err)
	}
	minimum := base + "?pool_min_conns=9"
	cfg = parse(minimum)
	if err := applyPoolLimits(cfg, minimum, Config{DatabaseMaxConns: 2}); err == nil {
		t.Fatal("minimum above maximum accepted")
	}
}
