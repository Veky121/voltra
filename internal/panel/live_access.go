package panel

import (
	"context"
	"strconv"
	"time"
)

// liveAuthTTL bounds how long a live socket trusts its last identity and
// authorization check when no change signal arrives (for example a session
// that simply expires). Any access, settings or "all" change re-checks at once.
var liveAuthTTL = 5 * time.Second

// Per-socket cache of who is connected and which servers they may see. It is
// owned by the socket's event loop and is not safe for concurrent use.
type liveSocketAccess struct {
	user    int64
	now     func() time.Time
	check   func() (int64, error)
	lookup  func(ctx context.Context, user int64, ids []int64) (map[int64]liveServerAccess, error)
	checked time.Time
	dirty   bool
	// Incremented on every access change; bindings re-authorize when it moves.
	epoch   uint64
	servers map[int64]*liveServerAccess
}

type liveServerAccess struct {
	allowed bool
	aliases []string
	at      time.Time
	// Allowed before the latest access change: it still hears about that change.
	was bool
}

const liveServerCacheLimit = 1024

func newLiveSocketAccess(user int64, check func() (int64, error), lookup func(context.Context, int64, []int64) (map[int64]liveServerAccess, error)) *liveSocketAccess {
	return &liveSocketAccess{user: user, now: time.Now, check: check, lookup: lookup, checked: time.Now(), servers: map[int64]*liveServerAccess{}}
}

// Re-checks the identity when a change was signalled or the last check is
// older than liveAuthTTL. False means the socket must close.
func (s *liveSocketAccess) verify() bool {
	if !s.dirty && s.now().Sub(s.checked) < liveAuthTTL {
		return true
	}
	id, err := s.check()
	if err != nil || id != s.user {
		return false
	}
	s.checked, s.dirty = s.now(), false
	return true
}

// Sessions, membership, permissions or settings may have changed.
func (s *liveSocketAccess) changed() {
	s.dirty = true
	s.epoch++
	for _, server := range s.servers {
		if server.allowed {
			server.was = true
		}
		server.at = time.Time{}
	}
}

// The identifiers of the servers this user may see among ids, and whether
// any hint should be sent at all. A server that no longer exists still counts,
// without identifiers, so lists that showed it refresh.
func (s *liveSocketAccess) visible(ctx context.Context, ids []int64) ([]string, bool, error) {
	var stale []int64
	for _, id := range ids {
		if server := s.servers[id]; server == nil || s.now().Sub(server.at) >= liveAuthTTL {
			stale = append(stale, id)
		}
	}
	if len(stale) > 0 {
		found, err := s.lookup(ctx, s.user, stale)
		if err != nil {
			return nil, false, err
		}
		if len(s.servers)+len(stale) > liveServerCacheLimit {
			s.servers = map[int64]*liveServerAccess{}
		}
		for _, id := range stale {
			previous := s.servers[id]
			next, exists := found[id]
			if !exists {
				// Deleted: keep what was known so its pages can still be told.
				next = liveServerAccess{}
				if previous != nil {
					next.aliases, next.was = previous.aliases, previous.allowed || previous.was
				}
				next.allowed = true
			} else if previous != nil {
				next.was = previous.was
			}
			next.at = s.now()
			s.servers[id] = &next
		}
	}
	var aliases []string
	shown := false
	for _, id := range ids {
		server := s.servers[id]
		if server == nil || !(server.allowed || server.was) {
			continue
		}
		shown = true
		aliases = append(aliases, server.aliases...)
	}
	return aliases, shown, nil
}

// The access change has been delivered; earlier membership no longer counts.
func (s *liveSocketAccess) settle() {
	for _, server := range s.servers {
		server.was = false
	}
}

// Which of ids the user may open, with every identifier a client path may use.
func (a *App) liveServerAccess(ctx context.Context, user int64, ids []int64) (map[int64]liveServerAccess, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	rows, err := a.query(ctx, `SELECT s.id,s.uuid,s.uuid_short,s.identifier,
 (u.root_admin OR s.owner_id=u.id OR EXISTS(SELECT 1 FROM subusers su WHERE su.server_id=s.id AND su.user_id=u.id)) AS allowed
 FROM servers s JOIN users u ON u.id=$1 WHERE s.id=ANY($2)`, user, ids)
	if err != nil {
		return nil, err
	}
	found := map[int64]liveServerAccess{}
	for _, row := range rows {
		access := liveServerAccess{allowed: boolean(row["allowed"])}
		seen := map[string]bool{}
		for _, alias := range []string{str(row["uuid"]), str(row["uuid_short"]), str(row["identifier"]), strconv.FormatInt(num(row["id"]), 10)} {
			if alias != "" && !seen[alias] {
				seen[alias] = true
				access.aliases = append(access.aliases, alias)
			}
		}
		found[num(row["id"])] = access
	}
	return found, nil
}
