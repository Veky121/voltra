package panel

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestWave99Factorio(t *testing.T) {
	for _, mode := range []string{"empty", "token", "password", "external", "startup", "permission", "stopped"} {
		t.Run(mode, func(t *testing.T) {
			a, mux, admin, server, f := quickSetupMinecraftFixture(t)
			ctx := context.Background()
			egg := batchSettingsRecipeFixture(t, factorioNativeRecipe)
			if _, e := a.update(ctx, "eggs", num(server["egg_id"]), egg); e != nil {
				t.Fatal(e)
			}
			if _, e := a.update(ctx, "servers", num(server["id"]), M{"startup": factorioNativeStartup}); e != nil {
				t.Fatal(e)
			}
			file := "/data/server-settings.json"
			original := `{"name":"Operator","visibility":{"public":false,"lan":true},"username":"","token":"","password":"","future":900719925474099312345}`
			if mode == "token" {
				original = strings.Replace(original, `"username":"","token":""`, `"username":"fixture-user","token":"fixture-secret"`, 1)
			}
			if mode == "password" {
				original = strings.Replace(original, `"username":""`, `"username":"fixture-user"`, 1)
				original = strings.Replace(original, `"password":""`, `"password":"fixture-secret"`, 1)
			}
			f.mu.Lock()
			delete(f.Files, "/server.properties")
			f.Files[file] = []byte(original)
			f.State = "offline"
			f.mu.Unlock()
			user := admin
			var sub M
			if mode == "permission" {
				reader, e := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "factorio-reader", "email": "factorio-reader@example.invalid"})
				if e != nil {
					t.Fatal(e)
				}
				user = num(reader["id"])
				sub, e = a.insert(ctx, "subusers", M{"server_id": server["id"], "user_id": user, "permissions": []string{"file.read", "file.read-content", "file.update"}})
				if e != nil {
					t.Fatal(e)
				}
			}
			route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
			view := asMap(infraExpect(t, mux, user, "GET", route, nil, 200)["attributes"])
			transport := a.HTTP.Transport
			if transport == nil {
				transport = http.DefaultTransport
			}
			reads := 0
			a.HTTP = &http.Client{Transport: gameLibraryTransport(func(req *http.Request) (*http.Response, error) {
				res, e := transport.RoundTrip(req)
				if e == nil && req.Method == "GET" && req.URL.Path == "/api/servers/"+str(server["uuid"]) {
					reads++
					if reads == 2 {
						switch mode {
						case "external":
							f.mu.Lock()
							f.Files[file] = []byte(`{"name":"external bytes"}`)
							f.mu.Unlock()
						case "startup":
							if e := a.exec(ctx, "UPDATE servers SET startup='changed' WHERE id=$1", server["id"]); e != nil {
								t.Error(e)
							}
						case "permission":
							if _, e := a.update(ctx, "subusers", num(sub["id"]), M{"permissions": []string{"file.read", "file.read-content"}}); e != nil {
								t.Error(e)
							}
						}
					}
				}
				return res, e
			})}
			change := M{"/name": "Updated"}
			want := 200
			switch mode {
			case "empty":
				change = M{"/visibility/public": true}
				want = 422
			case "token", "password":
				change = M{"/visibility/public": true}
			case "external":
				want = 409
			case "startup":
				want = 404
			case "permission":
				want = 403
			case "stopped":
				f.State = "running"
				want = 409
			}
			before := f.Writes
			infraExpect(t, mux, user, "PUT", route, M{"revision": view["revision"], "settings": change}, want)
			f.mu.Lock()
			after := string(f.Files[file])
			writes := f.Writes
			f.mu.Unlock()
			if want != 200 {
				expected := original
				if mode == "external" {
					expected = `{"name":"external bytes"}`
				}
				if after != expected || writes != before {
					t.Fatal("refusal changed native bytes")
				}
			} else {
				if writes != before+1 || !strings.Contains(after, "900719925474099312345") || !strings.Contains(after, "fixture-secret") {
					t.Fatal("successful edit lost native values")
				}
				infraExpect(t, mux, user, "PUT", route, M{"revision": view["revision"], "settings": M{"/name": "stale"}}, 409)
				masked := asMap(infraExpect(t, mux, user, "GET", route, nil, 200)["attributes"])
				for _, v := range asSlice(masked["fields"]) {
					if strings.Contains(str(asMap(v)["value"]), "fixture-secret") {
						t.Fatal("credential exposed")
					}
				}
			}
			if mode == "external" || mode == "startup" || mode == "permission" {
				if reads != 2 {
					t.Fatal("late mutation hook missed")
				}
			}
		})
	}
}
