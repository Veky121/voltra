package panel

import (
	"bytes"
	"testing"
)

func TestTShockNativeSafetyActualSchema(t *testing.T) {
	data := []byte(`{"Settings":{"MySqlConnectionString":"Server=host;Password=opaque","PostgresConnectionString":"postgres://user:opaque@host/db","SqliteConnectionString":"Data Source=local;Password=opaque","EnableTokenEndpointAuthentication":true,"ApiToken":"opaque","LogPath":"/home/container/logs","ServerName":"Before"},"Unknown":{"Keep":[1,2]}}`)
	parsed, err := parseGameSettings("/tshock/config.json", data)
	if err != nil {
		t.Fatal(err)
	}
	parsed = tshockNativeSettingsSafety("/tshock/config.json", parsed)
	for _, field := range parsed.fields {
		switch field.key {
		case "/Settings/MySqlConnectionString", "/Settings/PostgresConnectionString", "/Settings/SqliteConnectionString", "/Settings/ApiToken":
			if !field.secret && !gameSettingSecret.MatchString(field.key) {
				t.Fatalf("credential not protected: %s", field.key)
			}
		case "/Settings/EnableTokenEndpointAuthentication":
			if field.secret || field.kind != "boolean" || field.on != "true" || field.off != "false" {
				t.Fatalf("actual bool not restored: %+v", field)
			}
		case "/Settings/LogPath":
			if field.kind != "readonly" {
				t.Fatal("managed path writable")
			}
		}
	}
	if _, err = parsed.patch(map[string]string{"/Settings/LogPath": "/tmp/unsafe"}); err == nil {
		t.Fatal("managed patch accepted")
	}
	if _, err = parsed.patch(map[string]string{"/Settings/EnableTokenEndpointAuthentication": "not boolean"}); err == nil {
		t.Fatal("invalid bool accepted")
	}
	if _, err = parsed.patch(map[string]string{"/Settings/Missing": "unknown"}); err == nil {
		t.Fatal("unknown patch accepted")
	}
	updated, err := parsed.patch(map[string]string{"/Settings/EnableTokenEndpointAuthentication": "false"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(updated, []byte(`"EnableTokenEndpointAuthentication": false`)) || !bytes.Contains(updated, []byte("opaque")) {
		t.Fatalf("boolean/unknown data lost: %s", updated)
	}
}

func TestTShockNativeSafetyManagedProperties(t *testing.T) {
	data := []byte("# operator comment\r\nworld=/home/container/saves/Worlds/operator.wld\r\nWorldPath=/home/container/saves/Worlds\r\nupnp=0\r\nmaxplayers=8\r\nunknown=keep exact\r\n")
	parsed, err := parseGameSettings("/serverconfig.txt", data)
	if err != nil {
		t.Fatal(err)
	}
	parsed = tshockNativeSettingsSafety("/serverconfig.txt", parsed)
	for _, key := range []string{"world", "WorldPath", "upnp"} {
		if _, err = parsed.patch(map[string]string{key: "unsafe"}); err == nil {
			t.Fatalf("managed %s accepted", key)
		}
	}
	out, err := parsed.patch(map[string]string{"maxplayers": "9"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, bytes.Replace(data, []byte("maxplayers=8"), []byte("maxplayers=9"), 1)) {
		t.Fatal("unrelated properties changed")
	}
}

func TestTShockNativeSafetyNeverUnmasksStringOrOtherDocument(t *testing.T) {
	for _, file := range []string{"/tshock/config.json", "/other/config.json"} {
		parsed, err := parseGameSettings(file, []byte(`{"Settings":{"EnableTokenEndpointAuthentication":"opaque"}}`))
		if err != nil {
			t.Fatal(err)
		}
		parsed = tshockNativeSettingsSafety(file, parsed)
		if len(parsed.fields) != 1 || (!parsed.fields[0].secret && !gameSettingSecret.MatchString(parsed.fields[0].key)) || parsed.fields[0].kind != "text" {
			t.Fatal("arbitrary token string unmasked")
		}
	}
}
