package panel

import (
	"context"
	"encoding/json"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

// Hints contain domains and, where the change belongs to one server, that
// server's ID. Never row values, credentials, queries or payloads. Each socket
// turns server IDs into the identifiers its user may see, or drops the hint.
// HTTP readers retain their own authorization and response contracts.
type liveReadChanges struct {
	mu      sync.Mutex
	clients map[chan struct{}]map[string]*liveChangeScope
	cancel  context.CancelFunc
	done    chan struct{}
}

// A domain changed for every server (global) or for the listed servers only.
type liveChangeScope struct {
	global  bool
	servers map[int64]bool
}

type liveReadChange struct {
	domain  string
	global  bool
	servers []int64
}

// Pending changes per socket are bounded: past this many servers a domain
// counts as changed everywhere.
const liveChangeServerLimit = 64

func (h *liveReadChanges) subscribe() (<-chan struct{}, func() []liveReadChange, func()) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients == nil {
		h.clients = map[chan struct{}]map[string]*liveChangeScope{}
	}
	ch := make(chan struct{}, 1)
	h.clients[ch] = map[string]*liveChangeScope{}
	take := func() []liveReadChange {
		h.mu.Lock()
		defer h.mu.Unlock()
		var changes []liveReadChange
		for domain, scope := range h.clients[ch] {
			change := liveReadChange{domain: domain, global: scope.global}
			if !scope.global {
				for id := range scope.servers {
					change.servers = append(change.servers, id)
				}
			}
			changes = append(changes, change)
		}
		if _, exists := h.clients[ch]; exists {
			h.clients[ch] = map[string]*liveChangeScope{}
		}
		return changes
	}
	stop := func() { h.mu.Lock(); delete(h.clients, ch); h.mu.Unlock() }
	return ch, take, stop
}

func (h *liveReadChanges) publish(domains ...string) { h.publishScoped(nil, domains...) }

// No servers means the change concerns every server.
func (h *liveReadChanges) publishScoped(servers []int64, domains ...string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch, pending := range h.clients {
		for _, domain := range domains {
			scope := pending[domain]
			if scope == nil {
				scope = &liveChangeScope{servers: map[int64]bool{}}
				pending[domain] = scope
			}
			if len(servers) == 0 {
				scope.global = true
			}
			for _, id := range servers {
				if id > 0 && !scope.global {
					scope.servers[id] = true
				}
			}
			if len(scope.servers) > liveChangeServerLimit {
				scope.global = true
			}
			if scope.global {
				scope.servers = map[int64]bool{}
			}
		}
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func liveTableDomains(table string) []string {
	switch table {
	case "backups":
		return []string{"backups"}
	case "schedules", "tasks", "schedule_runs":
		return []string{"schedules"}
	case "steam_jobs", "steam_job_events", "steam_servers", "steam_private_jobs", "steam_private_authorizations", "steam_private_attempts", "steam_private_publications", "steam_game_provisions":
		return []string{"steam"}
	case "activity_logs":
		return []string{"activity"}
	case "user_server_navigation":
		return []string{"navigation"}
	case "allocations", "proxy_routes", "proxy_node_clients", "proxy_gateways":
		return []string{"network", "servers"}
	case "databases", "database_hosts":
		return []string{"databases"}
	case "eggs", "egg_variables", "nests":
		return []string{"catalog", "servers"}
	case "nodes", "locations", "node_requests", "node_enrollments", "node_connectors":
		return []string{"nodes", "servers"}
	case "servers", "server_variables", "server_transfers", "mounts", "mount_nodes", "mount_eggs", "mount_servers":
		return []string{"servers", "files"}
	case "users", "subusers", "browser_sessions", "desktop_devices", "api_keys", "ssh_keys", "daemon_revocations":
		return []string{"access"}
	case "settings", "integrations", "server_integration_secrets":
		return []string{"settings", "catalog", "servers"}
	}
	return nil
}

func liveTopicDomain(event string) string {
	switch event {
	case "backups.updated":
		return "backups"
	case "schedules.updated":
		return "schedules"
	case "activity.updated":
		return "activity"
	case "jobs.updated":
		return "steam"
	case "files.updated":
		return "files"
	case "users.updated":
		return "access"
	default:
		return "servers"
	}
}

// Covers daemon-side writes as well as database-backed mutations. Unknown
// mutation families deliberately invalidate all readers rather than go stale.
func liveMutationDomains(path string) []string {
	if strings.Contains(path, "/files/transfers") && !strings.HasSuffix(path, "/complete") {
		return nil
	}
	for _, entry := range []struct{ part, domain string }{
		{"/files/", "files"}, {"/backups", "backups"}, {"/schedules", "schedules"},
		{"/steam", "steam"}, {"/databases", "databases"}, {"/navigation", "navigation"},
		{"/allocations", "network"}, {"/network", "network"}, {"/proxy", "network"},
		{"/users", "access"}, {"/account", "access"}, {"/nodes", "nodes"},
		{"/eggs", "catalog"}, {"/nests", "catalog"}, {"/game-library", "catalog"},
	} {
		if strings.Contains(path, entry.part) {
			return []string{entry.domain, "activity"}
		}
	}
	if strings.Contains(path, "/servers/") {
		return []string{"servers", "activity"}
	}
	return []string{"all"}
}

func (h *liveSnapshotHub) invalidateDomains(domains ...string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, w := range h.workers {
		for _, domain := range domains {
			if domain == "all" || domain == "access" || domain == liveTopicDomain(w.topic.event) || domain == "servers" {
				w.last = nil
				w.generation++
				select {
				case w.wake <- struct{}{}:
				default:
				}
				break
			}
		}
	}
}

func (a *App) publishReadChanges(domains ...string) { a.publishServerReadChanges(nil, domains...) }

// Scoped to the given servers; none means every server.
func (a *App) publishServerReadChanges(servers []int64, domains ...string) {
	if len(domains) == 0 {
		return
	}
	a.readChanges.publishScoped(servers, domains...)
	a.liveSnapshots.invalidateDomains(domains...)
}

// The server a mutation path names, or 0 when it names none or is unknown.
func (a *App) liveMutationServer(ctx context.Context, path string) int64 {
	if a.DB == nil {
		return 0
	}
	for _, prefix := range []string{"/api/application/servers/", "/api/admin/servers/"} {
		if rest, ok := strings.CutPrefix(path, prefix); ok {
			id, _ := strconv.ParseInt(strings.SplitN(rest, "/", 2)[0], 10, 64)
			return id
		}
	}
	rest, ok := strings.CutPrefix(path, "/api/client/servers/")
	if !ok {
		return 0
	}
	identifier := strings.SplitN(rest, "/", 2)[0]
	if identifier == "" {
		return 0
	}
	numeric, _ := strconv.ParseInt(identifier, 10, 64)
	lookupCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	var id int64
	if a.DB.QueryRow(lookupCtx, "SELECT id FROM servers WHERE uuid=$1 OR uuid_short=$1 OR identifier=$1 OR id=$2 LIMIT 1", identifier, numeric).Scan(&id) != nil {
		return 0
	}
	return id
}

// Filesystem mutations have no database row trigger. Fan out their completion
// to other panel processes too; the directory reconciliation timer survives a
// notification failure without changing the result of the user's operation.
func (a *App) publishMutationReadChanges(ctx context.Context, path string) {
	domains := liveMutationDomains(path)
	if len(domains) == 0 {
		return
	}
	var servers []int64
	if server := a.liveMutationServer(ctx, path); server > 0 && !slices.Contains(domains, "all") {
		servers = []int64{server}
	}
	a.publishServerReadChanges(servers, domains...)
	if !slices.Contains(domains, "files") || a.DB == nil {
		return
	}
	notifyCtx, cancel := context.WithTimeout(ctx, time.Second)
	_, err := a.DB.Exec(notifyCtx, "SELECT pg_notify('voltra_read_changes', json_build_object('schema',current_schema(),'domain','files','server',NULLIF($1::bigint,0)::text)::text)", firstServer(servers))
	cancel()
	if err != nil {
		slog.Warn("file change notification unavailable; directory reconciliation remains active")
	}
}

func firstServer(servers []int64) int64 {
	if len(servers) == 0 {
		return 0
	}
	return servers[0]
}

func (h *liveSnapshotHub) refreshBinding(b *liveBinding) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if w := b.worker; w != nil {
		w.last = nil
		w.generation++
		select {
		case w.wake <- struct{}{}:
		default:
		}
	}
}

func (h *liveSnapshotHub) deliveryCurrent(d liveDelivery) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return d.binding.worker != nil && d.generation == d.binding.worker.generation
}

// LISTEN uses a dedicated connection, not one permanently borrowed from the
// request pool. PostgreSQL delivers NOTIFY only after commit, including writes
// by schedulers, callbacks, CLI tools and other panel processes.
func (a *App) startLiveChanges() {
	ctx, cancel := context.WithCancel(context.Background())
	a.readChanges.cancel = cancel
	a.readChanges.done = make(chan struct{})
	go func() {
		defer close(a.readChanges.done)
		for ctx.Err() == nil {
			connectCtx, stop := context.WithTimeout(ctx, 5*time.Second)
			conn, err := pgx.ConnectConfig(connectCtx, a.DB.Config().ConnConfig.Copy())
			stop()
			if err == nil {
				var schemaName string
				setupCtx, finish := context.WithTimeout(ctx, 5*time.Second)
				err = conn.QueryRow(setupCtx, "SELECT current_schema()").Scan(&schemaName)
				if err == nil {
					_, err = conn.Exec(setupCtx, "LISTEN voltra_read_changes")
				}
				finish()
				if err == nil {
					// Notifications are not durable. A new listener invalidates every
					// active reader to recover anything lost during disconnection.
					a.settings.setListening(true)
					a.publishReadChanges("all")
					for ctx.Err() == nil {
						n, e := conn.WaitForNotification(ctx)
						if e != nil {
							err = e
							break
						}
						var hint struct {
							Schema    string `json:"schema"`
							Table     string `json:"table"`
							Domain    string `json:"domain"`
							Server    string `json:"server"`
							OldServer string `json:"old_server"`
						}
						parsed := json.Unmarshal([]byte(n.Payload), &hint) == nil
						if !parsed || hint.Schema == schemaName && hint.Table == "settings" {
							a.settings.invalidate()
						}
						if parsed && hint.Schema == schemaName {
							var servers []int64
							for _, raw := range []string{hint.Server, hint.OldServer} {
								if id, e := strconv.ParseInt(raw, 10, 64); e == nil && id > 0 {
									servers = append(servers, id)
								}
							}
							if hint.Domain == "files" {
								a.publishServerReadChanges(servers, "files")
							}
							if domains := liveTableDomains(hint.Table); len(domains) > 0 {
								a.publishServerReadChanges(servers, domains...)
							}
						}
					}
				}
				// Without a listener, changes would go unnoticed: stop caching.
				a.settings.setListening(false)
				closeCtx, finishClose := context.WithTimeout(context.Background(), time.Second)
				_ = conn.Close(closeCtx)
				finishClose()
			}
			if ctx.Err() != nil {
				return
			}
			slog.Warn("live change listener disconnected; reconciliation remains active")
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
			}
		}
	}()
}

func (a *App) stopLiveChanges() {
	if a.readChanges.cancel != nil {
		a.readChanges.cancel()
		<-a.readChanges.done
	}
}
