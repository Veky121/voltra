package panel

import (
	"strings"
	"testing"
)

func openttdFieldsFixture(t *testing.T) M {
	t.Helper()
	for _, entry := range gameTemplates().Entries {
		if entry.Path == "openttd/egg-open-t-t-d-server.json" {
			return M{"uuid": gameTemplateEggUUID(entry), "startup": entry.Egg["startup"]}
		}
	}
	t.Fatal("OpenTTD recipe missing")
	return nil
}
func TestOpenTTDSecretsDocumentPrivacy(t *testing.T) {
	egg := openttdFieldsFixture(t)
	data := []byte("; operator comment\r\n[network]\r\nserver_password = fixture-password\r\nclient_secret_key = fixture-key\r\nclient_public_key = public-key\r\nserver_invite_code = invite\r\nserver_invite_code_secret = invite-secret\r\nFutureCredential = future\r\n[version]\r\nversion_string = 15.3\r\n")
	parsed, err := parseGameSettings("/secrets.cfg", data)
	if err != nil {
		t.Fatal(err)
	}
	parsed = openttdSettingsFields(egg, "/secrets.cfg", parsed)
	for _, f := range parsed.fields {
		if strings.HasPrefix(strings.ToLower(gameSettingsINIFold(f.key)), "network/") && !f.secret {
			t.Fatal("secret section not masked", f.key)
		}
		if f.key != "network/server_password" && f.kind != "readonly" {
			t.Fatal("generated metadata editable", f.key)
		}
	}
	changes, err := gameSettingsChanges(parsed.fields, M{"network/server_password": "changed-fixture"}, egg, "/secrets.cfg")
	if err != nil {
		t.Fatal(err)
	}
	patched, err := parsed.patch(changes)
	if err != nil {
		t.Fatal(err)
	}
	if string(patched) != strings.Replace(string(data), "fixture-password", "changed-fixture", 1) {
		t.Fatal("unrelated private bytes changed")
	}
	if _, err := gameSettingsChanges(parsed.fields, M{"network/server_invite_code": "replacement"}, egg, "/secrets.cfg"); err == nil {
		t.Fatal("generated invite code editable")
	}
	for _, scope := range []struct {
		egg  M
		file string
	}{{M{"name": "OpenTTD"}, "/secrets.cfg"}, {egg, "/other.cfg"}, {egg, "/private.cfg"}} {
		raw, _ := parseGameSettings(scope.file, []byte("[network]\nserver_invite_code = public-fixture\n"))
		before := raw.fields[0]
		after := openttdSettingsFields(scope.egg, scope.file, raw).fields[0]
		if before != after {
			t.Fatal("unrelated scope changed")
		}
	}
}
