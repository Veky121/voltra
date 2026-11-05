package panel

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWave166BeamMPEditor(t *testing.T) {
	recipe := "beamng/beammp/egg-beam-m-p-server.json"
	a, mux, admin, server, f := quickSetupMinecraftFixture(t)
	ctx := context.Background()
	al, e := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 30814})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = a.update(ctx, "servers", num(server["id"]), M{"allocation_id": al["id"]}); e != nil {
		t.Fatal(e)
	}
	var egg M
	for _, entry := range gameTemplates().Entries {
		if entry.Path == recipe {
			egg = M{"uuid": gameTemplateEggUUID(entry), "startup": entry.Egg["startup"], "config_files": entry.Egg["config_files"]}
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
				expected, _, ok := strings.Cut(body, "\n"+strings.TrimSuffix(marker, "'")+"\n")
				if ok {
					f.Files["/"+name] = []byte(expected + "\n")
				}
			}
		}
	}
	egg["features"] = []any{}
	egg["java_config"] = M{}
	if egg == nil {
		t.Fatal("missing recipe")
	}
	if _, e := a.update(ctx, "eggs", num(server["egg_id"]), egg); e != nil {
		t.Fatal(e)
	}
	if _, e := a.update(ctx, "servers", num(server["id"]), M{"startup": egg["startup"]}); e != nil {
		t.Fatal(e)
	}
	file, key, port, original := "/ServerConfig.toml", "General/Name", "General/Port", "[General]\nName=\"Before\"\nAuthKey=\"fixture-secret\"\nPort=30814\n"
	if strings.Contains(recipe, "kissmp") {
		file, key, port, original = "/config.json", "/server_name", "/port", `{"server_name":"Before","port":3698,"unknown":9007199254740993}`
	}
	f.Files[file] = []byte(original)
	f.State = "offline"
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + url.QueryEscape(file)

	_ = key
	_ = port
	original = "[General]\r\nName=\"Before\" # retained\r\nPrivate=true\r\nMaxPlayers=6\r\nMaxCars=1\r\nAuthKey=\"fixture-secret\"\r\nPassword=\"fixture-password\"\r\nPort=30814\r\nResourceFolder=\"Resources\"\r\nUnknown=9007199254740993 # opaque\r\n"
	f.Files[file] = []byte(original)
	if dir := os.Getenv("WAVE166_EMITTED"); dir != "" {
		for name, b := range f.Files {
			if strings.HasPrefix(name, "/.voltra/") {
				if e := os.WriteFile(filepath.Join(dir, filepath.Base(name)), b, 0600); e != nil {
					t.Fatal(e)
				}
			}
		}
	}
	baseline := os.Getenv("WAVE166_BASELINE") == "1"
	for _, v := range []string{"101", "1.5"} {
		view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
		want := 422
		if baseline {
			want = 200
		}
		w := f.Writes
		infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"General/MaxPlayers": v}}, want)
		if !baseline && f.Writes != w {
			t.Fatal("refusal wrote")
		}
		f.Files[file] = []byte(original)
	}

	// Reproduce the reviewed unchanged-invalid-state gap over the actual handler.
	f.Files[file] = []byte(strings.Replace(original, "MaxPlayers=6", "MaxPlayers=101", 1))
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	w := f.Writes
	want := 422
	if baseline {
		want = 200
	}
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"General/Name": "Gap"}}, want)
	if !baseline && f.Writes != w {
		t.Fatal("effective refusal wrote")
	}
	if baseline {
		return
	}
	view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"General/Name": "Repair", "General/MaxPlayers": "100"}}, 200)
	if !strings.Contains(string(f.Files[file]), "Unknown=9007199254740993 # opaque\r\n") {
		t.Fatal("repair altered unknown")
	}
	for _, replacement := range []struct{ before, after string }{
		{"AuthKey=\"fixture-secret\"", "AuthKey=\"\""}, {"Private=true", "Private=1"}, {"ResourceFolder=\"Resources\"", "ResourceFolder=\"../escape\""}, {"ResourceFolder=\"Resources\"", "ResourceFolder=\"/absolute\""}, {"MaxPlayers=6", "MaxPlayers=1.5"}, {"Port=30814", "Port=true"}, {"MaxCars=1", "MaxCars=11"},
	} {
		f.Files[file] = []byte(strings.Replace(original, replacement.before, replacement.after, 1))
		v := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
		w := f.Writes
		infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": v["revision"], "settings": M{"General/Name": "Denied"}}, 422)
		if f.Writes != w {
			t.Fatal("invalid effective state wrote")
		}
	}
	// A real server environment seed must repair absence, never replace native state.
	_, e = a.insert(ctx, "egg_variables", M{"egg_id": server["egg_id"], "name": "Key", "env_variable": "AUTHKEY", "default_value": "valid-seed", "user_viewable": true, "user_editable": true, "rules": "string", "field_type": "text"})
	if e != nil {
		t.Fatal(e)
	}
	f.Files[file] = []byte(strings.Replace(original, "AuthKey=\"fixture-secret\"\r\n", "", 1))
	view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"General/Name": "Seeded"}}, 200)
	f.Files[file] = []byte("\xef\xbb\xbf" + original)
	for _, value := range []bool{false, true} {
		view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
		infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"General/Private": value}}, 200)
	}
	if !strings.HasPrefix(string(f.Files[file]), "\xef\xbb\xbf") || !strings.Contains(string(f.Files[file]), "Private=true\r\n") {
		t.Fatal("BOM or boolean native type lost")
	}
	f.Files[file] = []byte(original)

	masked := infraExpect(t, mux, admin, "GET", endpoint, nil, 200)
	b, _ := json.Marshal(masked)
	if strings.Contains(string(b), "fixture-secret") || strings.Contains(string(b), "fixture-password") {
		t.Fatal("credential exposed")
	}

	for _, c := range []struct{ k, v string }{{"MaxPlayers", "0"}, {"MaxCars", "11"}, {"Private", "yes"}, {"Name", "bad\x01"}, {"Name", strings.Repeat("x", 1025)}, {"Port", "31000"}, {"ResourceFolder", "../escape"}, {"Unknown", "3"}} {
		view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
		w := f.Writes
		infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"General/" + c.k: c.v}}, 422)
		if f.Writes != w {
			t.Fatal("negative wrote")
		}
	}
	for _, c := range []struct{ k, v string }{{"Name", "After"}, {"Private", "false"}, {"MaxPlayers", "100"}} {
		view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
		infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"General/" + c.k: func() any {
			if c.k == "Private" {
				return false
			}
			return c.v
		}()}}, 200)
	}
	if !strings.Contains(string(f.Files[file]), "Unknown=9007199254740993 # opaque\r\n") {
		t.Fatal("unknown changed")
	}
	for _, suffix := range []string{"maxplayers=3\n", "MaxPlayers=3\n"} {
		if _, e := parseBeamMPReviewedSettings(append([]byte(original), []byte(suffix)...)); e == nil {
			t.Fatal("alias/duplicate accepted")
		}
	}
	if a.DB.Stat().AcquiredConns() != 0 {
		t.Fatal("acquired connections")
	}
}

func TestWave166BeamMPSpans(t *testing.T) {
	raw := []byte("\xef\xbb\xbf[General]\r\nName=\"Before\" # keep\r\nAuthKey=\"fixture-secret\"\r\nPrivate=true\r\nMaxPlayers=6\r\nMaxCars=1\r\nUnknown=9007199254740993 # keep\r\n")
	p, e := parseBeamMPReviewedSettings(raw)
	if e != nil {
		t.Fatal(e)
	}
	out, e := p.patch(map[string]string{"General/Name": "After"})
	if e != nil {
		t.Fatal(e)
	}
	if string(out) != strings.Replace(string(raw), "Before", "After", 1) {
		t.Fatal("span bytes changed")
	}
	for _, key := range []string{"Name", "Description", "AuthKey", "Map", "Tags"} {
		d := []byte("[General]\n" + key + "=\"safe\"\n")
		p, e := parseBeamMPReviewedSettings(d)
		if e != nil {
			t.Fatal(e)
		}
		for _, bad := range []string{"bad\x7f", "bad\x01", strings.Repeat("x", 1025)} {
			if _, e = p.patch(map[string]string{"General/" + key: bad}); e == nil {
				t.Fatalf("accepted invalid %s", key)
			}
		}
	}
	for _, key := range []string{"Private", "LogChat", "AllowGuests", "InformationPacket", "Debug"} {
		p, e := parseBeamMPReviewedSettings([]byte("[General]\nAuthKey=\"fixture-secret\"\n" + key + "=true\n"))
		if e != nil {
			t.Fatal(e)
		}
		if _, e = p.patch(map[string]string{"General/" + key: "false"}); e != nil {
			t.Fatal(e)
		}
		if _, e = p.patch(map[string]string{"General/" + key: "yes"}); e == nil {
			t.Fatal("bad bool")
		}
	}
}
