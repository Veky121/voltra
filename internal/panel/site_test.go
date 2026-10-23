package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestClientSiteSettingsReflectConfigurationWithoutSecrets(t *testing.T) {
	a, _, _ := infraTestApp(t)
	ctx := context.Background()
	user, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "site_reader", "email": "site-reader@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	settings := M{"app:name": "Private games", "app:locale": "de", "app:timezone": "Europe/Berlin", "mail:password": "private-smtp-value", "backups.s3": M{"secret_access_key": "private-s3-value"}}
	for key, value := range settings {
		encoded, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = a.DB.Exec(ctx, "INSERT INTO settings(key,value) VALUES($1,$2)", key, encoded); err != nil {
			t.Fatal(err)
		}
	}
	status, response, raw := infraRequest(t, http.HandlerFunc(a.clientSiteSettings), num(user["id"]), "GET", "/api/client/settings", nil)
	attributes := asMap(response["attributes"])
	if status != 200 || attributes["name"] != "Private games" || attributes["locale"] != "de" || attributes["timezone"] != "Europe/Berlin" {
		t.Fatalf("site settings: %d %#v", status, attributes)
	}
	if len(attributes) != 3 || strings.Contains(raw, "private-smtp") || strings.Contains(raw, "private-s3") {
		t.Fatal("operational settings exposed to client")
	}
}
