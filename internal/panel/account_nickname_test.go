package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAccountNicknameDefaultsAndValidation(t *testing.T) {
	for _, tc := range []struct {
		user M
		want string
	}{
		{M{"email": "player.name@example.test", "username": "login-name", "name_first": "Old", "name_last": "Name"}, "player.name"},
		{M{"nickname": "Custom name 🦊", "email": "player@example.test"}, "Custom name 🦊"},
		{M{"username": "login-only"}, "login-only"},
	} {
		if got := accountNickname(tc.user); got != tc.want {
			t.Errorf("nickname=%q, want %q", got, tc.want)
		}
	}
	for _, value := range []any{"", "   ", 42, nil, strings.Repeat("a", 65), "name\nadmin", "bad\x00name"} {
		if _, err := accountUserData(M{"nickname": value}, false); err == nil {
			t.Errorf("Accepted invalid nickname %#v", value)
		}
	}
	valid, err := accountUserData(M{"nickname": "  Player One 🦊  "}, false)
	if err != nil || valid["nickname"] != "Player One 🦊" {
		t.Fatalf("Valid nickname rejected: %#v %v", valid, err)
	}
}

func TestAccountNicknamePersistsAndCannotChangeIdentity(t *testing.T) {
	a := cliTestApp(t)
	ctx := context.Background()
	u, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "login-player", "email": "cloudflare.email@example.test", "name_first": "Legacy", "name_last": "Name", "language": "en"})
	if err != nil {
		t.Fatal(err)
	}
	other, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "other-player", "email": "other@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	a.registerAccounts(mux)
	request := func(method string, body M) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		r := WithUser(httptest.NewRequest(method, "/api/client/account", strings.NewReader(string(raw))), num(u["id"]))
		// Unverified identity headers cannot choose the default nickname.
		r.Header.Set("Cf-Access-Authenticated-User-Email", "spoofed@example.test")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	var first M
	w := request("GET", nil)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	json.Unmarshal(w.Body.Bytes(), &first)
	if asMap(first["attributes"])["nickname"] != "cloudflare.email" {
		t.Fatal("Default did not use stored account email")
	}
	w = request("PATCH", M{"nickname": "  Player One  ", "email": "attacker@example.test", "username": "new-login", "root_admin": true, "id": other["id"]})
	if w.Code != 200 {
		t.Fatalf("Save failed: %d %s", w.Code, w.Body.String())
	}
	saved, err := a.one(ctx, "SELECT * FROM users WHERE id=$1", u["id"])
	if err != nil {
		t.Fatal(err)
	}
	if saved["nickname"] != "Player One" || saved["email"] != u["email"] || saved["username"] != u["username"] || boolean(saved["root_admin"]) || saved["name_first"] != "Legacy" || saved["name_last"] != "Name" || saved["language"] != "en" {
		t.Fatal("Nickname save changed unrelated identity fields")
	}
	for _, invalid := range []any{"", nil, strings.Repeat("x", 65), "bad\nname"} {
		if w = request("PATCH", M{"nickname": invalid}); w.Code != 422 {
			t.Fatalf("Invalid nickname returned %d", w.Code)
		}
	}
	w = request("GET", nil)
	var result M
	json.Unmarshal(w.Body.Bytes(), &result)
	if asMap(result["attributes"])["nickname"] != "Player One" {
		t.Fatal("Nickname did not survive a fresh account read")
	}
	untouched, err := a.one(ctx, "SELECT nickname FROM users WHERE id=$1", other["id"])
	if err != nil || str(untouched["nickname"]) != "" {
		t.Fatal("Another account was modified")
	}
}
