package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestSFTPPasswordValidation(t *testing.T) {
	for _, p := range []any{nil, 123, "", "short", strings.Repeat("x", 73), strings.Repeat("界", 25)} {
		if _, err := hashSFTPPassword(p); err == nil {
			t.Fatal("invalid password accepted")
		}
	}
	password := "correct SFTP password"
	hash, err := hashSFTPPassword(password)
	if err != nil || hash == password || !validSFTPPassword(hash, password) || validSFTPPassword(hash, "wrong") || validSFTPPassword("", password) {
		t.Fatal("password verification failed")
	}
	if cost, _ := bcrypt.Cost([]byte(hash)); cost != 12 {
		t.Fatal("unexpected password hash cost")
	}
	for _, attrs := range []M{accountAttributes(M{"sftp_password_hash": hash}), userAttributes(M{"sftp_password_hash": hash})} {
		raw, _ := json.Marshal(attrs)
		if attrs["sftp_password_set"] != true || strings.Contains(string(raw), hash) || strings.Contains(string(raw), "password_hash") {
			t.Fatal("password hash exposed or status missing")
		}
	}
}

func TestSFTPPasswordManagementAndServerAccess(t *testing.T) {
	a := cliTestApp(t)
	ctx := context.Background()
	insert := func(table string, data M) M {
		t.Helper()
		row, err := a.insert(ctx, table, data)
		if err != nil {
			t.Fatal(err)
		}
		return row
	}
	admin := insert("users", M{"uuid": newUUID(), "username": "sftp-admin", "email": "admin@example.test", "root_admin": true})
	u := insert("users", M{"uuid": newUUID(), "username": "sftp-user", "email": "user@example.test"})
	other := insert("users", M{"uuid": newUUID(), "username": "sftp-other", "email": "other@example.test"})
	mux := http.NewServeMux()
	a.registerAccounts(mux)
	mux.HandleFunc("POST /api/remote/sftp/auth", a.remoteSFTP)
	request := func(actor int64, method, path string, body M, token string) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(body)
		r := WithUser(httptest.NewRequest(method, path, strings.NewReader(string(raw))), actor)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	expect := func(actor int64, method, path string, body M, token string, status int) *httptest.ResponseRecorder {
		t.Helper()
		w := request(actor, method, path, body, token)
		if w.Code != status {
			t.Fatalf("%s %s: got %d, want %d: %s", method, path, w.Code, status, w.Body.String())
		}
		return w
	}
	self := "/api/client/account/sftp-password"
	reset := "/api/admin/users/" + str(u["id"]) + "/sftp-password"
	p1, p2, p3 := "first SFTP password", "second SFTP password", "admin replacement password"
	expect(0, "PUT", self, M{"password": p1}, "", 401)
	expect(num(u["id"]), "PUT", self, M{"password": "short"}, "", 422)
	expect(num(u["id"]), "PUT", self, M{"password": p1, "user_id": other["id"]}, "", 204)
	stored, _ := a.one(ctx, "SELECT * FROM users WHERE id=$1", u["id"])
	untouched, _ := a.one(ctx, "SELECT * FROM users WHERE id=$1", other["id"])
	if str(stored["password_hash"]) != "" || !validSFTPPassword(str(stored["sftp_password_hash"]), p1) || str(untouched["sftp_password_hash"]) != "" {
		t.Fatal("password isolation failed")
	}
	expect(num(u["id"]), "PUT", self, M{"password": p2}, "", 403)
	expect(num(u["id"]), "PUT", self, M{"password": p2, "current_password": "wrong password"}, "", 403)
	expect(num(u["id"]), "PUT", self, M{"password": p2, "current_password": p1}, "", 204)
	expect(num(u["id"]), "PUT", reset, M{"password": p3}, "", 403)
	expect(num(admin["id"]), "PUT", reset, M{"password": ""}, "", 422)
	expect(num(admin["id"]), "PUT", reset, M{"password": p3}, "", 204)
	stored, _ = a.one(ctx, "SELECT * FROM users WHERE id=$1", u["id"])
	if validSFTPPassword(str(stored["sftp_password_hash"]), p2) || !validSFTPPassword(str(stored["sftp_password_hash"]), p3) {
		t.Fatal("reset did not replace password")
	}
	for _, path := range []string{"/api/client/account", "/api/admin/users/" + str(u["id"])} {
		w := expect(num(admin["id"]), "GET", path, nil, "", 200)
		if strings.Contains(w.Body.String(), str(stored["sftp_password_hash"])) {
			t.Fatal("hash exposed")
		}
	}
	location := insert("locations", M{"short": "sftp"})
	sealed, err := a.seal("sftp-test-secret")
	if err != nil {
		t.Fatal(err)
	}
	node := insert("nodes", M{"uuid": newUUID(), "name": "SFTP", "fqdn": "localhost", "location_id": location["id"], "daemon_token_id": "sftp-test", "daemon_token": sealed})
	nest := insert("nests", M{"uuid": newUUID(), "author": "test@example.test", "name": "SFTP"})
	egg := insert("eggs", M{"uuid": newUUID(), "nest_id": nest["id"], "author": "test@example.test", "name": "SFTP"})
	server := insert("servers", M{"uuid": newUUID(), "uuid_short": "aabbccdd", "identifier": "aabbccdd", "name": "SFTP", "owner_id": admin["id"], "node_id": node["id"], "nest_id": nest["id"], "egg_id": egg["id"], "image": "alpine"})
	credentials := M{"type": "password", "username": "sftp-user.aabbccdd", "password": p3}
	auth := func(status int) *httptest.ResponseRecorder {
		t.Helper()
		return expect(0, "POST", "/api/remote/sftp/auth", credentials, "sftp-test.sftp-test-secret", status)
	}
	expect(0, "POST", "/api/remote/sftp/auth", credentials, "invalid.token", 403)
	auth(403)
	sub := insert("subusers", M{"user_id": u["id"], "server_id": server["id"], "permissions": []string{"file.read"}})
	auth(403)
	if _, err = a.update(ctx, "subusers", num(sub["id"]), M{"permissions": []string{"file.sftp", "file.read"}}); err != nil {
		t.Fatal(err)
	}
	w := auth(200)
	var response M
	_ = json.Unmarshal(w.Body.Bytes(), &response)
	if response["server"] != server["uuid"] || response["user"] != u["uuid"] || len(asSlice(response["permissions"])) != 2 {
		t.Fatal("incorrect Wings identity or permissions")
	}
	credentials["password"] = p2
	auth(403)
	credentials["password"] = p3
	if _, err = a.update(ctx, "users", num(u["id"]), M{"disabled": true}); err != nil {
		t.Fatal(err)
	}
	auth(403)
	if _, err = a.update(ctx, "users", num(u["id"]), M{"disabled": false}); err != nil {
		t.Fatal(err)
	}
	if _, err = a.update(ctx, "servers", num(server["id"]), M{"status": "suspended"}); err != nil {
		t.Fatal(err)
	}
	auth(403)
	if _, err = a.update(ctx, "servers", num(server["id"]), M{"status": nil}); err != nil {
		t.Fatal(err)
	}
	if err = a.exec(ctx, "DELETE FROM subusers WHERE id=$1", sub["id"]); err != nil {
		t.Fatal(err)
	}
	auth(403)
	for i := 0; i < 20; i++ {
		if err = a.sftpPasswordAttempt(ctx, "rate-test"); err != nil {
			t.Fatal(err)
		}
	}
	if err = a.sftpPasswordAttempt(ctx, "rate-test"); err == nil {
		t.Fatal("password attempts not limited")
	}
}
