package panel

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestEncryptedSecrets(t *testing.T) {
	a := &App{Config: Config{EncryptionKey: "secret-key-with-enough-local-entropy-for-tests"}}
	encrypted, err := a.seal("private daemon key")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(encrypted, "private daemon key") {
		t.Fatal("plaintext leak")
	}
	actual, err := a.unseal(encrypted)
	if err != nil || actual != "private daemon key" {
		t.Fatalf("decrypt: %q %v", actual, err)
	}
	other, _ := a.seal("private daemon key")
	if encrypted == other {
		t.Fatal("nonce reused")
	}
	wrong := &App{Config: Config{EncryptionKey: "wrong"}}
	if _, err = wrong.unseal(encrypted); err == nil {
		t.Fatal("wrong encryption key accepted")
	}
	if _, err = a.unseal("plaintext"); err == nil {
		t.Fatal("plaintext accepted as ciphertext")
	}
	if _, err = (&App{}).seal("x"); err == nil {
		t.Fatal("empty master key accepted")
	}
}
func TestErrorResponseTypes(t *testing.T) {
	for _, err := range []error{APIError{403, "ForbiddenException", "blocked"}, &APIError{403, "ForbiddenException", "blocked"}, pgx.ErrNoRows, errors.New("secret internal database error")} {
		w := httptest.NewRecorder()
		fail(w, err)
		if w.Code == 500 && strings.Contains(w.Body.String(), "secret internal") {
			t.Fatal("internal error leaked")
		}
		if _, ok := err.(*APIError); ok && w.Code != 403 {
			t.Fatal("pointer API error lost status")
		}
	}
}
func TestDevelopmentNetworkBoundary(t *testing.T) {
	for _, tc := range []struct {
		host, peer string
		want       bool
	}{{"127.0.0.1:8088", "127.0.0.1:1234", true}, {"localhost:8088", "[::1]:1234", true}, {"[::1]:8088", "[::1]:1234", true}, {"attacker.example:8088", "127.0.0.1:1234", false}, {"127.0.0.1:8088", "192.168.1.10:1234", false}} {
		r := httptest.NewRequest("GET", "http://"+tc.host+"/", nil)
		r.RemoteAddr = tc.peer
		if got := developmentHost(r) && loopbackRequest(r); got != tc.want {
			t.Errorf("%s from %s got%v", tc.host, tc.peer, got)
		}
	}
}
func TestCorePostgresMiddleware(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := "core_test_" + randomToken(6)
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+name); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+name+" CASCADE")
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = name
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err = pool.Exec(ctx, schema); err != nil {
		t.Fatal(err)
	}
	a := &App{DB: pool, HTTP: http.DefaultClient, Config: Config{DevMode: true, PublicURL: "http://127.0.0.1:8088", EncryptionKey: "test-key"}}
	if err = a.SeedDevelopment(ctx); err != nil {
		t.Fatal(err)
	}
	handler := a.Handler()
	request := func(method, path, authorization, origin, host, peer string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://127.0.0.1:8088"+path, bytes.NewBufferString("{}"))
		r.RemoteAddr = peer
		r.Host = host
		r.Header.Set("Authorization", authorization)
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	for _, tc := range []struct {
		authorization, origin, host, peer string
		status                            int
	}{{"", "", "127.0.0.1:8088", "127.0.0.1:123", 200}, {"Basic invalid", "", "127.0.0.1:8088", "127.0.0.1:123", 401}, {"bearer invalid", "", "127.0.0.1:8088", "127.0.0.1:123", 401}, {"", "", "attacker.example", "127.0.0.1:123", 403}, {"", "", "127.0.0.1:8088", "192.168.1.9:123", 401}} {
		w := request("GET", "/api/client/account", tc.authorization, tc.origin, tc.host, tc.peer)
		if w.Code != tc.status {
			t.Errorf("auth boundary got%d expected%d body%s", w.Code, tc.status, w.Body.String())
		}
	}
	w := request("POST", "/api/client/account/api-keys", "", "https://attacker.example", "127.0.0.1:8088", "127.0.0.1:123")
	if w.Code != 403 {
		t.Fatal("foreign origin mutation accepted")
	}
	if _, err = pool.Exec(ctx, `INSERT INTO settings(key,value) VALUES('app.maintenance','true')`); err != nil {
		t.Fatal(err)
	}
	w = request("GET", "/api/client/account", "", "", "127.0.0.1:8088", "127.0.0.1:123")
	if w.Code != 503 {
		t.Fatal("maintenance ignored")
	}
	w = request("GET", "/healthz", "", "", "127.0.0.1:8088", "127.0.0.1:123")
	if w.Code != 200 {
		t.Fatal("maintenance blocks health")
	}
}
