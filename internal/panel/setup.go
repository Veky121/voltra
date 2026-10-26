package panel

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/mail"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

const sessionCookie = "voltra_session"

type setupState struct {
	Completed  bool   `json:"completed"`
	PublicURL  string `json:"public_url"`
	AccessMode string `json:"access_mode"`
	TLSMode    string `json:"tls_mode"`
	ACMEEmail  string `json:"acme_email,omitempty"`
	PendingTLS bool   `json:"pending_tls"`
}

func (a *App) setupState(ctx context.Context) (setupState, error) {
	s := setupState{PublicURL: a.Config.PublicURL, AccessMode: "local", TLSMode: "proxy"}
	if a.DB == nil {
		return s, nil
	}
	var raw []byte
	e := a.DB.QueryRow(ctx, "SELECT value FROM settings WHERE key='panel:setup'").Scan(&raw)
	if errors.Is(e, pgx.ErrNoRows) {
		return s, nil
	}
	if e != nil {
		return s, e
	}
	e = json.Unmarshal(raw, &s)
	return s, e
}
func (a *App) panelPublicURL(ctx context.Context) string {
	s, e := a.setupState(ctx)
	if e == nil && s.PublicURL != "" && (s.Completed || s.PendingTLS) {
		return s.PublicURL
	}
	return a.Config.PublicURL
}
func (a *App) registerSetup(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/setup/status", a.setupStatus)
	mux.HandleFunc("GET /api/setup/probe/{nonce}", a.setupProbe)
	mux.HandleFunc("POST /api/setup/validate", a.setupValidate)
	mux.HandleFunc("POST /api/setup/complete", a.setupComplete)
	mux.HandleFunc("POST /api/setup/https", a.setupHTTPS)
	mux.HandleFunc("GET /api/auth/session", a.browserSession)
	mux.HandleFunc("POST /api/auth/login", a.browserLogin)
	mux.HandleFunc("POST /api/auth/logout", a.browserLogout)
}
func (a *App) bootstrapAllowed(r *http.Request, s setupState) bool {
	// Proxies must not turn an unauthenticated remote request into local bootstrap.
	return !s.Completed && loopbackRequest(r) && developmentHost(r) && r.Header.Get("Forwarded") == "" && r.Header.Get("X-Forwarded-For") == "" && r.Header.Get("X-Forwarded-Host") == ""
}
func (a *App) setupStatus(w http.ResponseWriter, r *http.Request) {
	s, e := a.setupState(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	allowed := a.bootstrapAllowed(r, s)
	if !allowed && s.Completed {
		_, e = a.requireAdmin(r)
		allowed = e == nil
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, M{"needs_setup": !s.Completed, "setup_allowed": allowed, "auth_enabled": s.Completed, "public_url": s.PublicURL, "access_mode": s.AccessMode, "tls_mode": s.TLSMode, "restart_required": false, "dev_mode": a.Config.DevMode, "https_pending": s.PendingTLS})
}
func (a *App) browserOrigin(r *http.Request, s setupState) bool {
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		return false
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if origin == scheme+"://"+r.Host {
		return true
	}
	if origin == s.PublicURL || origin == a.Config.PublicURL {
		return true
	}
	return a.Config.DevMode && !s.Completed && loopbackRequest(r) && (origin == "http://localhost:5180" || origin == "http://127.0.0.1:5180")
}
func (a *App) authorizeSetup(r *http.Request, s setupState) error {
	if !a.browserOrigin(r, s) {
		return forbidden()
	}
	if a.bootstrapAllowed(r, s) {
		return nil
	}
	if !s.Completed {
		return forbidden()
	}
	_, e := a.requireAdmin(r)
	return e
}
func (a *App) setupProbe(w http.ResponseWriter, r *http.Request) {
	nonce := r.PathValue("nonce")
	if len(nonce) != 48 {
		fail(w, notFound())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, M{"proof": a.setupProof(nonce)})
}
func (a *App) setupProof(nonce string) string {
	mac := hmac.New(sha256.New, []byte(a.Config.EncryptionKey))
	_, _ = mac.Write([]byte("voltra-panel-address:" + nonce))
	return hex.EncodeToString(mac.Sum(nil))
}
func setupInput(d M) (setupState, error) {
	s := setupState{PublicURL: strings.TrimRight(strings.TrimSpace(str(d["public_url"])), "/"), AccessMode: str(d["access_mode"]), TLSMode: str(d["tls_mode"]), ACMEEmail: strings.TrimSpace(str(d["acme_email"]))}
	if s.AccessMode == "" {
		s.AccessMode = "local"
	}
	if s.TLSMode == "" {
		s.TLSMode = "proxy"
	}
	base, e := pairingPanelURL(s.PublicURL)
	if e != nil {
		return s, e
	}
	s.PublicURL = base
	u, _ := url.Parse(base)
	ip := net.ParseIP(u.Hostname())
	local := strings.EqualFold(u.Hostname(), "localhost") || ip != nil && ip.IsLoopback()
	if s.AccessMode != "local" && s.AccessMode != "public" {
		return s, bad("Choose Local or Public access.")
	}
	if s.TLSMode != "proxy" && s.TLSMode != "automatic" {
		return s, bad("Choose an existing HTTPS proxy or automatic certificates.")
	}
	if s.AccessMode == "local" && !local {
		return s, bad("Local access requires a localhost or loopback address.")
	}
	if s.AccessMode == "public" && (local || u.Scheme != "https") {
		return s, bad("Public access requires a reachable HTTPS address.")
	}
	if s.TLSMode == "automatic" {
		if s.AccessMode != "public" || ip != nil || !strings.Contains(u.Hostname(), ".") || u.Port() != "" && u.Port() != "443" {
			return s, bad("Automatic HTTPS requires a domain name on port 443.")
		}
		if _, e = mail.ParseAddress(s.ACMEEmail); e != nil {
			return s, bad("Provide a valid certificate contact email.")
		}
		if !boolean(d["accept_acme_terms"]) {
			return s, bad("Accept the certificate authority terms to enable automatic HTTPS.")
		}
	}
	return s, nil
}

type setupCheck struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

func (a *App) validateSetupAddress(ctx context.Context, s setupState) ([]setupCheck, bool) {
	checks := []setupCheck{{"address", "ok", "Panel address is valid."}}
	if a.Config.EncryptionKey == "" {
		return append(checks, setupCheck{"encryption", "error", "Set ENCRYPTION_KEY on the Panel before completing setup."}), false
	}
	nonce := randomToken(24)
	request, e := http.NewRequestWithContext(ctx, "GET", s.PublicURL+"/api/setup/probe/"+nonce, nil)
	if e != nil {
		return append(checks, setupCheck{"connection", "error", "Check the Panel address."}), false
	}
	client := &http.Client{Timeout: 7 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	if a.HTTP != nil {
		*client = *a.HTTP
		client.Timeout = 7 * time.Second
		client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	}
	response, e := client.Do(request)
	if e != nil {
		detail := "Cannot reach this Panel at that address. Check DNS, the port and HTTPS certificate."
		if s.AccessMode == "local" {
			detail = "Cannot reach the Panel. Use its actual localhost address and port."
		}
		status := "error"
		if s.TLSMode == "automatic" {
			status = "pending"
			detail = "Save to enable automatic HTTPS, then verify the public address after the listener starts."
		}
		return append(checks, setupCheck{"connection", status, detail}), false
	}
	defer response.Body.Close()
	var result M
	e = json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&result)
	if response.StatusCode != 200 || e != nil || !hmac.Equal([]byte(str(result["proof"])), []byte(a.setupProof(nonce))) {
		return append(checks, setupCheck{"connection", "error", "This address answered, but it is not this Panel."}), false
	}
	checks = append(checks, setupCheck{"connection", "ok", "This Panel is reachable."})
	if strings.HasPrefix(s.PublicURL, "https://") {
		checks = append(checks, setupCheck{"https", "ok", "HTTPS certificate is trusted."})
	}
	return checks, true
}
func (a *App) setupValidate(w http.ResponseWriter, r *http.Request) {
	s, e := a.setupState(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	if e = a.authorizeSetup(r, s); e != nil {
		fail(w, e)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	input, e := setupInput(d)
	if e != nil {
		writeJSON(w, 200, M{"valid": false, "checks": []setupCheck{{"address", "error", e.Error()}}, "restart_required": false})
		return
	}
	checks, valid := a.validateSetupAddress(r.Context(), input)
	canStage := input.TLSMode == "automatic"
	for _, check := range checks {
		if check.Status == "error" {
			canStage = false
		}
	}
	writeJSON(w, 200, M{"valid": valid, "checks": checks, "restart_required": false, "can_save": valid || canStage})
}

var setupUsername = regexp.MustCompile(`^[a-zA-Z0-9_.-]{2,64}$`)

func (a *App) setupComplete(w http.ResponseWriter, r *http.Request) {
	current, e := a.setupState(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	if current.Completed {
		fail(w, APIError{409, "SetupComplete", "This Panel is already configured."})
		return
	}
	if !a.bootstrapAllowed(r, current) || !a.browserOrigin(r, current) {
		fail(w, forbidden())
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	s, e := setupInput(d)
	if e != nil {
		fail(w, e)
		return
	}
	username, email, password := strings.TrimSpace(str(d["username"])), strings.TrimSpace(str(d["email"])), str(d["password"])
	address, mailErr := mail.ParseAddress(email)
	if !setupUsername.MatchString(username) || mailErr != nil || address.Address != email || len(password) < 12 || len(password) > 72 {
		fail(w, bad("Use a valid username and email, and a password between 12 and 72 bytes."))
		return
	}
	checks, reachable := a.validateSetupAddress(r.Context(), s)
	if a.Config.EncryptionKey == "" {
		fail(w, bad("Set ENCRYPTION_KEY on the Panel before completing setup."))
		return
	}
	canStage := s.TLSMode == "automatic"
	for _, check := range checks {
		if check.Status == "error" {
			canStage = false
		}
	}
	if !reachable && !canStage {
		writeJSON(w, 422, M{"errors": []M{{"detail": "Verify the Panel address before finishing setup."}}, "checks": checks})
		return
	}
	hash, e := bcrypt.GenerateFromPassword([]byte(password), 12)
	if e != nil {
		fail(w, e)
		return
	}
	ctx := r.Context()
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(ctx)
	_, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||'voltra-first-run',0))")
	if e != nil {
		fail(w, e)
		return
	}
	var existing bool
	e = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM settings WHERE key='panel:setup' AND (value->>'completed')::boolean=true)").Scan(&existing)
	if e != nil {
		fail(w, e)
		return
	}
	if existing {
		fail(w, APIError{409, "SetupComplete", "This Panel is already configured."})
		return
	}
	// A public installation with any password account cannot be claimed again,
	// even if its setup settings were removed accidentally.
	e = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM users WHERE password_hash IS NOT NULL)").Scan(&existing)
	if e != nil {
		fail(w, e)
		return
	}
	if existing {
		fail(w, APIError{409, "AccountConfigured", "An administrator account already exists."})
		return
	}
	var userID int64
	e = tx.QueryRow(ctx, `INSERT INTO users(uuid,username,email,password_hash,root_admin) VALUES($1,$2,$3,$4,true) ON CONFLICT(username) DO UPDATE SET email=EXCLUDED.email,password_hash=EXCLUDED.password_hash,root_admin=true,updated_at=now() WHERE users.password_hash IS NULL AND users.root_admin=true AND users.disabled=false RETURNING id`, newUUID(), username, email, string(hash)).Scan(&userID)
	if e != nil {
		fail(w, e)
		return
	}
	s.Completed = true
	s.PendingTLS = !reachable
	raw, _ := json.Marshal(s)
	_, e = tx.Exec(ctx, `INSERT INTO settings(key,value) VALUES('panel:setup',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, raw)
	token := randomToken(32)
	if e == nil {
		_, e = tx.Exec(ctx, "INSERT INTO browser_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')", pairingHash(token), userID)
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		fail(w, e)
		return
	}
	// Secure is based on the browser's actual connection. A local bootstrap
	// session remains local while public HTTPS is being provisioned.
	a.setBrowserCookie(w, r, token)
	if s.TLSMode == "automatic" {
		a.ensureManagedHTTPS(s)
	}
	next := "/admin/nodes"
	if s.PendingTLS {
		next = "/setup"
	}
	writeJSON(w, 200, M{"completed": true, "restart_required": false, "https_pending": s.PendingTLS, "next_url": next})
}
func (a *App) setBrowserCookie(w http.ResponseWriter, r *http.Request, token string) {
	u, _ := url.Parse(a.panelPublicURL(r.Context()))
	secure := r.TLS != nil || u != nil && u.Scheme == "https" && strings.EqualFold(u.Host, r.Host)
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteStrictMode, MaxAge: 12 * 3600})
}
func (a *App) sessionUser(r *http.Request) (int64, error) {
	cookie, e := r.Cookie(sessionCookie)
	if e != nil {
		return 0, nil
	}
	if len(cookie.Value) != 64 {
		return 0, nil
	}
	var id int64
	e = a.DB.QueryRow(r.Context(), `SELECT s.user_id FROM browser_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.disabled`, pairingHash(cookie.Value)).Scan(&id)
	if errors.Is(e, pgx.ErrNoRows) {
		return 0, nil
	}
	return id, e
}
func (a *App) browserSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	u, e := a.user(r)
	if e != nil {
		writeJSON(w, 200, M{"authenticated": false})
		return
	}
	provider := "password"
	if r.Context().Value(cloudflareIdentityKey{}) == true {
		provider = "cloudflare"
	}
	writeJSON(w, 200, M{"authenticated": true, "auth_provider": provider, "user": M{"id": u["id"], "username": u["username"], "email": u["email"], "root_admin": u["root_admin"]}})
}
func (a *App) browserLogin(w http.ResponseWriter, r *http.Request) {
	s, e := a.setupState(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	if !s.Completed || !a.browserOrigin(r, s) {
		fail(w, forbidden())
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if ip == "" {
		ip = r.RemoteAddr
	}
	// Atomic database buckets work across concurrent handlers and restarts.
	bucket := pairingHash(ip)
	var attempts int
	e = a.DB.QueryRow(r.Context(), `INSERT INTO login_attempts(bucket,attempts) VALUES($1,1) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN login_attempts.window_start<now()-interval '15 minutes' THEN 1 ELSE login_attempts.attempts+1 END,window_start=CASE WHEN login_attempts.window_start<now()-interval '15 minutes' THEN now() ELSE login_attempts.window_start END RETURNING attempts`, bucket).Scan(&attempts)
	if e != nil {
		fail(w, e)
		return
	}
	if attempts > 10 {
		w.Header().Set("Retry-After", "900")
		fail(w, APIError{429, "LoginRateLimited", "Too many sign-in attempts. Try again in 15 minutes."})
		return
	}
	username, password := str(d["username"]), str(d["password"])
	u, e := a.one(r.Context(), "SELECT id,password_hash,disabled FROM users WHERE lower(username)=lower($1)", username)
	hash := []byte("$2a$12$LQv3c1yqBWVHxkd0LHAkCOYHnfNngbNqGvPiGJYpZk5.6TYt6xEei")
	if e == nil && str(u["password_hash"]) != "" {
		hash = []byte(str(u["password_hash"]))
	}
	valid := len(password) <= 72 && bcrypt.CompareHashAndPassword(hash, []byte(password)) == nil
	if e != nil || !valid || boolean(u["disabled"]) {
		fail(w, APIError{401, "InvalidLogin", "The username or password is incorrect."})
		return
	}
	token := randomToken(32)
	_, e = a.DB.Exec(r.Context(), `INSERT INTO browser_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')`, pairingHash(token), u["id"])
	if e != nil {
		fail(w, e)
		return
	}
	if previous, e := r.Cookie(sessionCookie); e == nil {
		_, _ = a.DB.Exec(r.Context(), "DELETE FROM browser_sessions WHERE token_hash=$1", pairingHash(previous.Value))
	}
	// Successful sign-in does not reset the IP bucket, preventing brute force
	// against other accounts by someone who knows one account's password.
	a.setBrowserCookie(w, r, token)
	writeJSON(w, 200, M{"authenticated": true})
}
func (a *App) browserLogout(w http.ResponseWriter, r *http.Request) {
	s, e := a.setupState(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	if !a.browserOrigin(r, s) {
		fail(w, forbidden())
		return
	}
	if cookie, e := r.Cookie(sessionCookie); e == nil {
		if _, e = a.DB.Exec(r.Context(), "DELETE FROM browser_sessions WHERE token_hash=$1", pairingHash(cookie.Value)); e != nil {
			fail(w, e)
			return
		}
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true, Secure: r.TLS != nil, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	if r.Context().Value(cloudflareIdentityKey{}) == true {
		writeJSON(w, 200, M{"authenticated": false, "redirect_url": "/cdn-cgi/access/logout"})
		return
	}
	writeJSON(w, 200, M{"authenticated": false})
}
