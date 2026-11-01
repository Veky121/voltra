package panel

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUserEmailPrivacyProjections(t *testing.T) {
	user := M{"id": int64(4), "username": "login-name", "nickname": "Chosen name", "email": "private@example.test"}
	for _, public := range []M{userAttributes(user), collabUser(user)} {
		raw, _ := json.Marshal(public)
		if strings.Contains(string(raw), "private") || strings.Contains(string(raw), "gravatar") {
			t.Fatalf("Shared identity leaks contact data: %s", raw)
		}
		if public["nickname"] != "Chosen name" {
			t.Fatal("Shared identity omitted the chosen name")
		}
	}
	if accountAttributes(user)["email"] != user["email"] {
		t.Fatal("Own account lost its email")
	}
	for _, identity := range []M{{"email": "private@example.test"}, {"nickname": "private@example.test", "username": "login-name"}} {
		if strings.Contains(accountNickname(identity), "@") {
			t.Fatal("Email used as display name")
		}
	}
	input := M{"email": "private@example.test", "message": "Invited private@example.test", "nested": []any{map[string]any{"contact_email": "nested@example.test"}, []any{"deep@example.test"}}, "typed": M{"email": "typed@example.test", "password": "secret"}}
	raw, _ := json.Marshal(collabRedactProperties(input, false))
	if strings.Contains(string(raw), "@") || strings.Contains(string(raw), "secret") {
		t.Fatalf("Activity privacy failed: %s", raw)
	}
	if input["email"] != "private@example.test" {
		t.Fatal("Redaction mutated stored audit data")
	}
}

func TestUserEmailPrivacyEndpoints(t *testing.T) {
	a := cliTestApp(t)
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	defer daemon.Close()
	owner, server := collabFixture(t, a, t.Context(), daemon.URL)
	if err := a.exec(t.Context(), "UPDATE users SET root_admin=true,nickname='Owner name' WHERE id=$1", owner["id"]); err != nil {
		t.Fatal(err)
	}
	person, err := a.insert(t.Context(), "users", M{"uuid": newUUID(), "username": "private-player", "nickname": "Chosen player", "email": "private-player@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	a.registerAccounts(mux)
	a.registerCollaboration(mux)
	request := func(user int64, method, path string, body M) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		r := WithUser(httptest.NewRequest(method, path, strings.NewReader(string(raw))), user)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	safe := func(w *httptest.ResponseRecorder) {
		t.Helper()
		if w.Code != 200 {
			t.Fatalf("Unexpected response: %d %s", w.Code, w.Body.String())
		}
		if strings.Contains(w.Body.String(), "@example.test") || strings.Contains(w.Body.String(), "gravatar.com") {
			t.Fatalf("Email leaked: %s", w.Body.String())
		}
	}
	base := "/api/client/servers/" + str(server["uuid_short"])
	invited := request(num(owner["id"]), "POST", base+"/users", M{"username": "private-player", "permissions": []string{"file.read", "activity.read"}})
	safe(invited)
	if !strings.Contains(invited.Body.String(), "Chosen player") {
		t.Fatal("Invitation response omitted chosen name")
	}
	safe(request(num(person["id"]), "GET", base+"/activity?include=actor", nil))
	safe(request(num(owner["id"]), "GET", base+"/users", nil))
	safe(request(num(owner["id"]), "GET", "/api/admin/users", nil))
	safe(request(num(owner["id"]), "GET", "/api/application/users/"+str(person["id"]), nil))
	safe(request(num(owner["id"]), "PATCH", "/api/admin/users/"+str(person["id"]), M{"nickname": "Updated name"}))
	stored, err := a.one(t.Context(), "SELECT email,nickname FROM users WHERE id=$1", person["id"])
	if err != nil || stored["email"] != person["email"] || stored["nickname"] != "Updated name" {
		t.Fatal("Unrelated account fields changed")
	}
	own := request(num(person["id"]), "GET", "/api/client/account", nil)
	if own.Code != 200 || !strings.Contains(own.Body.String(), str(person["email"])) {
		t.Fatal("Own account email is unavailable")
	}
	if err := a.audit(t.Context(), num(person["id"]), num(server["id"]), "server:subuser.update", M{"email": person["email"], "nested": []any{M{"address": person["email"]}}}); err != nil {
		t.Fatal(err)
	}
	safe(request(num(owner["id"]), "GET", base+"/activity?include=actor", nil))
	missing := request(num(owner["id"]), "POST", base+"/users", M{"username": "missing-player", "permissions": []string{"file.read"}})
	if missing.Code != 422 {
		t.Fatal("Unknown username was not refused")
	}
}
