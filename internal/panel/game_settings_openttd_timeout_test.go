package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestOpenTTDPublicTimeoutTypesAndScope(t *testing.T) {
	egg := openttdFieldsFixture(t)
	for _, value := range []string{"0", "2000", "32000", "-1", "32001", "1.5", "02000", "invalid"} {
		parsed, err := parseGameSettingsForEgg(egg, "/openttd.cfg", []byte("[network]\nmax_password_time = "+value+"\n"))
		if err != nil {
			t.Fatal(err)
		}
		field := parsed.fields[0]
		valid := openttdTimeoutValue(value)
		if openttdPublicNumericField(egg, "/openttd.cfg", field) != valid {
			t.Fatal("timeout classification", value)
		}
		if !valid && field.kind != "readonly" {
			t.Fatal("malformed native timeout is writable", value)
		}
	}
	for _, scope := range []struct {
		egg  M
		file string
		key  string
	}{{M{"name": "OpenTTD"}, "/openttd.cfg", "network/max_password_time"}, {egg, "/secrets.cfg", "network/max_password_time"}, {egg, "/openttd.cfg", "network/server_password"}} {
		if openttdPublicNumericField(scope.egg, scope.file, gameSetting{key: scope.key, kind: "number", value: "2000"}) {
			t.Fatal("public exception widened")
		}
	}
}

func TestOpenTTDPublicTimeoutAPI(t *testing.T) {
	a, mux, admin, server, f := quickSetupMinecraftFixture(t)
	egg := openttdFieldsFixture(t)
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), M{"uuid": egg["uuid"], "startup": egg["startup"], "config_files": M{}}); err != nil {
		t.Fatal(err)
	}
	original := ";operator\r\n[network]\r\nmax_password_time = 2000 ;frames\r\nserver_password = fixture-private-value\r\n[unknown]\r\nkeep = operator\r\n"
	f.mu.Lock()
	delete(f.Files, "/server.properties")
	f.Files["/openttd.cfg"] = []byte(original)
	f.State = "offline"
	f.mu.Unlock()
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=%2Fopenttd.cfg"
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	field := laneGameSettingsField(view, "network/max_password_time")
	if field["type"] != "number" || field["value"] != "2000" || boolean(field["secret"]) || boolean(field["readonly"]) {
		t.Fatal("public numeric timeout masked or mistyped")
	}
	body, _ := json.Marshal(view)
	if strings.Contains(string(body), "fixture-private-value") || !boolean(laneGameSettingsField(view, "network/server_password")["secret"]) {
		t.Fatal("real credential protection regressed")
	}
	for _, value := range []string{"-1", "32001", "1.5", "02000"} {
		infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"network/max_password_time": value}}, 422)
	}
	f.mu.Lock()
	unchanged := string(f.Files["/openttd.cfg"]) == original
	f.mu.Unlock()
	if !unchanged {
		t.Fatal("invalid timeout mutated bytes")
	}
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"network/max_password_time": "2001"}}, 200)
	f.mu.Lock()
	updated := string(f.Files["/openttd.cfg"])
	f.mu.Unlock()
	if updated != strings.Replace(original, "2000 ;frames", "2001 ;frames", 1) {
		t.Fatal("timeout patch changed credentials/unknown bytes")
	}
}
