package panel

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestSteamProvisionLocksLeaveQueryPoolAvailable(t *testing.T) {
	a, _, _ := infraTestApp(t)
	cfg := a.DB.Config()
	cfg.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	a.DB = pool
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	first, err := a.acquireSteamProvisionConnection(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Release()
	key := "provision-test:" + newUUID()
	if err = steamSessionLock(ctx, first, key); err != nil {
		t.Fatal(err)
	}
	second, err := a.acquireSteamProvisionConnection(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Release()
	waiting, stop := context.WithTimeout(ctx, 100*time.Millisecond)
	defer stop()
	done := make(chan error, 1)
	go func() { done <- steamSessionLock(waiting, second, key) }()
	if _, err = a.one(ctx, "SELECT 1 AS available"); err != nil {
		t.Fatalf("advisory sessions exhausted the query pool: %v", err)
	}
	if err = <-done; err == nil {
		t.Fatal("contending lock ignored cancellation")
	}
	second.Release()
	steamUnlock(first)
	replacement, err := a.acquireSteamProvisionConnection(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer steamUnlock(replacement)
	if err = steamSessionLock(ctx, replacement, key); err != nil {
		t.Fatalf("released session retained its lock: %v", err)
	}
}
