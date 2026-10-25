package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOutboundMailRemoved(t *testing.T) {
	a, handler, user := infraTestApp(t)
	ctx := context.Background()
	// Simulate a previous installation, then apply the normal schema upgrade.
	if _, err := a.DB.Exec(ctx, `CREATE TABLE notification_jobs (id bigint);
	 INSERT INTO notification_jobs VALUES (1);
	 INSERT INTO settings(key,value) VALUES ('mail:password','"obsolete"'),('pterodactyl:email:send_install_notification','true'),('app:name','"Keep panel"');`); err != nil {
		t.Fatal(err)
	}
	if _, err := a.DB.Exec(ctx, schema); err != nil {
		t.Fatal(err)
	}
	var queueExists bool
	if err := a.DB.QueryRow(ctx, "SELECT to_regclass('notification_jobs') IS NOT NULL").Scan(&queueExists); err != nil || queueExists {
		t.Fatalf("obsolete queue survived upgrade: %v %v", queueExists, err)
	}
	var count int
	if err := a.DB.QueryRow(ctx, "SELECT count(*) FROM settings WHERE key LIKE 'mail:%' OR key LIKE 'pterodactyl:email:%'").Scan(&count); err != nil || count != 0 {
		t.Fatalf("obsolete mail configuration survived upgrade: %d %v", count, err)
	}
	settings := asMap(infraExpect(t, handler, user, "GET", "/api/admin/settings", nil, 200)["attributes"])
	if settings["app:name"] != "Keep panel" {
		t.Fatal("upgrade changed panel settings")
	}
	account, err := a.one(ctx, "SELECT email,root_admin FROM users WHERE id=$1", user)
	if err != nil || account["email"] != "infra-admin@example.invalid" || !boolean(account["root_admin"]) {
		t.Fatalf("upgrade changed account identity: %v %v", account, err)
	}
	for key := range settings {
		if outboundMailSetting(key) {
			t.Fatalf("mail setting remains available: %s", key)
		}
	}
	for _, key := range []string{"mail:host", "mail:password", "pterodactyl:email:send_install_notification"} {
		infraExpect(t, handler, user, "PATCH", "/api/admin/settings", M{key: "obsolete"}, 422)
	}
	for _, route := range []struct{ method, path string }{
		{"POST", "/api/admin/settings/mail/test"},
		{"GET", "/api/admin/notifications"},
		{"POST", "/api/admin/notifications/1/retry"},
	} {
		r := WithUser(httptest.NewRequest(route.method, route.path, nil), user)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != http.StatusNotFound {
			t.Fatalf("removed endpoint %s returned %d", route.path, w.Code)
		}
	}
	// Old transport secrets must never reappear in a portable snapshot,
	// including credentials that can no longer be decrypted.
	if err := a.exec(ctx, `INSERT INTO settings(key,value) VALUES ('mail:password','"enc:v1:broken"')`); err != nil {
		t.Fatal(err)
	}
	var exported bytes.Buffer
	if err := a.ExportSnapshot(ctx, &exported); err != nil {
		t.Fatal(err)
	}
	var snapshot LegacySnapshot
	if err := json.Unmarshal(exported.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if _, ok := snapshot.Tables["notification_jobs"]; ok {
		t.Fatal("obsolete queue was exported")
	}
	for _, row := range snapshot.Tables["settings"] {
		if outboundMailSetting(str(row["key"])) {
			t.Fatal("obsolete mail configuration was exported")
		}
	}
}

func TestOutboundMailCommandRemoved(t *testing.T) {
	a := &App{}
	var output bytes.Buffer
	if err := a.RunCommand(context.Background(), []string{"p:environment:mail"}, &output); err == nil {
		t.Fatal("removed mail command still available")
	}
	output.Reset()
	if err := a.RunCommand(context.Background(), []string{"help"}, &output); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(output.String(), "p:environment:mail") {
		t.Fatal("removed mail command still advertised")
	}
}
