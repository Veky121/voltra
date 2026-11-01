package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
)

type requestReadKey struct {
	app       *App
	sql, args string
}
type requestReadScope struct {
	mu   sync.Mutex
	rows map[requestReadKey][]M
}
type requestReadContextKey struct{}

const clientVariablesSQL = "SELECT ev.*,sv.id IS NOT NULL AS is_overridden,COALESCE(sv.variable_value,ev.default_value) server_value FROM egg_variables ev LEFT JOIN server_variables sv ON sv.variable_id=ev.id AND sv.server_id=$1 WHERE ev.egg_id=$2 ORDER BY ev.id"

// Only ordinary finite GET requests reuse reads. Upgraded sockets must always
// re-read authorization, and mutation handlers never inherit a read snapshot.
func withRequestReads(r *http.Request) *http.Request {
	if r.Method != http.MethodGet || strings.EqualFold(r.Header.Get("Upgrade"), "websocket") || r.URL.Path == "/api/client/events" {
		return r
	}
	return r.WithContext(context.WithValue(r.Context(), requestReadContextKey{}, &requestReadScope{rows: make(map[requestReadKey][]M)}))
}

func reusableRequestRead(sql string) bool {
	switch sql {
	case "SELECT * FROM users WHERE id=$1", "SELECT permissions FROM subusers WHERE user_id=$1 AND server_id=$2",
		"SELECT * FROM nodes WHERE id=$1", "SELECT * FROM eggs WHERE id=$1",
		"SELECT value FROM settings WHERE key='network.sftp_public_addresses'",
		"SELECT * FROM allocations WHERE server_id=$1 ORDER BY id", clientVariablesSQL,
		"SELECT id FROM server_transfers WHERE server_id=$1 AND successful IS NULL":
		return true
	}
	return false
}

// Callers mutate egg, node, and variable maps while shaping responses. Keep a
// private copy so masking, unsealing, or overrides never affect another server.
func cloneReadValue(value any) any {
	switch v := value.(type) {
	case M:
		out := M{}
		for k, x := range v {
			out[k] = cloneReadValue(x)
		}
		return out
	case []M:
		out := make([]M, len(v))
		for i, x := range v {
			out[i] = cloneReadValue(x).(M)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, x := range v {
			out[i] = cloneReadValue(x)
		}
		return out
	case []byte:
		return append([]byte(nil), v...)
	case []string:
		return append([]string(nil), v...)
	default:
		return value
	}
}
func readKey(a *App, sql string, args []any) (requestReadKey, bool) {
	encoded, err := json.Marshal(args)
	return requestReadKey{a, sql, string(encoded)}, err == nil
}
func (a *App) seedRequestRead(ctx context.Context, sql string, args []any, rows []M) {
	scope, _ := ctx.Value(requestReadContextKey{}).(*requestReadScope)
	if scope == nil {
		return
	}
	key, ok := readKey(a, sql, args)
	if !ok {
		return
	}
	scope.mu.Lock()
	defer scope.mu.Unlock()
	if len(scope.rows) < 1024 {
		scope.rows[key] = cloneReadValue(rows).([]M)
	}
}
func (a *App) query(ctx context.Context, sql string, args ...any) ([]M, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	scope, _ := ctx.Value(requestReadContextKey{}).(*requestReadScope)
	if scope == nil || !reusableRequestRead(sql) {
		return a.queryUncached(ctx, sql, args...)
	}
	key, ok := readKey(a, sql, args)
	if !ok {
		return a.queryUncached(ctx, sql, args...)
	}
	scope.mu.Lock()
	cached, found := scope.rows[key]
	scope.mu.Unlock()
	if found {
		return cloneReadValue(cached).([]M), nil
	}
	rows, err := a.queryUncached(ctx, sql, args...)
	if err == nil {
		a.seedRequestRead(ctx, sql, args, rows)
	}
	return rows, err
}

// Populate three per-server reads in bounded chunks. Existing clientServer
// shaping, permissions, masking and inherited configuration remain authoritative.
func (a *App) preloadClientList(ctx context.Context, servers []M) error {
	ids := make([]int64, 0, len(servers))
	for _, s := range servers {
		ids = append(ids, num(s["id"]))
	}
	allocs, err := a.queryUncached(ctx, "SELECT * FROM allocations WHERE server_id=ANY($1) ORDER BY id", ids)
	if err != nil {
		return err
	}
	variables, err := a.queryUncached(ctx, `SELECT s.id AS __scope_server,ev.*,sv.id IS NOT NULL AS is_overridden,COALESCE(sv.variable_value,ev.default_value) server_value FROM servers s JOIN egg_variables ev ON ev.egg_id=s.egg_id LEFT JOIN server_variables sv ON sv.variable_id=ev.id AND sv.server_id=s.id WHERE s.id=ANY($1) ORDER BY ev.id`, ids)
	if err != nil {
		return err
	}
	transfers, err := a.queryUncached(ctx, "SELECT server_id,id FROM server_transfers WHERE server_id=ANY($1) AND successful IS NULL", ids)
	if err != nil {
		return err
	}
	allocationRows, variableRows, transferRows := map[int64][]M{}, map[int64][]M{}, map[int64][]M{}
	for _, row := range allocs {
		id := num(row["server_id"])
		allocationRows[id] = append(allocationRows[id], row)
	}
	for _, row := range variables {
		id := num(row["__scope_server"])
		delete(row, "__scope_server")
		variableRows[id] = append(variableRows[id], row)
	}
	for _, row := range transfers {
		id := num(row["server_id"])
		transferRows[id] = append(transferRows[id], M{"id": row["id"]})
	}
	for _, s := range servers {
		id := num(s["id"])
		a.seedRequestRead(ctx, "SELECT * FROM allocations WHERE server_id=$1 ORDER BY id", []any{id}, allocationRows[id])
		a.seedRequestRead(ctx, clientVariablesSQL, []any{id, s["egg_id"]}, variableRows[id])
		a.seedRequestRead(ctx, "SELECT id FROM server_transfers WHERE server_id=$1 AND successful IS NULL", []any{id}, transferRows[id])
	}
	return nil
}
