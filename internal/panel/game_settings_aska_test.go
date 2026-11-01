package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestASKASettingsAPI(t *testing.T) {
	a, mux, admin, server, f := quickSetupMinecraftFixture(t)
	for _, entry := range gameTemplates().Entries {
		if entry.Path != "Aska/egg-aska.json" {
			continue
		}
		ctx := context.Background()
		if _, err := a.update(ctx, "eggs", num(server["egg_id"]), M{"uuid": gameTemplateEggUUID(entry), "startup": entry.Egg["startup"], "config_files": M{}, "java_config": M{}}); err != nil {
			t.Fatal(err)
		}
		allocation, err := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 29371})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = a.update(ctx, "servers", num(server["id"]), M{"startup": entry.Egg["startup"], "allocation_id": allocation["id"]}); err != nil {
			t.Fatal(err)
		}
		script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
		for _, chunk := range strings.Split(script, "cat > ")[1:] {
			head, body, ok := strings.Cut(chunk, "\n")
			if !ok {
				continue
			}
			name, marker, ok := strings.Cut(head, " <<'")
			if !ok || !strings.HasPrefix(name, ".voltra/") {
				continue
			}
			emitted, _, ok := strings.Cut(body, "\n"+strings.TrimSuffix(marker, "'")+"\n")
			if !ok {
				t.Fatal("invalid canonical helper emission")
			}
			f.Files["/"+name] = []byte(emitted + "\n")
		}
		original := ";keep\r\nserver name = Before\r\npassword = secret-sentinel\r\nauthentication token = token-sentinel\r\nkeep server world alive = true\r\nsave id = operator\r\n"
		f.mu.Lock()
		f.Files[askaSettingsPath], f.State = []byte(original), "offline"
		f.mu.Unlock()
		endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=%2Fserver%20properties.txt"
		view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
		encoded, _ := json.Marshal(view)
		if strings.Contains(string(encoded), "secret-sentinel") || strings.Contains(string(encoded), "token-sentinel") || len(asSlice(view["fields"])) != 4 {
			t.Fatal("literal fields or secret masking failed")
		}
		infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"server name": "After #;= literal", "keep server world alive": false}}, 200)
		f.mu.Lock()
		updated := string(f.Files[askaSettingsPath])
		f.mu.Unlock()
		want := strings.Replace(strings.Replace(original, "Before", "After #;= literal", 1), "= true", "= false", 1)
		if updated != want {
			t.Fatalf("unexpected native bytes: %q", updated)
		}
		return
	}
	t.Fatal("missing ASKA recipe")
}

func TestASKALiteralSettingsRoundTrip(t *testing.T) {
	data := []byte("\ufeff;keep\r\nserver name = Old\r\npassword = \"literal#;=value\"\r\nkeep server world alive = true\r\nsave id = unknown\r\n")
	p, err := parseASKASettings(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 3 || p.fields[1].value != "\"literal#;=value\"" {
		t.Fatalf("literal parsing: %#v", p.fields)
	}
	updated, err := p.patch(map[string]string{"server name": "New #;= name", "keep server world alive": "false"})
	if err != nil {
		t.Fatal(err)
	}
	want := bytes.Replace(data, []byte("Old"), []byte("New #;= name"), 1)
	want = bytes.Replace(want, []byte("= true"), []byte("= false"), 1)
	if !bytes.Equal(updated, want) {
		t.Fatalf("unrelated bytes changed: %q", updated)
	}
	if _, err = parseASKASettings(updated); err != nil {
		t.Fatal(err)
	}
	for _, change := range []map[string]string{{"server name": "bad\nkey=value"}, {"save id": "overwrite"}, {"keep server world alive": "1"}} {
		if _, err := p.patch(change); err == nil {
			t.Fatal("unsafe patch accepted")
		}
	}
}

func TestASKAAmbiguityAndDispatch(t *testing.T) {
	for _, data := range []string{"password=a\npassword=b", "Password=a", "keep server world alive=1", "password=bad\x00value"} {
		if _, err := parseASKASettings([]byte(data)); err == nil {
			t.Fatalf("accepted %q", data)
		}
	}
	for _, entry := range gameTemplates().Entries {
		if entry.Path != "Aska/egg-aska.json" {
			continue
		}
		egg := M{"uuid": gameTemplateEggUUID(entry), "_campaign_parser_path": askaSettingsPath}
		p, err := parseGameSettingsForEgg(egg, askaSettingsPath, []byte("server name = Spaced Name\npassword = literal#value\n"))
		if err != nil || len(p.fields) != 2 || p.fields[0].key != "server name" {
			t.Fatalf("dispatch failed: %v %#v", err, p.fields)
		}
		if !strings.Contains(p.fields[1].value, "#") {
			t.Fatal("INI comment rules applied")
		}
		return
	}
	t.Fatal("missing ASKA recipe")
}

// The editor must not publish values refused by the startup preflight.
func TestASKAPreflightParity(t *testing.T) {
	original := []byte("server name = retain\r\nauthentication token = fixture-token\r\nkeep server world alive = false\r\n")
	p, err := parseASKASettings(original)
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"", " ", "\t", "\u00a0", string([]byte{0xff})} {
		if _, err := p.patch(map[string]string{"authentication token": value}); err == nil {
			t.Fatal("accepted invalid token")
		}
	}
	for _, value := range [][]byte{[]byte("server name = \xff\n"), []byte("authentication token = \u00a0\n")} {
		if _, err := parseASKASettings(value); err == nil {
			t.Fatal("accepted invalid native document")
		}
	}
	preserved, err := p.patch(map[string]string{})
	if err != nil || !bytes.Equal(preserved, original) {
		t.Fatal("refusal changed native document")
	}
}
