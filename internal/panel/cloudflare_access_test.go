package panel

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type accessTestTransport func(*http.Request) (*http.Response, error)

func (f accessTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type accessFixture struct {
	private *rsa.PrivateKey
	client  *http.Client
	mu      sync.Mutex
	kid     string
	fetches atomic.Int64
}

func newAccessFixture(t *testing.T) *accessFixture {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &accessFixture{private: key, kid: "primary"}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/cdn-cgi/access/certs" {
			http.NotFound(w, r)
			return
		}
		f.fetches.Add(1)
		f.mu.Lock()
		kid := f.kid
		f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(M{"keys": []M{{"kid": kid, "kty": "RSA", "alg": "RS256", "use": "sig", "n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())}}})
	}))
	t.Cleanup(server.Close)
	target, _ := url.Parse(server.URL)
	transport := server.Client().Transport
	f.client = &http.Client{Transport: accessTestTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "test.cloudflareaccess.com" {
			return nil, fmt.Errorf("unexpected key host")
		}
		copy := r.Clone(r.Context())
		u := *r.URL
		u.Scheme = target.Scheme
		u.Host = target.Host
		copy.URL = &u
		return transport.RoundTrip(copy)
	})}
	return f
}
func accessTestConfig() Config {
	return Config{CloudflareAccessTeamDomain: "test.cloudflareaccess.com", CloudflareAccessAudience: strings.Repeat("a", 64)}
}
func (f *accessFixture) verifier(t *testing.T) *cloudflareVerifier {
	t.Helper()
	a := &App{Config: accessTestConfig(), HTTP: f.client}
	v, err := a.accessVerifier()
	if err != nil {
		t.Fatal(err)
	}
	return v
}
func (f *accessFixture) token(t *testing.T, changes jwt.MapClaims) string {
	t.Helper()
	now := time.Now()
	claims := jwt.MapClaims{"iss": "https://test.cloudflareaccess.com", "aud": []string{strings.Repeat("a", 64)}, "exp": now.Add(time.Hour).Unix(), "iat": now.Add(-time.Minute).Unix(), "nbf": now.Add(-time.Minute).Unix(), "sub": "user-subject", "email": "Player@Example.test", "type": "app"}
	for k, v := range changes {
		if v == nil {
			delete(claims, k)
		} else {
			claims[k] = v
		}
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	f.mu.Lock()
	token.Header["kid"] = f.kid
	f.mu.Unlock()
	raw, err := token.SignedString(f.private)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestCloudflareAccessConfig(t *testing.T) {
	if issuer, _, err := cloudflareSettings(Config{}); err != nil || issuer != "" {
		t.Fatal("default must be disabled", err)
	}
	cfg := accessTestConfig()
	cfg.CloudflareAccessTeamDomain = "https://TEST.cloudflareaccess.com/"
	if issuer, _, err := cloudflareSettings(cfg); err != nil || issuer != "https://test.cloudflareaccess.com" {
		t.Fatal(issuer, err)
	}
	for _, team := range []string{"http://test.cloudflareaccess.com", "test.cloudflareaccess.com.evil.test", "localhost", "test.cloudflareaccess.com/path", "test.cloudflareaccess.com:443", "test.cloudflareaccess.com?other=1"} {
		cfg := accessTestConfig()
		cfg.CloudflareAccessTeamDomain = team
		if _, _, err := cloudflareSettings(cfg); err == nil {
			t.Fatalf("accepted unsafe team %s", team)
		}
	}
	cfg = accessTestConfig()
	cfg.CloudflareAccessAudience = ""
	if _, _, err := cloudflareSettings(cfg); err == nil {
		t.Fatal("partial configuration enabled")
	}
	cfg = accessTestConfig()
	cfg.CloudflareAccessLinkAdminEmails = []string{"Name <user@example.test>"}
	if _, _, err := cloudflareSettings(cfg); err == nil {
		t.Fatal("accepted display-name admin email")
	}
}

func TestCloudflareAccessLocalRecoveryRequiresDirectConnection(t *testing.T) {
	a := &App{Config: accessTestConfig()}
	req := httptest.NewRequest("GET", "http://localhost:8088/api/auth/session", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	if a.cloudflareBrowserRequest(req) {
		t.Fatal("direct local recovery unavailable")
	}
	for _, header := range []string{"Cf-Ray", "Cf-Connecting-Ip", "Forwarded", "X-Forwarded-For", "X-Forwarded-Host"} {
		copy := req.Clone(req.Context())
		copy.Header.Set(header, "present")
		if !a.cloudflareBrowserRequest(copy) {
			t.Fatalf("proxied request bypassed Access via %s", header)
		}
	}
	req.RemoteAddr = "203.0.113.5:1234"
	if !a.cloudflareBrowserRequest(req) {
		t.Fatal("remote localhost Host bypassed Access")
	}
}

func TestCloudflareAccessJWTValidation(t *testing.T) {
	f := newAccessFixture(t)
	v := f.verifier(t)
	identity, err := v.verify(context.Background(), f.token(t, nil))
	if err != nil || identity.Email != "player@example.test" || identity.Subject != "https://test.cloudflareaccess.com|user-subject" {
		t.Fatal(identity, err)
	}
	cases := map[string]jwt.MapClaims{
		"wrong issuer": {"iss": "https://other.cloudflareaccess.com"}, "wrong audience": {"aud": []string{strings.Repeat("b", 64)}},
		"expired": {"exp": time.Now().Add(-time.Minute).Unix()}, "missing expiration": {"exp": nil}, "future not before": {"nbf": time.Now().Add(time.Hour).Unix()}, "future issued": {"iat": time.Now().Add(time.Hour).Unix()}, "missing issued": {"iat": nil},
		"organization token": {"type": "org"}, "service token": {"email": nil, "sub": "", "common_name": "machine.access"}, "missing subject": {"sub": nil}, "missing email": {"email": nil}, "invalid email": {"email": "Somebody <player@example.test>"}, "unverified email": {"email_verified": false},
	}
	for name, changes := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := v.verify(context.Background(), f.token(t, changes)); err == nil {
				t.Fatal("invalid assertion accepted")
			}
		})
	}
	for _, raw := range []string{"", "not-a-jwt", strings.Repeat("x", 16385)} {
		if _, err := v.verify(context.Background(), raw); err == nil {
			t.Fatal("invalid token accepted")
		}
	}
	claims := jwt.MapClaims{"iss": v.issuer, "aud": v.audience, "exp": time.Now().Add(time.Hour).Unix(), "email": "player@example.test", "sub": "user", "type": "app"}
	for _, method := range []jwt.SigningMethod{jwt.SigningMethodHS256, jwt.SigningMethodNone} {
		token := jwt.NewWithClaims(method, claims)
		token.Header["kid"] = "primary"
		var secret any = []byte("not-a-public-key")
		if method == jwt.SigningMethodNone {
			secret = jwt.UnsafeAllowNoneSignatureType
		}
		raw, err := token.SignedString(secret)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = v.verify(context.Background(), raw); err == nil {
			t.Fatal("unsafe JWT algorithm accepted")
		}
	}
	other := newAccessFixture(t)
	if _, err = v.verify(context.Background(), other.token(t, nil)); err == nil {
		t.Fatal("forged RSA signature accepted")
	}
}

func TestCloudflareAccessKeysCacheAndRotation(t *testing.T) {
	f := newAccessFixture(t)
	v := f.verifier(t)
	raw := f.token(t, nil)
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := v.verify(context.Background(), raw); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if f.fetches.Load() != 1 {
		t.Fatal("concurrent checks refetched keys")
	}
	f.mu.Lock()
	f.kid = "rotated"
	f.mu.Unlock()
	rotated := f.token(t, nil)
	if _, err := v.verify(context.Background(), rotated); err == nil {
		t.Fatal("unexpected key accepted without refresh")
	}
	if f.fetches.Load() != 1 {
		t.Fatal("random key IDs bypassed refresh limit")
	}
	v.mu.Lock()
	v.fetched = time.Now().Add(-2 * time.Minute)
	v.mu.Unlock()
	if _, err := v.verify(context.Background(), rotated); err != nil {
		t.Fatal("rotated key unavailable", err)
	}
	if f.fetches.Load() != 2 {
		t.Fatal("rotation did not refresh")
	}
}

func TestCloudflareAccessKeysFailClosed(t *testing.T) {
	f := newAccessFixture(t)
	for name, response := range map[string]*http.Response{
		"redirect":     {StatusCode: 302, Header: http.Header{"Location": []string{"https://other.example.test/certs"}}, Body: io.NopCloser(strings.NewReader(""))},
		"unavailable":  {StatusCode: 503, Body: io.NopCloser(strings.NewReader(""))},
		"invalid JSON": {StatusCode: 200, Body: io.NopCloser(strings.NewReader("not-json"))},
		"empty keys":   {StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"keys":[]}`))},
		"oversized":    {StatusCode: 200, Body: io.NopCloser(strings.NewReader(strings.Repeat("x", (1<<20)+1)))},
	} {
		t.Run(name, func(t *testing.T) {
			v := f.verifier(t)
			v.client = &http.Client{Transport: accessTestTransport(func(*http.Request) (*http.Response, error) { return response, nil }), CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
			if _, err := v.verify(context.Background(), f.token(t, nil)); err == nil {
				t.Fatal("bad key endpoint accepted identity")
			}
		})
	}
}

func TestCloudflareAccessProvisioning(t *testing.T) {
	a, _, adminID := infraTestApp(t)
	ctx := context.Background()
	identity := cloudflareIdentity{Subject: "https://test.cloudflareaccess.com|new-player", Email: "new-player@example.test"}
	var wg sync.WaitGroup
	ids := make(chan int64, 10)
	for range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			id, err := a.cloudflareUser(ctx, identity)
			if err != nil {
				t.Error(err)
				return
			}
			ids <- id
		}()
	}
	wg.Wait()
	close(ids)
	var userID int64
	for id := range ids {
		if userID != 0 && id != userID {
			t.Fatal("concurrent login created duplicate users")
		}
		userID = id
	}
	u, err := a.one(ctx, "SELECT * FROM users WHERE id=$1", userID)
	if err != nil {
		t.Fatal(err)
	}
	if boolean(u["root_admin"]) || str(u["password_hash"]) != "" || str(u["access_subject"]) != identity.Subject || !usernamePattern.MatchString(str(u["username"])) {
		t.Fatal("unsafe provisioned account")
	}
	if _, err = a.DB.Exec(ctx, "UPDATE users SET disabled=true WHERE id=$1", userID); err != nil {
		t.Fatal(err)
	}
	if _, err = a.cloudflareUser(ctx, identity); err == nil {
		t.Fatal("disabled linked user accepted")
	}
	member, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "existing-member", "email": "Existing@Example.test", "nickname": "Keep my nickname"})
	if err != nil {
		t.Fatal(err)
	}
	memberIdentity := cloudflareIdentity{Subject: "issuer|existing", Email: "existing@example.test"}
	id, err := a.cloudflareUser(ctx, memberIdentity)
	if err != nil || id != num(member["id"]) {
		t.Fatal("existing user was not linked", err)
	}
	linked, _ := a.one(ctx, "SELECT * FROM users WHERE id=$1", id)
	if str(linked["nickname"]) != "Keep my nickname" || str(linked["email"]) != "Existing@Example.test" {
		t.Fatal("link changed profile")
	}
	if _, err = a.cloudflareUser(ctx, cloudflareIdentity{Subject: "other-subject", Email: memberIdentity.Email}); err == nil {
		t.Fatal("another subject rebound account")
	}
	adminIdentity := cloudflareIdentity{Subject: "issuer|admin", Email: "infra-admin@example.invalid"}
	if _, err = a.cloudflareUser(ctx, adminIdentity); err == nil {
		t.Fatal("administrator linked implicitly")
	}
	a.Config.CloudflareAccessLinkAdminEmails = []string{adminIdentity.Email, "never-admin@example.test"}
	id, err = a.cloudflareUser(ctx, adminIdentity)
	if err != nil || id != adminID {
		t.Fatal("explicit administrator linking failed", err)
	}
	id, err = a.cloudflareUser(ctx, cloudflareIdentity{Subject: "issuer|new-but-listed", Email: "never-admin@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	listed, _ := a.one(ctx, "SELECT root_admin FROM users WHERE id=$1", id)
	if boolean(listed["root_admin"]) {
		t.Fatal("link allowlist promoted new user")
	}
	for i, email := range []string{"Duplicate@example.test", "duplicate@example.test"} {
		if _, err = a.insert(ctx, "users", M{"uuid": newUUID(), "username": fmt.Sprint("duplicate", i), "email": email}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = a.cloudflareUser(ctx, cloudflareIdentity{Subject: "issuer|ambiguous", Email: "duplicate@example.test"}); err == nil {
		t.Fatal("ambiguous case-folded email linked")
	}
}

func TestCloudflareAccessMiddlewareAndMachineAuth(t *testing.T) {
	a, _, adminID := infraTestApp(t)
	ctx := context.Background()
	f := newAccessFixture(t)
	cfg := accessTestConfig()
	a.Config.CloudflareAccessTeamDomain = cfg.CloudflareAccessTeamDomain
	a.Config.CloudflareAccessAudience = cfg.CloudflareAccessAudience
	a.Config.DevMode = false
	a.Config.PublicURL = "https://panel.example.test"
	a.HTTP = f.client
	if _, err := a.DB.Exec(ctx, `INSERT INTO settings(key,value) VALUES('panel:setup','{"completed":true,"public_url":"https://panel.example.test","access_mode":"public","tls_mode":"proxy"}')`); err != nil {
		t.Fatal(err)
	}
	handler := a.Handler()
	raw := f.token(t, nil)
	request := func(path, assertion, bearer, cookie string, local bool) *httptest.ResponseRecorder {
		method := "GET"
		if path == "/api/auth/logout" {
			method = "POST"
		}
		req := httptest.NewRequest(method, "https://panel.example.test"+path, nil)
		req.RemoteAddr = "203.0.113.4:1234"
		if local {
			req.Host = "localhost:8088"
			req.RemoteAddr = "127.0.0.1:1234"
		}
		if assertion != "" {
			req.Header.Set("Cf-Access-Jwt-Assertion", assertion)
		}
		req.Header.Set("Cf-Access-Authenticated-User-Email", "infra-admin@example.invalid")
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		if cookie != "" {
			req.AddCookie(&http.Cookie{Name: sessionCookie, Value: cookie})
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	w := request("/api/auth/session", raw, "", "", false)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var session M
	if json.Unmarshal(w.Body.Bytes(), &session) != nil {
		t.Fatal("invalid session response")
	}
	if !boolean(session["authenticated"]) || str(session["auth_provider"]) != "cloudflare" || boolean(asMap(session["user"])["root_admin"]) {
		t.Fatal("spoofed header changed verified identity")
	}
	if w = request("/api/auth/session", "", "", "", false); w.Code != 401 {
		t.Fatal("missing assertion accepted", w.Code)
	}
	if w = request("/api/auth/session", "bad-token", "", "", false); w.Code != 401 || strings.Contains(w.Body.String(), "bad-token") {
		t.Fatal("invalid assertion leaked or accepted")
	}
	if w = request("/api/admin/users", raw, "", "", false); w.Code != 403 {
		t.Fatal("new user gained administration", w.Code)
	}
	if w = request("/api/auth/logout", raw, "", "", false); w.Code != 200 || !strings.Contains(w.Body.String(), "/cdn-cgi/access/logout") {
		t.Fatal("Cloudflare logout missing", w.Code)
	}
	cookie := randomToken(32)
	if _, err := a.DB.Exec(ctx, "INSERT INTO browser_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", pairingHash(cookie), adminID); err != nil {
		t.Fatal(err)
	}
	if w = request("/api/auth/session", "", "", cookie, false); w.Code != 401 {
		t.Fatal("public password cookie bypassed Access")
	}
	if w = request("/api/auth/session", "", "", cookie, true); w.Code != 200 {
		t.Fatal("local administrator recovery broken", w.Code)
	}
	apiToken := "ptlc_" + randomToken(24)
	if _, err := a.DB.Exec(ctx, "INSERT INTO api_keys(user_id,identifier,token_hash,type) VALUES($1,$2,$3,'client')", adminID, randomToken(8), pairingHash(apiToken)); err != nil {
		t.Fatal(err)
	}
	if w = request("/api/client/account", "invalid-but-irrelevant", apiToken, "", false); w.Code != 200 {
		t.Fatal("API token path broken", w.Code, w.Body.String())
	}
	if w = request("/api/client/account", raw, "invalid-bearer", "", false); w.Code != 401 {
		t.Fatal("invalid bearer fell back to Access")
	}
	desktopToken := desktopTokenPrefix + randomToken(32)
	if _, err := a.DB.Exec(ctx, "INSERT INTO desktop_devices(id,user_id,name,token_hash,expires_at) VALUES($1,$2,'Access test',$3,now()+interval '1 hour')", newUUID(), adminID, pairingHash(desktopToken)); err != nil {
		t.Fatal(err)
	}
	if w = request("/api/client/account", "", desktopToken, "", false); w.Code != 200 {
		t.Fatal("desktop token path broken", w.Code, w.Body.String())
	}
	if w = request("/api/remote/servers", "", "", "", false); w.Code == 401 && strings.Contains(w.Body.String(), "Cloudflare") {
		t.Fatal("daemon routes intercepted by Access middleware")
	}
}
