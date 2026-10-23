package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func setupTestServer(t *testing.T) (*App, *httptest.Server, *http.Client) {
	t.Helper()
	a, _, _ := infraTestApp(t)
	a.Config.DevMode = false
	server := httptest.NewServer(a.Handler())
	a.Config.PublicURL = server.URL
	t.Cleanup(server.Close)
	jar, _ := cookiejar.New(nil)
	return a, server, &http.Client{Jar: jar}
}
func setupHTTP(t *testing.T, client *http.Client, method, target string, body any, origin string) (int, M, *http.Response) {
	t.Helper()
	var data []byte
	if body != nil {
		data, _ = json.Marshal(body)
	}
	req, e := http.NewRequest(method, target, bytes.NewReader(data))
	if e != nil {
		t.Fatal(e)
	}
	req.Header.Set("Content-Type", "application/json")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	resp, e := client.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer resp.Body.Close()
	b, e := io.ReadAll(resp.Body)
	if e != nil {
		t.Fatal(e)
	}
	result := M{}
	if len(b) > 0 {
		if e = json.Unmarshal(b, &result); e != nil {
			t.Fatalf("invalid JSON, status %d", resp.StatusCode)
		}
	}
	return resp.StatusCode, result, resp
}
func setupPayload(base string) M {
	return M{"username": "firstadmin", "email": "firstadmin@example.invalid", "password": "setup-fixture-long-password", "public_url": base, "access_mode": "local", "tls_mode": "proxy"}
}

func TestFirstRunLocalSetupLoginLogoutAndNoDevelopmentBypass(t *testing.T) {
	a, server, client := setupTestServer(t)
	status, state, _ := setupHTTP(t, client, "GET", server.URL+"/api/setup/status", nil, "")
	if status != 200 || !boolean(state["needs_setup"]) || !boolean(state["setup_allowed"]) {
		t.Fatal("fresh local setup unavailable")
	}
	status, _, _ = setupHTTP(t, client, "GET", server.URL+"/api/client/account", nil, "")
	if status != 401 {
		t.Fatal("unconfigured production API was anonymous")
	}
	d := setupPayload(server.URL)
	status, validation, _ := setupHTTP(t, client, "POST", server.URL+"/api/setup/validate", d, server.URL)
	if status != 200 || !boolean(validation["valid"]) {
		t.Fatalf("Panel self-probe failed: %v", validation)
	}
	status, completed, response := setupHTTP(t, client, "POST", server.URL+"/api/setup/complete", d, server.URL)
	if status != 200 || !boolean(completed["completed"]) {
		t.Fatalf("setup failed: %v", completed)
	}
	cookies := response.Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode || cookies[0].Secure {
		t.Fatal("invalid local session cookie")
	}
	row, e := a.one(context.Background(), "SELECT password_hash FROM users WHERE username='firstadmin'")
	if e != nil {
		t.Fatal(e)
	}
	if bcrypt.CompareHashAndPassword([]byte(str(row["password_hash"])), []byte(str(d["password"]))) != nil {
		t.Fatal("password not hashed correctly")
	}
	var stored string
	e = a.DB.QueryRow(context.Background(), "SELECT token_hash FROM browser_sessions LIMIT 1").Scan(&stored)
	if e != nil || stored == cookies[0].Value {
		t.Fatal("session credential stored in plaintext")
	}
	status, session, _ := setupHTTP(t, client, "GET", server.URL+"/api/auth/session", nil, "")
	if status != 200 || !boolean(session["authenticated"]) {
		t.Fatal("setup did not sign in")
	}
	status, account, _ := setupHTTP(t, client, "GET", server.URL+"/api/client/account", nil, "")
	raw, _ := json.Marshal(account)
	if status != 200 || bytes.Contains(raw, []byte("password_hash")) || asMap(account["attributes"])["auth_provider"] != "password" {
		t.Fatal("account auth metadata or secrecy invalid")
	}
	status, _, _ = setupHTTP(t, client, "POST", server.URL+"/api/setup/complete", d, server.URL)
	if status != 409 {
		t.Fatal("setup could be claimed twice")
	}
	status, _, _ = setupHTTP(t, client, "POST", server.URL+"/api/auth/logout", nil, "https://attacker.example")
	if status != 403 {
		t.Fatal("foreign-origin logout accepted")
	}
	status, _, _ = setupHTTP(t, client, "POST", server.URL+"/api/auth/logout", nil, server.URL)
	if status != 200 {
		t.Fatal("logout failed")
	}
	// A configured panel requires a session even when started with DEV_MODE=true.
	a.Config.DevMode = true
	req := httptest.NewRequest("GET", server.URL+"/api/client/account", nil)
	req.RemoteAddr = "127.0.0.1:4000"
	req.Header.Set("X-Dev-User-ID", "1")
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, req)
	if w.Code != 401 {
		t.Fatal("configured panel still grants development admin")
	}
	status, _, _ = setupHTTP(t, client, "POST", server.URL+"/api/auth/login", M{"username": "firstadmin", "password": "wrong"}, server.URL)
	if status != 401 {
		t.Fatal("wrong password accepted")
	}
	status, _, _ = setupHTTP(t, client, "POST", server.URL+"/api/auth/login", M{"username": "firstadmin", "password": d["password"]}, server.URL)
	if status != 200 {
		t.Fatal("correct login failed")
	}
	status, session, _ = setupHTTP(t, client, "GET", server.URL+"/api/auth/session", nil, "")
	if status != 200 || !boolean(session["authenticated"]) {
		t.Fatal("login session not usable")
	}
}

func TestFirstRunRejectsRemoteBootstrapAndCrossOrigin(t *testing.T) {
	a, server, _ := setupTestServer(t)
	data, _ := json.Marshal(setupPayload(server.URL))
	cases := []struct{ peer, host, origin, forwarded string }{{"192.168.1.2:4000", "panel.example.com", "", ""}, {"127.0.0.1:4000", "localhost:8088", "https://attacker.example", ""}, {"127.0.0.1:4000", "localhost:8088", "", "192.168.1.2"}}
	for _, tc := range cases {
		req := httptest.NewRequest("POST", server.URL+"/api/setup/complete", bytes.NewReader(data))
		req.RemoteAddr = tc.peer
		req.Host = tc.host
		req.Header.Set("Origin", tc.origin)
		req.Header.Set("X-Forwarded-For", tc.forwarded)
		w := httptest.NewRecorder()
		a.Handler().ServeHTTP(w, req)
		if w.Code != 403 {
			t.Fatalf("unsafe bootstrap allowed, status %d", w.Code)
		}
	}
	var count int
	_ = a.DB.QueryRow(context.Background(), "SELECT count(*) FROM users WHERE password_hash IS NOT NULL").Scan(&count)
	if count != 0 {
		t.Fatal("rejected setup created an account")
	}
}

func TestFirstRunProbeDetectsWrongServerAndUntrustedTLS(t *testing.T) {
	a, server, client := setupTestServer(t)
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, M{"proof": "wrong"}) }))
	defer other.Close()
	input := setupPayload(other.URL)
	status, result, _ := setupHTTP(t, client, "POST", server.URL+"/api/setup/validate", input, server.URL)
	if status != 200 || boolean(result["valid"]) {
		t.Fatal("unrelated HTTP server trusted as Panel")
	}
	secure := httptest.NewTLSServer(a.Handler())
	defer secure.Close()
	input = setupPayload(secure.URL)
	status, result, _ = setupHTTP(t, client, "POST", server.URL+"/api/setup/validate", input, server.URL)
	if status != 200 || boolean(result["valid"]) {
		t.Fatal("untrusted certificate accepted")
	}
	a.HTTP = secure.Client()
	status, result, _ = setupHTTP(t, client, "POST", server.URL+"/api/setup/validate", input, server.URL)
	if status != 200 || !boolean(result["valid"]) {
		t.Fatal("trusted TLS self-probe failed")
	}
	for _, url := range []string{"http://panel.example.com", "https://user:pass@example.com", "https://example.com/path"} {
		d := M{"public_url": url, "access_mode": "public", "tls_mode": "proxy"}
		if _, e := setupInput(d); e == nil {
			t.Fatalf("unsafe URL accepted %s", url)
		}
	}
	if _, e := setupInput(M{"public_url": "https://panel.example.com", "access_mode": "public", "tls_mode": "automatic", "acme_email": "admin@example.com"}); e == nil {
		t.Fatal("automatic certificates without consent")
	}
}

func TestFirstRunConcurrentCompletionAndPersistentSessions(t *testing.T) {
	a, server, _ := setupTestServer(t)
	d := setupPayload(server.URL)
	statuses := make(chan int, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			status, _, _ := setupHTTP(t, http.DefaultClient, "POST", server.URL+"/api/setup/complete", d, server.URL)
			statuses <- status
		}()
	}
	wg.Wait()
	close(statuses)
	count := 0
	for status := range statuses {
		if status == 200 {
			count++
		} else if status != 409 {
			t.Fatalf("unexpected setup status %d", status)
		}
	}
	if count != 1 {
		t.Fatalf("first-run race created %d admins", count)
	}
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	status, _, _ := setupHTTP(t, client, "POST", server.URL+"/api/auth/login", M{"username": d["username"], "password": d["password"]}, server.URL)
	if status != 200 {
		t.Fatal("login failed")
	}
	// A new App instance uses persisted setup/session data, not process memory.
	resumed := &App{DB: a.DB, Config: a.Config, HTTP: a.HTTP}
	req := httptest.NewRequest("GET", server.URL+"/api/client/account", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	origin, _ := http.NewRequest("GET", server.URL, nil)
	for _, c := range jar.Cookies(origin.URL) {
		req.AddCookie(c)
	}
	w := httptest.NewRecorder()
	resumed.Handler().ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatal("session lost across app restart")
	}
	_, e := a.DB.Exec(context.Background(), "UPDATE browser_sessions SET expires_at=now()-interval '1 second'")
	if e != nil {
		t.Fatal(e)
	}
	status, _, _ = setupHTTP(t, client, "GET", server.URL+"/api/client/account", nil, "")
	if status != 401 {
		t.Fatal("expired session accepted")
	}
}

func TestLoginRateLimitAndDisabledAccount(t *testing.T) {
	a, server, client := setupTestServer(t)
	d := setupPayload(server.URL)
	status, _, _ := setupHTTP(t, client, "POST", server.URL+"/api/setup/complete", d, server.URL)
	if status != 200 {
		t.Fatal("setup failed")
	}
	_, e := a.DB.Exec(context.Background(), "UPDATE users SET disabled=true WHERE username='firstadmin'")
	if e != nil {
		t.Fatal(e)
	}
	status, _, _ = setupHTTP(t, client, "GET", server.URL+"/api/client/account", nil, "")
	if status != 401 {
		t.Fatal("disabled session remains active")
	}
	for attempt := 1; attempt <= 11; attempt++ {
		status, _, _ = setupHTTP(t, http.DefaultClient, "POST", server.URL+"/api/auth/login", M{"username": "missing", "password": "wrong"}, server.URL)
		want := 401
		if attempt == 11 {
			want = 429
		}
		if status != want {
			t.Fatalf("attempt %d: %d", attempt, status)
		}
	}
}

func TestSetupSessionCookieSecureOnHTTPS(t *testing.T) {
	a, _, _ := infraTestApp(t)
	a.Config.DevMode = false
	server := httptest.NewTLSServer(a.Handler())
	defer server.Close()
	a.Config.PublicURL = server.URL
	a.HTTP = server.Client()
	d := setupPayload(server.URL)
	status, _, resp := setupHTTP(t, server.Client(), "POST", server.URL+"/api/setup/complete", d, server.URL)
	if status != 200 || len(resp.Cookies()) != 1 || !resp.Cookies()[0].Secure {
		t.Fatal("HTTPS login cookie not secure")
	}
}

func TestSetupPasswordValidation(t *testing.T) {
	_, server, client := setupTestServer(t)
	for _, password := range []string{"short", strings.Repeat("a", 73)} {
		d := setupPayload(server.URL)
		d["password"] = password
		status, _, _ := setupHTTP(t, client, "POST", server.URL+"/api/setup/complete", d, server.URL)
		if status != 422 {
			t.Fatal("invalid password length accepted")
		}
	}
}

type setupTransportFunc func(*http.Request) (*http.Response, error)

func (f setupTransportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestAutomaticHTTPSStagingRequiresConsentAndVerifiedPanelBeforeReady(t *testing.T) {
	a, server, client := setupTestServer(t)
	// Do not bind a public listener or contact a CA in a unit test. Production
	// uses ensureManagedHTTPS; this fixture isolates the pending/verify protocol.
	a.managedHTTPS = &managedHTTPS{closed: true}
	a.HTTP = &http.Client{Transport: setupTransportFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("fixture domain not reachable yet")
	})}
	d := setupPayload(server.URL)
	d["public_url"] = "https://setup.example.test"
	d["access_mode"] = "public"
	d["tls_mode"] = "automatic"
	d["acme_email"] = "admin@example.invalid"
	status, _, _ := setupHTTP(t, client, "POST", server.URL+"/api/setup/complete", d, server.URL)
	if status != 422 {
		t.Fatal("certificate setup accepted without consent")
	}
	d["accept_acme_terms"] = true
	status, check, _ := setupHTTP(t, client, "POST", server.URL+"/api/setup/validate", d, server.URL)
	if status != 200 || boolean(check["valid"]) || !boolean(check["can_save"]) {
		t.Fatal("automatic HTTPS pending state invalid")
	}
	status, saved, _ := setupHTTP(t, client, "POST", server.URL+"/api/setup/complete", d, server.URL)
	if status != 200 || !boolean(saved["completed"]) || !boolean(saved["https_pending"]) {
		t.Fatal("automatic HTTPS did not stage honestly")
	}
	status, verify, _ := setupHTTP(t, client, "POST", server.URL+"/api/setup/https", nil, server.URL)
	if status != 200 || boolean(verify["valid"]) || !boolean(verify["https_pending"]) {
		t.Fatal("pending HTTPS marked verified")
	}
	secure := httptest.NewTLSServer(a.Handler())
	defer secure.Close()
	trusted := secure.Client()
	a.HTTP = &http.Client{Transport: setupTransportFunc(func(r *http.Request) (*http.Response, error) {
		forward := r.Clone(r.Context())
		target := *forward.URL
		base, _ := http.NewRequest("GET", secure.URL, nil)
		target.Host = base.URL.Host
		forward.URL = &target
		return trusted.Do(forward)
	})}
	status, verify, _ = setupHTTP(t, client, "POST", server.URL+"/api/setup/https", nil, server.URL)
	if status != 200 || !boolean(verify["valid"]) || boolean(verify["https_pending"]) {
		t.Fatal("trusted HTTPS Panel identity was not verified")
	}
	_, state, _ := setupHTTP(t, client, "GET", server.URL+"/api/setup/status", nil, "")
	if boolean(state["https_pending"]) {
		t.Fatal("verified HTTPS state not persisted")
	}
}
