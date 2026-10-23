package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestDesktopPairingAndRevocation(t *testing.T) {
	a, _, admin := infraTestApp(t)
	ctx := context.Background()
	other, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "desktop_member", "email": "desktop@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	member := num(other["id"])
	// Exercise the complete production middleware, including the anonymous
	// exchange exception and the browser-session path used to create codes.
	a.Config.DevMode = false
	a.Config.PublicURL = "https://panel.example.test"
	_, err = a.DB.Exec(ctx, `INSERT INTO settings(key,value) VALUES('panel:setup','{"completed":true,"public_url":"https://panel.example.test","access_mode":"public"}')`)
	if err != nil {
		t.Fatal(err)
	}
	h := a.Handler()
	browser := func(id int64) string {
		t.Helper()
		token := randomToken(32)
		_, err := a.DB.Exec(ctx, "INSERT INTO browser_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", pairingHash(token), id)
		if err != nil {
			t.Fatal(err)
		}
		return token
	}
	adminCookie, memberCookie := browser(admin), browser(member)
	request := func(method, path, cookie, token string, body M) *httptest.ResponseRecorder {
		b, _ := json.Marshal(body)
		r := httptest.NewRequest(method, a.Config.PublicURL+path, bytes.NewReader(b))
		r.RemoteAddr = "192.0.2.1:2345"
		if cookie != "" {
			r.AddCookie(&http.Cookie{Name: sessionCookie, Value: cookie})
		}
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	attributes := func(w *httptest.ResponseRecorder, want int) M {
		t.Helper()
		if w.Code != want {
			t.Fatalf("status %d want %d: %s", w.Code, want, w.Body.String())
		}
		var result M
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return asMap(result["attributes"])
	}
	create := func(cookie string) string {
		t.Helper()
		w := request("POST", "/api/client/account/desktop/pairing", cookie, "", M{})
		d := attributes(w, 201)
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("code response cacheable")
		}
		return str(d["code"])
	}
	if w := request("POST", "/api/client/account/desktop/pairing", "", "", M{}); w.Code != 401 {
		t.Fatal("anonymous pairing creation accepted")
	}
	old := create(memberCookie)
	code := create(memberCookie)
	if w := request("POST", "/api/desktop/exchange", "", "", M{"code": old, "name": "old"}); w.Code != 401 {
		t.Fatal("replaced code accepted")
	}
	// Both exchanges race for one code. PostgreSQL must issue one session.
	var wg sync.WaitGroup
	results := make(chan *httptest.ResponseRecorder, 2)
	for range 2 {
		wg.Go(func() {
			results <- request("POST", "/api/desktop/exchange", "", "", M{"code": strings.ToLower(code), "name": "My PC"})
		})
	}
	wg.Wait()
	close(results)
	var linked M
	success := 0
	for w := range results {
		if w.Code == 201 {
			success++
			linked = attributes(w, 201)
		} else if w.Code != 401 {
			t.Fatalf("exchange failed: %s", w.Body.String())
		}
	}
	if success != 1 {
		t.Fatalf("issued %d sessions for one code", success)
	}
	token, id := str(linked["token"]), str(linked["device_id"])
	user := attributes(request("GET", "/api/client/account", "", token, nil), 200)
	if num(user["id"]) != member {
		t.Fatal("paired wrong user")
	}
	if w := request("GET", "/api/admin/users", "", token, nil); w.Code != 403 {
		t.Fatal("member session gained admin access")
	}
	if w := request("GET", "/api/client/account/desktop/devices", memberCookie, "", nil); w.Code != 200 || strings.Contains(w.Body.String(), token) || strings.Contains(w.Body.String(), "token_hash") {
		t.Fatal("device listing exposes secret")
	}
	if w := request("DELETE", "/api/client/account/desktop/devices/"+id, adminCookie, "", nil); w.Code != 404 {
		t.Fatal("other user revoked device")
	}
	if w := request("DELETE", "/api/client/account/desktop/devices/"+id, memberCookie, "", nil); w.Code != 204 {
		t.Fatalf("revoke: %s", w.Body.String())
	}
	if w := request("GET", "/api/client/account", "", token, nil); w.Code != 401 {
		t.Fatal("revoked session accepted")
	}
	code = create(memberCookie)
	_, err = a.DB.Exec(ctx, "UPDATE desktop_pairings SET expires_at=now()-interval '1 second'")
	if err != nil {
		t.Fatal(err)
	}
	if w := request("POST", "/api/desktop/exchange", "", "", M{"code": code, "name": "Expired"}); w.Code != 401 {
		t.Fatal("expired pairing code accepted")
	}
	code = create(adminCookie)
	linked = attributes(request("POST", "/api/desktop/exchange", "", "", M{"code": code, "name": "Admin desktop"}), 201)
	token = str(linked["token"])
	if w := request("GET", "/api/admin/users", "", token, nil); w.Code != 200 {
		t.Fatalf("admin desktop lost permissions: %s", w.Body.String())
	}
	_, err = a.DB.Exec(ctx, "UPDATE users SET disabled=true WHERE id=$1", admin)
	if err != nil {
		t.Fatal(err)
	}
	if w := request("GET", "/api/client/account", "", token, nil); w.Code != 403 {
		t.Fatal("disabled account desktop accepted")
	}
	_, err = a.DB.Exec(ctx, "UPDATE users SET disabled=false WHERE id=$1", admin)
	if err != nil {
		t.Fatal(err)
	}
	_, err = a.DB.Exec(ctx, "UPDATE desktop_devices SET expires_at=now()-interval '1 second'")
	if err != nil {
		t.Fatal(err)
	}
	if w := request("GET", "/api/client/account", "", token, nil); w.Code != 401 {
		t.Fatal("expired desktop session accepted")
	}
	// An existing scoped API key must not mint a full desktop session.
	key := "ptlc_" + randomToken(24)
	_, err = a.DB.Exec(ctx, "INSERT INTO api_keys(user_id,identifier,token_hash,type) VALUES($1,$2,$3,'client')", member, randomToken(8), pairingHash(key))
	if err != nil {
		t.Fatal(err)
	}
	if w := request("POST", "/api/client/account/desktop/pairing", "", key, M{}); w.Code != 403 {
		t.Fatal("API key escalated into full desktop session")
	}
}
