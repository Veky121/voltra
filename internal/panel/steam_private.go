package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"sync"
	"time"
	"unicode/utf8"
	"voltra/internal/steamapi"
)

var privateHubInitialization sync.Mutex
var errPrivateCancelled = errors.New("private Steam authorization cancelled")
var errPrivateResupply = errors.New("private Steam credentials must be supplied again")

type privateGuardState struct {
	challenge        steamapi.PrivateChallenge
	actor            int64
	authKind, authID string
	expires          time.Time
	ctx              context.Context
	claimed          bool
	nodeID           int64
	server, owner    string
}
type privateSteamHub struct {
	mu            sync.Mutex
	active        map[string]context.CancelFunc
	guards        map[string]*privateGuardState
	wg            sync.WaitGroup
	ready         func(context.Context, int64, uint32) bool
	recoveryReady func(context.Context, int64, uint32) bool
	dial          func(context.Context, int64, steamapi.PrivateStreamGrant) (net.Conn, error)
	poll          time.Duration
	closed        bool
}

func (a *App) privateHub() *privateSteamHub {
	privateHubInitialization.Lock()
	defer privateHubInitialization.Unlock()
	if a.privateSteam == nil {
		a.privateSteam = &privateSteamHub{active: map[string]context.CancelFunc{}, guards: map[string]*privateGuardState{}, poll: time.Second}
	}
	return a.privateSteam
}
func (a *App) closePrivateSteam() {
	h := a.privateHub()
	h.mu.Lock()
	h.closed = true
	for _, cancel := range h.active {
		cancel()
	}
	h.mu.Unlock()
	h.wg.Wait()
}
func (a *App) registerPrivateSteam(mux *http.ServeMux) {
	base := "/api/client/servers/{server}/steam/private"
	mux.HandleFunc("GET "+base, a.privateSteamReadiness)
	mux.HandleFunc("GET "+base+"/authorizations", a.privateAuthorizations)
	mux.HandleFunc("POST "+base+"/authorizations", a.privateAuthorizationCreate)
	mux.HandleFunc("PUT "+base+"/authorizations/{authorization}", a.privateAuthorizationUpdate)
	mux.HandleFunc("DELETE "+base+"/authorizations/{authorization}", a.privateAuthorizationDelete)
	mux.HandleFunc("POST "+base+"/jobs", a.privateJobCreate)
	mux.HandleFunc("GET "+base+"/jobs", a.privateJobs)
	mux.HandleFunc("GET "+base+"/jobs/{job}", a.privateJobStatus)
	mux.HandleFunc("POST "+base+"/jobs/{job}/guard", a.privateJobGuard)
	mux.HandleFunc("POST "+base+"/jobs/{job}/cancel", a.privateJobCancel)
	mux.HandleFunc("POST "+base+"/jobs/{job}/recover", a.privateJobRecover)
}
func privateStrictJSON(raw []byte) bool {
	if !utf8.Valid(raw) {
		return false
	}
	quoted := false
	for i := 0; i < len(raw); i++ {
		if raw[i] == '"' {
			quoted = !quoted
			continue
		}
		if !quoted || raw[i] != '\\' {
			continue
		}
		i++
		if i >= len(raw) {
			return false
		}
		if raw[i] != 'u' {
			continue
		}
		if i+4 >= len(raw) {
			return false
		}
		v, e := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
		if e != nil {
			return false
		}
		i += 4
		if v >= 0xdc00 && v <= 0xdfff {
			return false
		}
		if v >= 0xd800 && v <= 0xdbff {
			if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
				return false
			}
			low, e := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
			if e != nil || low < 0xdc00 || low > 0xdfff {
				return false
			}
			i += 6
		}
	}
	return true
}
func privateDecode(r *http.Request, value any) error {
	raw, e := io.ReadAll(io.LimitReader(r.Body, 65537))
	defer clear(raw)
	if e != nil || len(raw) > 65536 || !privateStrictJSON(raw) {
		return bad("Invalid private Steam request.")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(value) != nil {
		return bad("Invalid private Steam request.")
	}
	var trailing any
	if d.Decode(&trailing) != io.EOF {
		return bad("Invalid private Steam request.")
	}
	return nil
}

// Repeat normal identity/permission checks while allowing exact-job status/cancel
// during installation. No general mutation/lifecycle bypass is introduced.
func (a *App) privateServer(r *http.Request) (M, M, error) {
	u, e := a.user(r)
	if e != nil {
		return nil, nil, e
	}
	if k, ok := r.Context().Value(apiKeyContextKey{}).(M); ok && str(k["type"]) != "client" {
		return nil, nil, forbidden()
	}
	id, _ := strconv.ParseInt(r.PathValue("server"), 10, 64)
	s, e := a.one(r.Context(), "SELECT * FROM servers WHERE uuid=$1 OR uuid_short=$1 OR identifier=$1 OR id=$2", r.PathValue("server"), id)
	if e != nil {
		return nil, nil, e
	}
	if !a.can(r.Context(), u, s, "") {
		return nil, nil, notFound()
	}
	if !a.can(r.Context(), u, s, "startup.update") {
		return nil, nil, forbidden()
	}
	return s, u, nil
}
func (a *App) privateAuthBinding(r *http.Request, actor int64) (string, string, error) {
	if k, ok := r.Context().Value(apiKeyContextKey{}).(M); ok && str(k["type"]) == "client" && num(k["user_id"]) == actor {
		return "api_key", strconv.FormatInt(num(k["id"]), 10), nil
	}
	cookie, e := r.Cookie(sessionCookie)
	if e != nil || len(cookie.Value) != 64 {
		return "", "", unauthorizedKey()
	}
	hash := pairingHash(cookie.Value)
	var allowed bool
	e = a.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM browser_sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now())", hash, actor).Scan(&allowed)
	if e != nil || !allowed {
		return "", "", unauthorizedKey()
	}
	return "session", hash, nil
}
func (a *App) privateReady(ctx context.Context, node int64, app uint32) bool {
	h := a.privateHub()
	h.mu.Lock()
	ready := h.ready
	closed := h.closed
	h.mu.Unlock()
	return !closed && ready != nil && ready(ctx, node, app)
}
func (a *App) privateDial(ctx context.Context, node int64, grant steamapi.PrivateStreamGrant) (net.Conn, error) {
	h := a.privateHub()
	h.mu.Lock()
	dial := h.dial
	h.mu.Unlock()
	if dial != nil {
		return dial(ctx, node, grant)
	}
	return a.dialPrivateNodeService(ctx, node, grant)
}

var privateCodeID = regexp.MustCompile(`^[a-f0-9]{32}$`)
