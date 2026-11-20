package gamesettings

import (
	"bytes"
	"testing"
)

func TestTShockNativeSafetyActualSchema(t *testing.T) {
	data := []byte(`{"Settings":{"MySqlConnectionString":"Server=host;Password=opaque","PostgresConnectionString":"postgres://user:opaque@host/db","SqliteConnectionString":"Data Source=local;Password=opaque","EnableTokenEndpointAuthentication":true,"ApiToken":"opaque","LogPath":"/home/container/logs","ServerName":"Before"},"Unknown":{"Keep":[1,2]}}`)
	parsed, err := Parse("/tshock/config.json", data)
	if err != nil {
		t.Fatal(err)
	}
	parsed = tshockNativeSettingsSafety("/tshock/config.json", parsed)
	for _, field := range parsed.Fields {
		switch field.Key {
		case "/Settings/MySqlConnectionString", "/Settings/PostgresConnectionString", "/Settings/SqliteConnectionString", "/Settings/ApiToken":
			if !field.Secret && !SettingSecret.MatchString(field.Key) {
				t.Fatalf("credential not protected: %s", field.Key)
			}
		case "/Settings/EnableTokenEndpointAuthentication":
			if field.Secret || field.Kind != "boolean" || field.On != "true" || field.Off != "false" {
				t.Fatalf("actual bool not restored: %+v", field)
			}
		case "/Settings/LogPath":
			if field.Kind != "readonly" {
				t.Fatal("managed path writable")
			}
		}
	}
	if _, err = parsed.Patch(map[string]string{"/Settings/LogPath": "/tmp/unsafe"}); err == nil {
		t.Fatal("managed patch accepted")
	}
	if _, err = parsed.Patch(map[string]string{"/Settings/EnableTokenEndpointAuthentication": "not boolean"}); err == nil {
		t.Fatal("invalid bool accepted")
	}
	if _, err = parsed.Patch(map[string]string{"/Settings/Missing": "unknown"}); err == nil {
		t.Fatal("unknown patch accepted")
	}
	updated, err := parsed.Patch(map[string]string{"/Settings/EnableTokenEndpointAuthentication": "false"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(updated, []byte(`"EnableTokenEndpointAuthentication": false`)) || !bytes.Contains(updated, []byte("opaque")) {
		t.Fatalf("boolean/unknown data lost: %s", updated)
	}
}

func TestTShockNativeSafetyManagedProperties(t *testing.T) {
	data := []byte("# operator comment\r\nworld=/home/container/saves/Worlds/operator.wld\r\nWorldPath=/home/container/saves/Worlds\r\nupnp=0\r\nmaxplayers=8\r\nunknown=keep exact\r\n")
	parsed, err := Parse("/serverconfig.txt", data)
	if err != nil {
		t.Fatal(err)
	}
	parsed = tshockNativeSettingsSafety("/serverconfig.txt", parsed)
	for _, key := range []string{"world", "WorldPath", "upnp"} {
		if _, err = parsed.Patch(map[string]string{key: "unsafe"}); err == nil {
			t.Fatalf("managed %s accepted", key)
		}
	}
	out, err := parsed.Patch(map[string]string{"maxplayers": "9"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, bytes.Replace(data, []byte("maxplayers=8"), []byte("maxplayers=9"), 1)) {
		t.Fatal("unrelated properties changed")
	}
}

func TestTShockNativeSafetyNeverUnmasksStringOrOtherDocument(t *testing.T) {
	for _, file := range []string{"/tshock/config.json", "/other/config.json"} {
		parsed, err := Parse(file, []byte(`{"Settings":{"EnableTokenEndpointAuthentication":"opaque"}}`))
		if err != nil {
			t.Fatal(err)
		}
		parsed = tshockNativeSettingsSafety(file, parsed)
		if len(parsed.Fields) != 1 || (!parsed.Fields[0].Secret && !SettingSecret.MatchString(parsed.Fields[0].Key)) || parsed.Fields[0].Kind != "text" {
			t.Fatal("arbitrary token string unmasked")
		}
	}
}
