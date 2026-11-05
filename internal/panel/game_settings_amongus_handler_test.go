package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWave165Handlers(t *testing.T) {
	for _, r := range []string{"among_us/impostor_server/egg-among-us--impostor-server.json", "among_us/bettercrewlink_server/egg-better-crewlink-server.json"} {
		t.Run(r, func(t *testing.T) {
			a, m, u, s, f := wave95Fixture(t)
			egg := batchSettingsRecipeFixture(t, r)
			egg["java_config"] = M{}
			egg["features"] = []any{}
			if _, e := a.update(context.Background(), "eggs", num(s["egg_id"]), egg); e != nil {
				t.Fatal(e)
			}
			if _, e := a.update(context.Background(), "servers", num(s["id"]), M{"startup": egg["startup"]}); e != nil {
				t.Fatal(e)
			}
			wave95InstallReviewed(t, a, s, f, egg)
			entry, _ := gameSettingsProfile(egg)
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
				if !ok {
					t.Fatal(name)
				}
				f.Files["/"+name] = []byte(expected + "\n")
			}
			file := "/impostor/config.json"
			raw := []byte(`{"Server":{"PublicIp":"operator.example","PublicPort":22023,"ListenPort":28000},"opaque":"old","password":"private156","unknown":9007199254740993123456789}`)
			key := "/Server/PublicIp"
			if r == "among_us/bettercrewlink_server/egg-better-crewlink-server.json" {
				file = "/crewlink/config/peerConfig.yml"
				raw = []byte("forceRelayOnly: false\nintegratedRelay:\n  listeningPort: 3478\npassword: private156\n")
				key = "/forceRelayOnly"
			}
			f.Files[file] = raw
			f.State = "offline"
			route := "/api/client/servers/" + str(s["uuid_short"]) + "/game-settings?file=" + file
			view := asMap(infraExpect(t, m, u, "GET", route, nil, 200)["attributes"])
			encoded, _ := json.Marshal(view)
			if strings.Contains(string(encoded), "private156") {
				t.Fatal("secret leaked")
			}
			if strings.Contains(file, "crewlink") {
				infraExpect(t, m, u, "PUT", route, M{"revision": view["revision"], "settings": M{"/integratedRelay/listeningPort": "12345"}}, 422)
			}
			if file == "/impostor/config.json" {
				infraExpect(t, m, u, "PUT", route, M{"revision": view["revision"], "settings": M{"/Server/ListenPort": "12345"}}, 422)
			}
			reader, e := a.insert(context.Background(), "users", M{"uuid": newUUID(), "username": "wave156reader", "email": "wave156@example.invalid"})
			if e != nil {
				t.Fatal(e)
			}
			if _, e = a.insert(context.Background(), "subusers", M{"user_id": reader["id"], "server_id": s["id"], "permissions": []string{"file.read", "file.read-content"}}); e != nil {
				t.Fatal(e)
			}
			infraExpect(t, m, num(reader["id"]), "PUT", route, M{"revision": view["revision"], "settings": M{key: func() any {
				if strings.Contains(file, "crewlink") {
					return true
				}
				return "new.example"
			}()}}, 403)
			infraExpect(t, m, u, "PUT", route, M{"revision": "stale", "settings": M{key: func() any {
				if strings.Contains(file, "crewlink") {
					return true
				}
				return "new.example"
			}()}}, 409)
			f.State = "running"
			infraExpect(t, m, u, "PUT", route, M{"revision": view["revision"], "settings": M{key: func() any {
				if strings.Contains(file, "crewlink") {
					return true
				}
				return "new.example"
			}()}}, 409)
			f.State = "offline"
			if f.Writes != 0 || !bytes.Equal(f.Files[file], raw) {
				t.Fatal("denial wrote")
			}
			infraExpect(t, m, u, "PUT", route, M{"revision": view["revision"], "settings": M{key: func() any {
				if strings.Contains(file, "crewlink") {
					return true
				}
				return "new.example"
			}()}}, 200)
			infraExpect(t, m, u, "GET", "/api/client/servers/"+str(s["uuid_short"])+"/game-settings?file=/unrelated.json", nil, 404)
			infraExpect(t, m, u, "PUT", "/api/client/servers/"+str(s["uuid_short"])+"/game-settings?file=/unrelated.json", M{"revision": view["revision"], "settings": M{key: "x"}}, 404)
			expected := bytes.Replace(raw, []byte("operator.example"), []byte("new.example"), 1)
			if strings.Contains(file, "crewlink") {
				expected = bytes.Replace(raw, []byte("forceRelayOnly: false"), []byte("forceRelayOnly: true"), 1)
			}
			if !bytes.Equal(f.Files[file], expected) {
				t.Fatal("unselected bytes changed")
			}
			if !bytes.Contains(f.Files[file], []byte("private156")) {
				t.Fatal("secret lost")
			}
			if f.Writes != 1 {
				t.Fatal("old bypass not reproduced")
			}
			var value any = "new.example"
			if strings.Contains(file, "crewlink") {
				value = true
			}
			get := func() M { return asMap(infraExpect(t, m, u, "GET", route, nil, 200)["attributes"]) }
			put := func(v M) int {
				payload, _ := json.Marshal(M{"revision": v["revision"], "settings": M{key: value}})
				req := httptest.NewRequest("PUT", route, bytes.NewReader(payload))
				req = WithUser(req, u)
				rec := httptest.NewRecorder()
				m.ServeHTTP(rec, req)
				return rec.Code
			}
			base := a.HTTP.Transport
			if base == nil {
				base = http.DefaultTransport
			}
			v := get()
			reads := 0
			a.HTTP.Transport = wave161Transport{base, func(req *http.Request) {
				if strings.HasSuffix(req.URL.Path, "/files/contents") && req.URL.Query().Get("file") == file {
					reads++
				}
			}}
			if put(v) != 200 {
				t.Fatal("counting put failed")
			}
			a.HTTP.Transport = base
			finalRead := reads - 1
			if finalRead < 2 {
				t.Fatal("missing final read")
			}
			for _, kind := range []string{"startup", "helper"} {
				t.Run("final-read-"+kind, func(t *testing.T) {
					v := get()
					before := append([]byte(nil), f.Files[file]...)
					writes := f.Writes
					n := 0
					fired := false
					helper := append([]byte(nil), f.Files["/.voltra/among-us-runtime.py"]...)
					a.HTTP.Transport = wave161Transport{base, func(req *http.Request) {
						if strings.HasSuffix(req.URL.Path, "/files/contents") && req.URL.Query().Get("file") == file {
							n++
							if n == finalRead {
								fired = true
								if kind == "startup" {
									if _, e := a.update(context.Background(), "servers", num(s["id"]), M{"startup": "revoked"}); e != nil {
										t.Fatal(e)
									}
								} else {
									f.mu.Lock()
									f.Files["/.voltra/among-us-runtime.py"] = []byte("revoked")
									f.mu.Unlock()
								}
							}
						}
					}}
					status := put(v)
					a.HTTP.Transport = base
					if !fired || status < 400 || writes != f.Writes || !bytes.Equal(before, f.Files[file]) {
						t.Fatalf("late %s fired=%v status=%d writes=%d", kind, fired, status, f.Writes-writes)
					}
					a.update(context.Background(), "servers", num(s["id"]), M{"startup": egg["startup"]})
					f.Files["/.voltra/among-us-runtime.py"] = helper
					t.Logf("final selected read revoked %s status=%d zero writes", kind, status)
				})
			}
			t.Log("source identity cases passed")
			_ = time.Second

		})
	}
}
