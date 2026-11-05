package panel

import (
	"context"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Install locks outlive individual queries and may wait for another install.
// Keep them outside the query pool, otherwise waiting retries can exhaust the
// pool and prevent the lock holder from completing. Bound detached sessions
// separately; nested template-egg locks must fail rather than wait for capacity.
var steamProvisionSessions = make(chan struct{}, 32)

type steamProvisionConnection struct {
	connection *pgx.Conn
	once       sync.Once
}

func (a *App) acquireSteamProvisionConnection(ctx context.Context) (*steamProvisionConnection, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	select {
	case steamProvisionSessions <- struct{}{}:
	default:
		return nil, APIError{503, "GameProvisionBusy", "Server creation is busy. Retry this request shortly."}
	}
	borrowed, err := a.DB.Acquire(ctx)
	if err != nil {
		<-steamProvisionSessions
		return nil, err
	}
	// Hijack retains the pool's authentication and connection initialization,
	// while allowing normal queries to replace this connection immediately.
	return &steamProvisionConnection{connection: borrowed.Hijack()}, nil
}
func (c *steamProvisionConnection) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return c.connection.Exec(ctx, sql, args...)
}
func (c *steamProvisionConnection) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return c.connection.QueryRow(ctx, sql, args...)
}
func (c *steamProvisionConnection) Conn() *pgx.Conn { return c.connection }
func (c *steamProvisionConnection) Release() {
	c.once.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = c.connection.Close(ctx)
		<-steamProvisionSessions
	})
}
